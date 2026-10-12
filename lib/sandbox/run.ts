import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { getAnthropicClient, orbitModel } from "../ai";
import { getUserSettings } from "../orchestrator/spawn";
import { memoryRemember } from "../memory";
import { traceSpan } from "../traces";
import { createSandbox, sandboxExec, destroySandbox } from "./tensorlake";
import type { SubAgent } from "@/types/orbit-types";

const MAX_STEPS = 10;

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
  message: string
): Promise<void> {
  await supabase.from("sub_agents").update({ status: "failed" }).eq("id", agent.id);
  if (agent.event_id) {
    await supabase.from("github_events").update({ status: "ignored" }).eq("id", agent.event_id);
  }
  await traceSpan(traceId, { name: "failed", detail: message });
  await supabase.from("activities").insert([
    { title: `Agent failed: ${agent.title}`, description: message, type: "event" },
  ]);
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
  const { data } = await supabase.from("sub_agents").select("*").eq("id", agentId).single();
  const agent = data as SubAgent | null;
  if (!agent || agent.status === "completed") return;
  const traceId = agent.trace_id ?? agentId;

  const token = await getGithubToken(supabase, userId);
  if (!token) {
    await fail(supabase, agent, traceId, "GitHub not connected — reconnect GitHub to run agents.");
    return;
  }

  const settings = await getUserSettings(supabase, userId);
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
  const workdir = `/workspace/${repoFull.split("/")[1]}`;

  let sandbox;
  try {
    sandbox = await createSandbox(`orbit-${agentId.slice(0, 8)}`);
  } catch (err) {
    await fail(supabase, agent, traceId, `Sandbox creation failed: ${(err as Error).message}`);
    return;
  }
  await supabase.from("sub_agents").update({ sandbox_id: sandbox.id }).eq("id", agentId);
  await traceSpan(traceId, { name: "sandbox_ready", detail: sandbox.id });

  try {
    // Clone with token (masked in all logs/traces).
    const cloneUrl = `https://x-access-token:${token}@github.com/${repoFull}.git`;
    const clone = await sandboxExec(
      sandbox,
      `git clone --depth 50 '${cloneUrl.replace(/'/g, "'\\''")}' ${workdir} && cd ${workdir} && git checkout -b ${branch} && git log --oneline -3 && ls`,
      { timeoutMs: 3 * 60 * 1000 }
    );
    await traceSpan(traceId, {
      name: "cloned",
      detail: `branch ${branch}, exit ${clone.exitCode}`,
    });
    if (clone.exitCode !== 0) {
      await fail(supabase, agent, traceId, `Clone failed: ${clone.stderr.slice(0, 500)}`);
      return;
    }

    // Haiku tool-loop inside the checkout.
    const anthropic: Anthropic = getAnthropicClient();
    const tools: Anthropic.Tool[] = [
      {
        name: "sandbox_exec",
        description:
          "Run a bash command inside the sandbox repo checkout. Returns stdout/stderr/exit code. Working directory is already the repo.",
        input_schema: {
          type: "object" as const,
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Repository is checked out and you are on branch ${branch}. Working dir is the repo root. Do the task now. Use sandbox_exec for everything (explore, edit via cat/sed/python, run tests). When done, reply with ONLY a summary: files changed, tests run + result, and suggested PR title/body.`,
      },
    ];
    let summary = "";
    let testsPassed = false;

    for (let step = 0; step < MAX_STEPS; step++) {
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
        const cmd = ((use.input as { command?: string } | undefined)?.command ?? "").slice(0, 2000);
        const result = await sandboxExec(sandbox, cmd, {
          workingDir: workdir,
          timeoutMs: 4 * 60 * 1000,
        });
        await traceSpan(traceId, {
          name: `step_${step}`,
          detail: `$ ${cmd.slice(0, 200)}\n(exit ${result.exitCode}) ${result.stdout.slice(0, 500)}`,
        });
        if (/test|jest|vitest|pytest|bun test|npm test/i.test(cmd) && result.exitCode === 0) {
          testsPassed = true;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `exit=${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
        });
      }
      messages.push({ role: "user", content: toolResults });
      if (step === MAX_STEPS - 1) summary = "Agent hit the step limit; partial work in branch.";
    }

    // Commit whatever changed.
    await sandboxExec(
      sandbox,
      `cd ${workdir} && git add -A && (git diff --cached --quiet || git commit -m ${JSON.stringify(`orbit: ${agent.title}`)}) && git status --short | head -20`,
      { workingDir: workdir }
    );

    const octokit = new Octokit({ auth: token });
    const [o, r] = repoFull.split("/");
    const { data: repoInfo } = await octokit.repos.get({ owner: o, repo: r });
    const base = repoInfo.default_branch;

    if (settings.orchestrator_auto_approve) {
      // Full autonomy: push → open PR → merge (merge only if tests passed).
      await sandboxExec(sandbox, `cd ${workdir} && git push -u origin ${branch}`, {
        workingDir: workdir,
        timeoutMs: 3 * 60 * 1000,
      });
      const pr = await octokit.pulls.create({
        owner: o,
        repo: r,
        title: `Orbit: ${agent.title}`.slice(0, 120),
        head: branch,
        base,
        body: `${summary}\n\n---\n*Opened by Orbit orchestrator*`,
      });
      await traceSpan(traceId, { name: "pr_opened", detail: `#${pr.data.number}` });
      let merged = false;
      if (testsPassed) {
        try {
          await octokit.pulls.merge({ owner: o, repo: r, pull_number: pr.data.number, merge_method: "squash" });
          merged = true;
          await traceSpan(traceId, { name: "merged", detail: `#${pr.data.number} squash-merged` });
        } catch (err) {
          await traceSpan(traceId, { name: "merge_failed", detail: (err as Error).message.slice(0, 300) });
        }
      }
      await finishCompleted(supabase, userId, agent, traceId, summary, {
        prNumber: pr.data.number,
        merged,
      });
    } else {
      // Manual: push the branch, then wait for publish approval.
      await sandboxExec(sandbox, `cd ${workdir} && git push -u origin ${branch}`, {
        workingDir: workdir,
        timeoutMs: 3 * 60 * 1000,
      });
      await supabase.from("approvals").insert([
        {
          user_id: userId,
          kind: "publish_pr",
          ref_id: JSON.stringify({ agentId, repo: repoFull, branch, base, summary, testsPassed }),
          status: "pending",
        },
      ]);
      await traceSpan(traceId, { name: "awaiting_publish_approval", detail: branch });
      await supabase.from("activities").insert([
        {
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
    await fail(supabase, agent, traceId, `Run error: ${(err as Error).message.slice(0, 500)}`);
  } finally {
    // In manual mode the sandbox is kept for publish; auto mode destroys it.
    if (settings.orchestrator_auto_approve) {
      await destroySandbox(sandbox);
    }
  }
}

function extractRepo(systemPrompt: string): string | null {
  const m = systemPrompt.match(/Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  return m ? m[1] : null;
}

async function finishCompleted(
  supabase: SupabaseClient,
  userId: string,
  agent: SubAgent,
  traceId: string,
  summary: string,
  opts: { prNumber?: number; merged?: boolean }
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
      title: `Done: ${agent.title}`,
      description:
        opts.prNumber != null
          ? `PR #${opts.prNumber}${opts.merged ? " merged" : " opened"}. ${summary.slice(0, 300)}`
          : summary.slice(0, 300),
      type: "pr",
    },
  ]);
  // Fire-and-forget evaluation.
  const { evaluateAgent } = await import("../eval/evaluate");
  void evaluateAgent(supabase, userId, agent.id, summary);
}
