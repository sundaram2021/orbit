import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { runSubAgent, writeResult } from "@/lib/sandbox/run";
import { evaluateAgent } from "@/lib/eval/evaluate";
import { destroySandbox } from "@/lib/sandbox/tensorlake";
import { traceSpan } from "@/lib/traces";
import { memoryRemember } from "@/lib/memory";
import type { Approval } from "@/types/orbit-types";

/** List approvals (pending by default). */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const { data, error } = await supabase
    .from("approvals")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { approvals: [], error: "Couldn't load approvals. Retry.", retryable: true },
      { status: 503 }
    );
  }
  return NextResponse.json({ approvals: data ?? [] });
}

interface DecideBody {
  id: string;
  decision: "approved" | "rejected";
}

/**
 * Approve or reject.
 * Approved decisions run through an execution state machine:
 * pending → executing → approved | failed. The response returns immediately
 * after marking `executing`; the side effect runs in the background and its
 * outcome (approved/failed + activities row) is visible on refresh. A failed
 * execution can be retried — the approval stays actionable.
 */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as DecideBody | null;
  const id = body?.id;
  const decision = body?.decision;
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { data, error } = await supabase.from("approvals").select("*").eq("id", id).single();
  const approval = data as Approval | null;
  if (error || !approval || (approval.status !== "pending" && approval.status !== "failed")) {
    return NextResponse.json({ error: "approval not found or already decided" }, { status: 404 });
  }

  // Use the service client for follow-up writes (RLS-safe: scoped to this user).
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: `Server misconfigured: ${(err as Error).message}` },
      { status: 503 }
    );
  }

  if (decision === "rejected") {
    try {
      await handleReject(svc, user.id, approval);
    } catch (err) {
      return NextResponse.json({ error: `Reject failed: ${(err as Error).message}. Retry.` }, { status: 500 });
    }
    await svc
      .from("approvals")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ ok: true, decision });
  }

  // Mark executing first so a crash between decision and side effect is
  // visible (not a silent approved-but-nothing-happened). If the migration
  // adding 'executing' isn't applied yet, fall back to the legacy path.
  const executing = await svc
    .from("approvals")
    .update({ status: "executing", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", approval.status);
  if (executing.error) {
    if (/check|constraint|invalid input/i.test(executing.error.message)) {
      // Legacy DB: mark approved and run fire-and-forget as before.
      await svc
        .from("approvals")
        .update({ status: "approved", decided_at: new Date().toISOString() })
        .eq("id", id);
      void executeApproval(svc, user.id, approval, false).catch((err) =>
        console.error("approval execution failed:", err)
      );
      return NextResponse.json({ ok: true, decision, legacy: true });
    }
    return NextResponse.json({ error: "Couldn't start execution. Retry.", retryable: true }, { status: 503 });
  }
  void executeApproval(svc, user.id, approval, true).catch((err) =>
    console.error("approval execution failed:", err)
  );
  return NextResponse.json({ ok: true, decision, executing: true });
}

/** Run the side effect, then land the approval in approved or failed. Never throws. */
export async function executeApproval(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  approval: Approval,
  useExecutionStates: boolean
): Promise<void> {
  try {
    await handleApprove(svc, userId, approval);
    if (useExecutionStates) {
      await svc.from("approvals").update({ status: "approved" }).eq("id", approval.id);
    }
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    console.error("approval execution failed:", err);
    try {
      if (useExecutionStates) {
        // Back to actionable: failed approvals can be retried from the UI.
        await svc.from("approvals").update({ status: "failed" }).eq("id", approval.id);
      }
      await svc.from("activities").insert([
        {
          user_id: userId,
          title: `Approval failed: ${approval.kind}`,
          description: `${message} — retry from approvals.`,
          type: "event",
        },
      ]);
      // run_agent failures must reset the agent so it can be started again.
      if (approval.kind === "run_agent") {
        await svc.from("sub_agents").update({ status: "awaiting_approval" }).eq("id", approval.ref_id);
      }
    } catch (notifyErr) {
      console.error("approval failure bookkeeping failed:", notifyErr);
    }
  }
}

/** Parse a JSON ref_id with a plain-id fallback (legacy rows store a bare agent id). */
function parseRef<T>(refId: string, fallback: T): T {
  try {
    return JSON.parse(refId) as T;
  } catch {
    return fallback;
  }
}

async function handleReject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  approval: Approval
): Promise<void> {
  if (approval.kind === "run_agent") {
    await svc.from("sub_agents").update({ status: "failed" }).eq("id", approval.ref_id);
  }
  if (approval.kind === "publish_pr" || approval.kind === "merge") {
    try {
      const ref = JSON.parse(approval.ref_id) as { agentId?: string; sandboxId?: string };
      if (ref.sandboxId) await destroySandbox({ id: ref.sandboxId, mock: false });
      if (ref.agentId) {
        await svc.from("sub_agents").update({ status: "failed" }).eq("id", ref.agentId);
      }
    } catch { /* ref may be a plain id */ }
  }
  await svc.from("activities").insert([
    { user_id: userId, title: "Approval rejected", description: `${approval.kind} was rejected.`, type: "event" },
  ]);
}

