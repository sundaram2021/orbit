import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
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
  const { data } = await supabase
    .from("approvals")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ approvals: data ?? [] });
}

interface DecideBody {
  id: string;
  decision: "approved" | "rejected";
}

/** Approve or reject. Approved decisions execute immediately (fire-and-forget). */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, decision } = (await request.json()) as DecideBody;
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { data } = await supabase.from("approvals").select("*").eq("id", id).single();
  const approval = data as Approval | null;
  if (!approval || approval.status !== "pending") {
    return NextResponse.json({ error: "approval not found or already decided" }, { status: 404 });
  }

  // Use the service client for follow-up writes (RLS-safe: scoped to this user).
  const svc = createServiceClient();
  await svc
    .from("approvals")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", id);

  if (decision === "rejected") {
    await handleReject(svc, user.id, approval);
  } else {
    // Fire-and-forget execution; respond immediately.
    void handleApprove(svc, user.id, approval).catch((err) =>
      console.error("approval execution failed:", err)
    );
  }
  return NextResponse.json({ ok: true, decision });
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
      if (!token) break;
      const ref = JSON.parse(approval.ref_id) as {
        agentId: string;
        repo: string;
        branch: string;
        base: string;
        summary: string;
        testsPassed: boolean;
        sandboxId?: string;
      };
      const octokit = new Octokit({ auth: token });
      const [o, r] = ref.repo.split("/");
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
      );
      break;
    }
    case "merge": {
      if (!token) break;
      const ref = JSON.parse(approval.ref_id) as {
        agentId: string;
        repo: string;
        prNumber: number;
        sandboxId?: string;
      };
      const octokit = new Octokit({ auth: token });
      const [o, r] = ref.repo.split("/");
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
      if (!token) break;
      const ref = JSON.parse(approval.ref_id) as { repo: string; number: string; body: string };
      const octokit = new Octokit({ auth: token });
      const [o, r] = ref.repo.split("/");
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
      const ref = JSON.parse(approval.ref_id) as { repo: string; issue_number?: string | number; reason?: string; comment?: string };
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
      const ref = JSON.parse(approval.ref_id) as { repo: string; pr_number?: string | number; comment?: string };
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
