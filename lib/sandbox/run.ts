import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, orbitModel } from "../ai";
import { getUserSettings } from "../orchestrator/spawn";
import { memoryRemember } from "../memory";
import { traceSpan } from "../traces";
import { createSandbox, sandboxExec, destroySandbox } from "./tensorlake";
import {
  runTool,
  toolSchemas,
  type ToolContext,
} from "../tools/registry";
import { registerSandboxFileTools } from "../tools/sandbox-files";
import { registerSandboxExecTools } from "../tools/sandbox-exec";
import { registerGithubTools } from "../tools/github";
import { registerWebTools } from "../tools/web";
import type { SubAgent } from "@/types/orbit-types";

const MAX_STEPS = 12;
const RUN_WALLCLOCK_MS = 25 * 60 * 1000;

const SUB_AGENT_TOOLS = [
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "sandbox_exec",
  "track_tasks",
  "finish_task",
  // Read-only outside-sandbox tools.
  "github_read",
  "ci_status",
  "self_diff",
  "web_search",
  "fetch_url",
  // Autonomous GitHub writes: sub-agents decide independently, no approval
  // queue. NEVER offered: merges or destructive ops (user-gated).
  "github_comment",
  "submit_pr_review",
  "create_issue",
  "create_pr",
];

let subAgentToolsInit: Promise<void> | null = null;
function ensureSubAgentTools(): void {
  if (subAgentToolsInit) return;
  subAgentToolsInit = (async () => {
    registerSandboxFileTools();
    registerSandboxExecTools();
    registerGithubTools();
    registerWebTools();
  })();
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

async function getGithubToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("github_connections")
      .select("provider_token")
      .eq("user_id", userId)
      .single();
    return (data as { provider_token?: string } | null)?.provider_token ?? null;
  } catch {
    return null;
  }
}

async function fail(
  supabase: SupabaseClient,
  agent: SubAgent,
  traceId: string,
  message: string,
  sandbox?: { id: string; mock: boolean }
): Promise<void> {
  // fail() itself must never throw — it runs inside catch blocks, and a
  // throw here would leave the agent stuck in `running` with no explanation.
  try {
    // Never leak quota: a created sandbox is always destroyed on failure.
    if (sandbox && !sandbox.mock) {
      try {
        await destroySandbox(sandbox);
      } catch (err) {
        console.warn("fail() destroy failed:", err);
      }
    }
    let scrubbed = message;
    try {
      const { scrubSecrets } = await import("../eval/gates");
      scrubbed = scrubSecrets(message);
    } catch {
      // keep raw message
    }
    await Promise.allSettled([
      supabase.from("sub_agents").update({ status: "failed" }).eq("id", agent.id),
      agent.event_id
        ? supabase.from("github_events").update({ status: "ignored" }).eq("id", agent.event_id)
        : Promise.resolve(),
      traceSpan(traceId, { name: "failed", detail: scrubbed }),
      supabase.from("activities").insert([
        { user_id: agent.user_id, title: `Agent failed: ${agent.title}`, description: scrubbed, type: "event" },
      ]),
    ]);
  } catch (err) {
    console.error("fail() bookkeeping failed:", err);
  }
}

/**
 * Full agent run: sandbox → clone → Haiku tool-loop → gated publish → evaluate.
 * Runs fire-and-forget from routes (never awaited in a request handler).
 */