export async function handleApprove(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  approval: Approval
): Promise<void> {
  const { data: conn } = await svc
    .from("github_connections")
    .select("provider_token")
    .eq("user_id", userId)
    .single();
  const token = (conn as { provider_token?: string } | null)?.provider_token;

  switch (approval.kind) {
    case "run_agent": {
      // runSubAgent atomically claims awaiting_approval → running.
      await svc.from("sub_agents").update({ status: "awaiting_approval" }).eq("id", approval.ref_id);
      await runSubAgent(svc, userId, approval.ref_id);
      break;
    }
    case "publish_pr": {
      if (!token) throw new Error("GitHub not connected — reconnect GitHub and retry.");
      const ref = parseRef(approval.ref_id, null) as {
        agentId: string;
        repo: string;
        branch: string;
        base: string;
        summary: string;
        testsPassed: boolean;
        sandboxId?: string;
      } | null;
      if (!ref?.agentId || !ref?.repo || !ref?.branch || !ref?.base) {
        throw new Error("Publish approval is missing details — ask the orchestrator to regenerate it.");
      }
      const { createOctokit, parseRepo } = await import("@/lib/octokit");
      const octokit = await createOctokit(token);
      const parsed = parseRepo(ref.repo);
      if (!parsed) throw new Error(`Bad repo in approval: ${ref.repo}`);
      const { owner: o, name: r } = parsed;
      // Adopt: the sub-agent may already have opened a PR on this branch
      // itself (create_pr tool) — never open a duplicate.
      const existing = await octokit.pulls.list({ owner: o, repo: r, state: "open", head: `${o}:${ref.branch}` });
      const pr = existing.data[0]
        ? { data: existing.data[0] }
        : await octokit.pulls.create({
          owner: o,
          repo: r,
          title: `Orbit: ${ref.summary.split("\n")[0]}`.slice(0, 120),
          head: ref.branch,
          base: ref.base,
          body: `${ref.summary}\n\n---\n*Opened by Orbit orchestrator*`,
        });
      const { data: agent } = await svc.from("sub_agents").select("*").eq("id", ref.agentId).single();
      const traceId = ((agent as { trace_id?: string } | null)?.trace_id ?? ref.agentId) as string;
      await traceSpan(traceId, { name: "pr_opened", detail: `#${pr.data.number}` });
      await writeResult(svc, ref.agentId, {
        repo: ref.repo,
        branch: ref.branch,
        pr_number: pr.data.number,
        pr_url: `https://github.com/${ref.repo}/pull/${pr.data.number}`,
      });
      // Merge still needs its own approval (even in manual mode).
      await svc.from("approvals").insert([
        {
          user_id: userId,
          kind: "merge",
          ref_id: JSON.stringify({ agentId: ref.agentId, repo: ref.repo, prNumber: pr.data.number, sandboxId: ref.sandboxId }),
          status: "pending",
        },
      ]);
      await svc.from("sub_agents").update({ status: "completed" }).eq("id", ref.agentId);
      if ((agent as { event_id?: string } | null)?.event_id) {
        await svc.from("github_events").update({ status: "done" }).eq("id", (agent as { event_id: string }).event_id);
      }
      await memoryRemember(userId, `PR #${pr.data.number} opened for "${(agent as { title?: string } | null)?.title}". ${ref.summary.slice(0, 500)}`, {
        agent_id: ref.agentId,
      });
      await svc.from("activities").insert([
        { user_id: userId, title: `PR opened: #${pr.data.number}`, description: "Approve the merge to finish.", type: "pr" },
      ]);
      void evaluateAgent(
        svc,
        userId,
        ref.agentId,
        ref.summary,
        ((agent as { run_log?: string } | null)?.run_log ?? "") as string,
        { testsPassed: ref.testsPassed, repo: ref.repo, branch: ref.branch, base: ref.base, token }
      ).catch((err) => console.error("post-publish evaluation failed:", err));
      break;
    }
    case "merge": {
      if (!token) throw new Error("GitHub not connected — reconnect GitHub and retry.");
      const ref = parseRef(approval.ref_id, null) as {
        agentId: string;
        repo: string;
        prNumber: number;
        sandboxId?: string;
      } | null;
      if (!ref?.agentId || !ref?.repo || ref?.prNumber == null) {
        throw new Error("Merge approval is missing details — ask the orchestrator to regenerate it.");
      }
      const { createOctokit: createOctokitMerge, parseRepo: parseRepoMerge } = await import("@/lib/octokit");
      const octokit = await createOctokitMerge(token);
      const parsedMerge = parseRepoMerge(ref.repo);
      if (!parsedMerge) throw new Error(`Bad repo in approval: ${ref.repo}`);
      const { owner: o, name: r } = parsedMerge;
      await octokit.pulls.merge({ owner: o, repo: r, pull_number: ref.prNumber, merge_method: "squash" });
      await writeResult(svc, ref.agentId, { merged: true });
      const { data: agent } = await svc.from("sub_agents").select("*").eq("id", ref.agentId).single();
      const traceId = ((agent as { trace_id?: string } | null)?.trace_id ?? ref.agentId) as string;
      await traceSpan(traceId, { name: "merged", detail: `#${ref.prNumber} squash-merged` });
      if (ref.sandboxId) await destroySandbox({ id: ref.sandboxId, mock: false });
      await svc.from("activities").insert([
        { user_id: userId, title: `PR merged: #${ref.prNumber}`, description: "Work is live.", type: "pr" },
      ]);
      break;
    }
    case "github_comment": {
      if (!token) throw new Error("GitHub not connected — reconnect GitHub and retry.");
      const ref = parseRef(approval.ref_id, null) as { repo: string; number: string; body: string } | null;
      if (!ref?.repo || !ref?.number || !ref?.body) {
        throw new Error("Comment approval is missing details — ask the orchestrator to regenerate it.");
      }
      const { createOctokit: createOctokitComment, parseRepo: parseRepoComment } = await import("@/lib/octokit");
      const octokit = await createOctokitComment(token);
      const parsedComment = parseRepoComment(ref.repo);
      if (!parsedComment) throw new Error(`Bad repo in approval: ${ref.repo}`);
      const { owner: o, name: r } = parsedComment;
      await octokit.issues.createComment({
        owner: o,
        repo: r,
        issue_number: Number(ref.number),
        body: ref.body,
      });
      await svc.from("activities").insert([
        { user_id: userId, title: `Comment posted on ${ref.repo}#${ref.number}`, description: "Posted by the orchestrator.", type: "event" },
      ]);
      break;
    }
    case "close_issue": {
      const { executeCloseIssue } = await import("@/lib/tools/github");
      const ref = parseRef(approval.ref_id, null) as { repo: string; issue_number?: string | number; reason?: string; comment?: string } | null;
      if (!ref?.repo || ref?.issue_number == null) {
        throw new Error("Close-issue approval is missing details — ask the orchestrator to regenerate it.");
      }
      const res = await executeCloseIssue({
        supabase: svc,
        userId,
        githubToken: token,
        repo: ref.repo,
        issueNumber: Number(ref.issue_number),
        reason: ref.reason,
        comment: ref.comment,
      });
      if (!res.ok) throw new Error(res.output);
      break;
    }
    case "close_pr": {
      const { executeClosePR } = await import("@/lib/tools/github");
      const ref = parseRef(approval.ref_id, null) as { repo: string; pr_number?: string | number; comment?: string } | null;
      if (!ref?.repo || ref?.pr_number == null) {
        throw new Error("Close-PR approval is missing details — ask the orchestrator to regenerate it.");
      }
      const res = await executeClosePR({
        supabase: svc,
        userId,
        githubToken: token,
        repo: ref.repo,
        prNumber: Number(ref.pr_number),
        comment: ref.comment,
      });
      if (!res.ok) throw new Error(res.output);
      break;
    }
  }
}
