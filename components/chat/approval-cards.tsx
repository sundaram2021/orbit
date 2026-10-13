"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bot, Check, X, Loader2 } from "lucide-react";
import { Approval } from "@/types/orbit-types";
import { Skeleton, FetchError } from "@/components/common/loading";

interface AgentInfo {
  id: string;
  title: string;
  kind: string;
}

function safeRef(refId: string): { repo: string; num: string; preview: string } {
  try {
    const ref = JSON.parse(refId) as Record<string, unknown>;
    const repo = String(ref.repo ?? "");
    const num = String(ref.issue_number ?? ref.pr_number ?? ref.number ?? "?");
    const preview = String(ref.comment ?? ref.body ?? "").slice(0, 100);
    return { repo, num, preview };
  } catch {
    return { repo: "", num: "?", preview: "" };
  }
}

/**
 * Pending agent-run approvals, shown inside the orchestrator chat itself so
 * the user can approve/reject without opening the notifications bell.
 * Refreshes on the global orbit:refresh event + a 15s poll fallback.
 */
export function ApprovalCards() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, gRes] = await Promise.all([
        fetch("/api/approvals?status=pending"),
        fetch("/api/agents?which=agents"),
      ]);
      if (aRes.ok) {
        const data = (await aRes.json()) as { approvals: Approval[] };
        setApprovals(
          (data.approvals ?? []).filter(
            (a) =>
              a.kind === "run_agent" ||
              a.kind === "publish_pr" ||
              a.kind === "merge" ||
              a.kind === "close_issue" ||
              a.kind === "close_pr" ||
              a.kind === "github_comment"
          )
        );
      }
      if (gRes.ok) {
        const data = (await gRes.json()) as { agents: AgentInfo[] };
        const map: Record<string, AgentInfo> = {};
        for (const a of data.agents ?? []) map[a.id] = a;
        setAgents(map);
      }
    } catch {
      // approval cards must never break the chat
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional: fetch approvals on mount, then poll + refresh events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 10000);
    const onRefresh = () => void load().catch(() => {});
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setDeciding(id);
    setDecideError(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `decide failed (${res.status})`);
      }
    } catch (err) {
      // Decision failed — keep the card so the user can retry, with a reason.
      setDecideError((err as Error).message);
      setDeciding(null);
      return;
    }
    setDeciding(null);
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    window.dispatchEvent(
      new CustomEvent("orbit:toast", {
        detail: {
          id: `toast-${id}`,
          title: decision === "approved" ? "Action Approved" : "Action Rejected",
          body:
            decision === "approved"
              ? "Agent started — running in sandbox."
              : "Agent run was rejected.",
        },
      })
    );
    window.dispatchEvent(new Event("orbit:refresh"));
  };

  if (isLoading) {
    return (
      <div className="approval-cards" aria-busy="true" aria-label="Pending approvals">
        <div className="approval-card space-y-2 p-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (approvals.length === 0) return null;

  return (
    <div className="approval-cards" aria-label="Pending approvals">
      {decideError ? <FetchError message={decideError} /> : null}
      {approvals.map((a) => {
        const agent = agents[a.ref_id];
        const busy = deciding === a.id;

        let cardTitle = "Your agent is ready";
        let cardSubtitle = "Approve to run it in a sandbox.";
        let actionLabel = "Approve & run";

        if (a.kind === "run_agent") {
          if (agent) {
            cardTitle = `Agent ready: ${agent.title}`;
            cardSubtitle =
              agent.kind === "review"
                ? "Review agent · Approve to inspect and review PR."
                : "Implementation agent · Approve to resolve issue and open PR.";
          }
        } else if (a.kind === "publish_pr") {
          cardTitle = "Work ready: Publish Pull Request";
          cardSubtitle = "Sandbox completed changes. Approve to open PR.";
          actionLabel = "Approve & open PR";
        } else if (a.kind === "merge") {
          cardTitle = "Pull Request ready to merge";
          cardSubtitle = "Tests verified. Approve to squash-merge PR.";
          actionLabel = "Approve & merge";
        } else if (a.kind === "close_issue") {
          const ref = safeRef(a.ref_id);
          cardTitle = `Close issue #${ref.num} in ${ref.repo}`;
          cardSubtitle = "Destructive action — approve to close on GitHub.";
          actionLabel = "Approve & close issue";
        } else if (a.kind === "close_pr") {
          const ref = safeRef(a.ref_id);
          cardTitle = `Close PR #${ref.num} in ${ref.repo}`;
          cardSubtitle = "Closes without merging — approve to close on GitHub.";
          actionLabel = "Approve & close PR";
        } else if (a.kind === "github_comment") {
          const ref = safeRef(a.ref_id);
          cardTitle = `Post comment on ${ref.repo}#${ref.num}`;
          cardSubtitle = ref.preview ? `"${ref.preview}"` : "Approve to post the comment.";
          actionLabel = "Approve & comment";
        }

        return (
          <div key={a.id} className="approval-card">
            <span className="approval-card-icon">
              <Bot className="size-4" />
            </span>
            <div className="approval-card-body">
              <p>{cardTitle}</p>
              <small>{cardSubtitle}</small>
              <div className="approval-card-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(a.id, "approved")}
                  className="approval-approve"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {actionLabel}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(a.id, "rejected")}
                  className="approval-reject"
                  aria-label="Reject agent run"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