export async function runSubAgent(
  supabase: SupabaseClient,
  userId: string,
  agentId: string
): Promise<void> {
  let agent: SubAgent | null;
  let traceId = agentId;
  try {
    const { data, error } = await supabase.from("sub_agents").select("*").eq("id", agentId).single();
    if (error) throw new Error(`agent lookup failed: ${error.message}`);
    agent = data as SubAgent | null;
  } catch (err) {
    console.error("runSubAgent lookup failed:", err);
    return;
  }
  if (!agent || agent.status === "completed" || agent.status === "failed") return;
  // Atomic claim: only one runner proceeds (awaiting_approval → running).
  const { data: claimed } = await supabase
    .from("sub_agents")
    .update({ status: "running" })
    .eq("id", agentId)
    .eq("status", "awaiting_approval")
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return;
  agent.status = "running";
  traceId = agent.trace_id ?? agentId;

  let token: string | null;
  let settings: Awaited<ReturnType<typeof getUserSettings>>;
  try {
    [token, settings] = await Promise.all([
      getGithubToken(supabase, userId),
      getUserSettings(supabase, userId),
    ]);
  } catch (err) {
    await fail(supabase, agent, traceId, `Couldn't load run prerequisites: ${(err as Error).message}. Retry.`);
    return;
  }
  if (!token) {
    await fail(supabase, agent, traceId, "GitHub not connected — reconnect GitHub to run agents.");
    return;
  }

  await supabase.from("sub_agents").update({ status: "running" }).eq("id", agentId);
  if (agent.event_id) {
    await supabase.from("github_events").update({ status: "running" }).eq("id", agent.event_id);
  }

  const repoFull = extractRepo(agent.system_prompt);
  if (!repoFull) {
    await fail(supabase, agent, traceId, "Could not determine target repo from task.");
    return;
  }

  const branch = `orbit/${slugify(agent.title)}-${agentId.slice(0, 6)}`;
  // /tmp is writable for the sandbox's default unprivileged user (verified
  // against the real API: /workspace is not writable).
  const workdir = `/tmp/orbit-work/${repoFull.split("/")[1]}`;

  // Sandbox with one retry on quota exhaustion (plan quota = 1 concurrent).
  let sandbox;
  try {
    sandbox = await createSandbox(`orbit-${agentId.slice(0, 8)}`);
  } catch (err) {
    const msg = (err as Error).message;
    if (/quota/i.test(msg)) {
      await traceSpan(traceId, { name: "quota_wait", detail: "capacity full; retrying in 90s" });
      await new Promise((r) => setTimeout(r, 90000));
      try {
        sandbox = await createSandbox(`orbit-${agentId.slice(0, 8)}-retry`);
      } catch (err2) {
        await fail(supabase, agent, traceId, `Sandbox quota exhausted after retry: ${(err2 as Error).message.slice(0, 200)}. Re-approve the run later to retry.`);
        return;
      }
    } else {
      await fail(supabase, agent, traceId, `Sandbox creation failed: ${msg}`);
      return;
    }
  }
  await supabase.from("sub_agents").update({ sandbox_id: sandbox.id }).eq("id", agentId);
  await traceSpan(traceId, { name: "sandbox_ready", detail: sandbox.id });

  try {
    // Clone with token, then IMMEDIATELY strip it from .git/config so the
    // agent can never extract it and bypass approval gates via direct API use.
    // Pushes use a one-shot header with the token from env (never on disk,
    // never in the command string).
    const cloneUrl = `https://x-access-token:${token}@github.com/${repoFull}.git`;
    const anonUrl = `https://github.com/${repoFull}.git`;
    // Push via one-shot URL (never stored: remote stays anonymous). The token
    // appears in this command string only — scrubSecrets() strips it from
    // every persisted log/trace before anything is saved.
    const pushCmd = `git push '${cloneUrl.replace(/'/g, "'\\''")}' HEAD:${branch}`;
    const clone = await sandboxExec(
      sandbox,
      `mkdir -p /tmp/orbit-work && rm -rf ${workdir} && git clone --depth 50 '${cloneUrl.replace(/'/g, "'\\''")}' ${workdir} && cd ${workdir} && git remote set-url origin '${anonUrl}' && git checkout -b ${branch} && git log --oneline -3 && ls -la`,
      { timeoutMs: 3 * 60 * 1000 }
    );
    await traceSpan(traceId, {
      name: "cloned",
      detail: `branch ${branch}, exit ${clone.exitCode}`,
    });
    if (clone.exitCode !== 0) {
      await fail(supabase, agent, traceId, `Clone failed: ${clone.stderr.slice(0, 500)}`, sandbox);
      return;
    }

    // Structured tool-loop inside the checkout (file tools + guarded exec).
    ensureSubAgentTools();
    const anthropic: Anthropic = getAnthropicClient();
    const tools = toolSchemas(SUB_AGENT_TOOLS) as unknown as Anthropic.Tool[];
    const toolCtx: ToolContext = {
      userId,
      supabase,
      traceId,
      sandboxId: sandbox.id,
      workdir,
      agentId,
      // Server-side only: powers the read-only github_read / ci_status
      // tools. Never enters tool outputs; the sandbox remote stays anonymous
      // and exec-level GitHub writes stay deny-listed.
      githubToken: token,
    };
    const toolCalls: { name: string; at: number }[] = [];
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Repository is checked out and you are on branch ${branch}. The repo root is your working directory. Do the task now. Use read_file/glob/grep to explore, write_file/edit_file to change code, sandbox_exec for tests/builds/git. Use github_read to re-read your issue/PR (comments, reviews) when you need fresh context, ci_status to confirm your branch is green before finishing, and self_diff to review your own changes. Use web_search/fetch_url when you need outside docs or error lookups. You are autonomous: comment with github_comment, file follow-ups with create_issue, and open your PR with create_pr when the work is done — never merge. Keep a plan with track_tasks. When done, call finish_task with your summary.`,
      },
    ];
    let summary = "";
    let testsPassed = false;
    let sawTestPass = false;
    let finished = false;
    let lastSteering = "";
    const runLog: string[] = [];
    const deadline = Date.now() + RUN_WALLCLOCK_MS;

    for (let step = 0; step < MAX_STEPS && !finished; step++) {
      if (Date.now() > deadline) {
        runLog.push("[budget] wall-clock budget exhausted; stopping.");
        summary = summary || "Agent hit the time budget; partial work in branch.";
        break;
      }
      // Mid-run steering from the orchestrator chat.
      try {
        const { data: steerRow } = await supabase
          .from("sub_agents")
          .select("steering")
          .eq("id", agentId)
          .single();
        const steering = ((steerRow as { steering?: string } | null)?.steering ?? "").slice(-4000);
        if (steering && steering !== lastSteering) {
          lastSteering = steering;
          messages.push({
            role: "user",
            content: [{ type: "text", text: `New instruction from the orchestrator:\n${steering}` }],
          });
        }
      } catch {
        // steering column may predate the v3 migration — non-fatal
      }

      const response = await anthropic.messages.create({
        model: orbitModel(),
        max_tokens: 2048,
        system: agent.system_prompt,
        tools,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) {
        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("\n");
        summary = text || "Agent finished with no summary.";
        break;
      }
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        if (use.type !== "tool_use") continue;
        const input = (use.input ?? {}) as Record<string, string>;
        toolCalls.push({ name: use.name, at: Date.now() });
        // Allowlist: the model only gets SUB_AGENT_TOOLS. Anything else
        // (e.g. orchestrator-only or write tools) is refused, so a
        // compromised or confused model can't reach beyond its sandbox role.
        if (!SUB_AGENT_TOOLS.includes(use.name)) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Tool ${use.name} is not available to sub-agents. Use your assigned tools.`,
            is_error: true,
          });
          continue;
        }
        const started = Date.now();
        const result = await runTool(use.name, input, toolCtx);
        const latencyMs = Date.now() - started;
        await traceSpan(traceId, {
          name: `step_${step}:${use.name}`,
          detail: `in=${JSON.stringify(input).slice(0, 300)} ok=${result.ok} latency=${latencyMs}ms\n${result.output.slice(0, 500)}`,
        });

        if (use.name === "finish_task") {
          finished = true;
          // Honesty guard: a claimed pass only counts if a real test command
          // actually exited 0 during the run (agents over-claim).
          testsPassed = input.tests_passed === "true" && sawTestPass;
          summary = input.summary || "Agent finished with no summary.";
          runLog.push(`[finish] tests_passed=${testsPassed}\n${summary.slice(0, 2000)}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: "Run ending. Good work.",
          });
          continue;
        }
        if (
          use.name === "sandbox_exec" &&
          /test|jest|vitest|pytest|bun test|npm test/i.test(input.command ?? "") &&
          result.ok
        ) {
          sawTestPass = true;
          testsPassed = true;
        }
        runLog.push(
          `[${use.name}] ${JSON.stringify(input).slice(0, 400)}\n→ ok=${result.ok}\n${result.output.slice(0, 1200)}`
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result.output.slice(0, 12000),
          is_error: result.ok ? undefined : true,
        });
      }
      messages.push({ role: "user", content: toolResults });
      if (step === MAX_STEPS - 1 && !finished) {
        summary = summary || "Agent hit the step limit; partial work in branch.";
      }
    }

    // Commit whatever changed (with a per-command identity; nothing persisted).
    await sandboxExec(
      sandbox,
      `cd ${workdir} && git add -A && (git diff --cached --quiet || git -c user.name="Orbit Agent" -c user.email="orbit@users.noreply.github.com" commit -m ${JSON.stringify(`orbit: ${agent.title}`)}) && git status --short | head -20`,
      { workingDir: workdir }
    );

    const toolSequence = toolCalls.map((t) => t.name).join(" → ");
    const { scrubSecrets } = await import("../eval/gates");
    const runLogText = scrubSecrets(
      `[tools: ${toolSequence || "none"}]\n\n${runLog.join("\n\n")}`
    ).slice(0, 14000);
    // Persist the execution log for the evaluator (ignored if v2 migration pending).
    await supabase.from("sub_agents").update({ run_log: runLogText }).eq("id", agentId);

    const { createOctokit, parseRepo: parseRepoStrict, githubErrorMessage } = await import("../octokit");
    const octokit = await createOctokit(token);
    const parsedRepo = parseRepoStrict(repoFull);
    if (!parsedRepo) {
      await fail(supabase, agent, traceId, `Bad repo in task: ${repoFull}.`);
      return;
    }
    const { owner: o, name: r } = parsedRepo;
    let base: string;
    try {
      const { data: repoInfo } = await octokit.repos.get({ owner: o, repo: r });
      base = repoInfo.default_branch;
    } catch (err) {
      await fail(supabase, agent, traceId, `Repo inaccessible (${githubErrorMessage(err)}). Check access and retry.`);
      return;
    }

    // Empty branch (work already done / nothing to change) → complete
    // gracefully instead of failing on an empty-diff PR.
    const ahead = await sandboxExec(
      sandbox,
      `cd ${workdir} && git rev-list --count origin/${base}..HEAD 2>/dev/null || echo 1`,
      { workingDir: workdir }
    );
    const aheadOut = ahead.stdout.trim();
    // Empty output (exec failure) is "unknown", not "non-empty" — re-check
    // once rather than pushing a possibly-empty branch or opening an empty PR.
    let isEmpty = aheadOut === "0";
    if (aheadOut === "" || ahead.timedOut) {
      const recheck = await sandboxExec(
        sandbox,
        `cd ${workdir} && git rev-list --count origin/${base}..HEAD 2>/dev/null || echo 1`,
        { workingDir: workdir }
      );
      const reOut = recheck.stdout.trim();
      if (reOut === "" || recheck.timedOut) {
        await fail(supabase, agent, traceId, "Couldn't verify branch state (sandbox exec timed out). Retry.");
        return;
      }
      isEmpty = reOut === "0";
    }
    if (isEmpty) {
      await writeResult(supabase, agentId, { repo: repoFull, branch });
      await linkIssueResult(supabase, agent);

      if (agent.kind === "review") {
        await traceSpan(traceId, { name: "review_completed", detail: summary.slice(0, 300) });
        await supabase.from("activities").insert([
          {
            user_id: userId,
            title: `Review finished: ${agent.title}`,
            description: `PR review completed on GitHub. ${summary.slice(0, 200)}`,
            type: "pr",
          },
        ]);
        await finishCompleted(supabase, userId, agent, traceId, summary, {
          runLog: runLogText,
          evalCtx: { testsPassed, repo: repoFull, branch, base, token },
        });
        return;
      }

      await traceSpan(traceId, { name: "no_changes", detail: `branch ${branch} matches ${base}; nothing to publish` });
      await supabase.from("activities").insert([
        {
          user_id: userId,
          title: `No changes needed: ${agent.title}`,
          description: `The work was already done on ${base}. Branch ${branch} left empty; no PR opened.`,
          type: "event",
        },
      ]);
      await finishCompleted(supabase, userId, agent, traceId, `${summary}\n\n(no changes — branch matched ${base})`, {
        runLog: runLogText,
        evalCtx: { testsPassed, repo: repoFull, branch, base, token },
      });
      return;
    }

    if (settings.orchestrator_auto_approve) {
      // Full autonomy: push → open PR → merge (merge only if tests passed).
      const pushed = await sandboxExec(sandbox, `cd ${workdir} && ${pushCmd}`, {
        workingDir: workdir,
        timeoutMs: 3 * 60 * 1000,
      });
      if (pushed.exitCode !== 0) {
        throw new Error(`Push failed: ${pushed.stderr.slice(0, 300) || pushed.stdout.slice(0, 300)}`);
      }
      let prNumber: number;
      try {
        const pr = await octokit.pulls.create({
          owner: o,
          repo: r,
          title: `Orbit: ${agent.title}`.slice(0, 120),
          head: branch,
          base,
          body: `${summary}\n\n---\n*Opened by Orbit orchestrator*`,
        });
        prNumber = pr.data.number;
      } catch (err) {
        // Adopt an existing PR on this branch (e.g. opened concurrently) instead of failing.
        const msg = (err as Error).message;
        if (/already exists/i.test(msg)) {
          const open = await octokit.pulls.list({ owner: o, repo: r, state: "open", head: `${o}:${branch}` });
          const found = open.data[0];
          if (!found) throw err;
          prNumber = found.number;
          await traceSpan(traceId, { name: "pr_adopted", detail: `#${prNumber} already existed on ${branch}` });
        } else {
          // Push succeeded but PR open failed (rate limit, permissions):
          // don't fail the run and orphan the branch — queue a publish_pr
          // approval so the user can retry the PR step.
          await writeResult(supabase, agentId, { repo: repoFull, branch, pushed: true });
          await supabase.from("approvals").insert([
            {
              user_id: userId,
              kind: "publish_pr",
              ref_id: JSON.stringify({ agentId, repo: repoFull, branch, base, summary, testsPassed, sandboxId: sandbox.id }),
              status: "pending",
            },
          ]);
          await traceSpan(traceId, { name: "pr_open_failed", detail: githubErrorMessage(err) });
          await supabase.from("activities").insert([
            {
              user_id: userId,
              title: `PR open failed: ${agent.title}`,
              description: `Branch ${branch} is pushed. ${githubErrorMessage(err)} Approve to retry opening the PR.`,
              type: "pr",
            },
          ]);
          await supabase.from("sub_agents").update({ status: "running", run_log: runLogText }).eq("id", agentId);
          return;
        }
      }
      await traceSpan(traceId, { name: "pr_opened", detail: `#${prNumber}` });
      await writeResult(supabase, agentId, {
        repo: repoFull,
        branch,
        pr_number: prNumber,
        pr_url: `https://github.com/${repoFull}/pull/${prNumber}`,
      });
      await linkIssueResult(supabase, agent);
      let merged = false;
      if (testsPassed) {
        try {
          await octokit.pulls.merge({ owner: o, repo: r, pull_number: prNumber, merge_method: "squash" });
          merged = true;
          await writeResult(supabase, agentId, { merged: true });
          await traceSpan(traceId, { name: "merged", detail: `#${prNumber} squash-merged` });
        } catch (err) {
          await traceSpan(traceId, { name: "merge_failed", detail: (err as Error).message.slice(0, 300) });
        }
      }
      await finishCompleted(supabase, userId, agent, traceId, summary, {
        prNumber,
        merged,
        runLog: runLogText,
        evalCtx: { testsPassed, repo: repoFull, branch, base, token },
      });
    } else {
      // Manual: push the branch, then wait for publish approval.
      const pushed = await sandboxExec(sandbox, `cd ${workdir} && ${pushCmd}`, {
        workingDir: workdir,
        timeoutMs: 3 * 60 * 1000,
      });
      if (pushed.exitCode !== 0) {
        throw new Error(`Push failed: ${pushed.stderr.slice(0, 300) || pushed.stdout.slice(0, 300)}`);
      }
      await supabase.from("approvals").insert([
        {
          user_id: userId,
          kind: "publish_pr",
          ref_id: JSON.stringify({ agentId, repo: repoFull, branch, base, summary, testsPassed, sandboxId: sandbox.id }),
          status: "pending",
        },
      ]);
      await traceSpan(traceId, { name: "awaiting_publish_approval", detail: branch });
      await supabase.from("activities").insert([
        {
          user_id: userId,
          title: `Work ready for review: ${agent.title}`,
          description: `Branch ${branch} is pushed. Approve to open a PR${testsPassed ? " (tests passed)" : ""}.`,
          type: "pr",
        },
      ]);
      // Keep sandbox alive for the publish step; destroy happens on approve/reject.
      await supabase.from("sub_agents").update({ status: "running" }).eq("id", agentId);
      await memoryRemember(userId, `Agent "${agent.title}" finished work on ${branch}, awaiting publish approval. ${summary.slice(0, 500)}`, {
        agent_id: agentId,
      });
    }
  } catch (err) {
    await fail(supabase, agent, traceId, `Run error: ${(err as Error).message.slice(0, 500)}`, sandbox);
  } finally {
    if (sandbox) {
      await destroySandbox(sandbox);
    }
  }
}

const REPO_RE = /Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/;
function extractRepo(systemPrompt: string): string | null {
  const m = REPO_RE.exec(systemPrompt);
  return m ? m[1] : null;
}

/**
 * Merge outcome facts into sub_agents.result (tolerant of the v5
 * migration not being applied yet — a missing column fails silently).
 */
export async function writeResult(
  supabase: SupabaseClient,
  agentId: string,
  patch: Record<string, string | number | boolean>
): Promise<void> {
  try {
    const { data } = await supabase
      .from("sub_agents")
      .select("result")
      .eq("id", agentId)
      .single();
    const current = ((data as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>;
    await supabase
      .from("sub_agents")
      .update({ result: { ...current, ...patch } })
      .eq("id", agentId);
  } catch {
    // column may predate the migration — non-fatal
  }
}

/** Link the triggering GitHub issue (if any) into the result. */
export async function linkIssueResult(
  supabase: SupabaseClient,
  agent: SubAgent
): Promise<void> {
  if (!agent.event_id) return;
  try {
    const { data } = await supabase
      .from("github_events")
      .select("repo,number")
      .eq("id", agent.event_id)
      .single();
    const ev = data as { repo?: string; number?: number } | null;
    if (ev?.repo && ev?.number) {
      await writeResult(supabase, agent.id, {
        repo: ev.repo,
        issue_number: ev.number,
        issue_url: `https://github.com/${ev.repo}/issues/${ev.number}`,
      });
    }
  } catch {
    // non-fatal
  }
}

async function finishCompleted(
  supabase: SupabaseClient,
  userId: string,
  agent: SubAgent,
  traceId: string,
  summary: string,
  opts: {
    prNumber?: number;
    merged?: boolean;
    runLog?: string;
    evalCtx?: { testsPassed: boolean; repo: string; branch: string; base: string; token: string };
  }
): Promise<void> {
  await supabase.from("sub_agents").update({ status: "completed" }).eq("id", agent.id);
  if (agent.event_id) {
    await supabase.from("github_events").update({ status: "done" }).eq("id", agent.event_id);
  }
  await traceSpan(traceId, { name: "completed", detail: summary.slice(0, 500) });
  await memoryRemember(userId, `Agent "${agent.title}" completed. ${summary.slice(0, 800)}`, {
    agent_id: agent.id,
  });
  await supabase.from("activities").insert([
    {
      user_id: userId,
      title: `Done: ${agent.title}`,
      description:
        opts.prNumber != null
          ? `PR #${opts.prNumber}${opts.merged ? " merged" : " opened"}. ${summary.slice(0, 300)}`
          : summary.slice(0, 300),
      type: "pr",
    },
  ]);
  // Fire-and-forget evaluation with the full execution context.
  const { evaluateAgent } = await import("../eval/evaluate");
  void evaluateAgent(supabase, userId, agent.id, summary, opts.runLog ?? "", opts.evalCtx ?? { testsPassed: false }).catch(
    (err) => console.error("evaluateAgent failed:", err)
  );
}
