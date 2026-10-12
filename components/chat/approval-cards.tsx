"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bot, Check, X, Loader2 } from "lucide-react";
import { Approval } from "@/types/orbit-types";

interface AgentInfo {
  id: string;
  title: string;
  kind: string;
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
            (a) => a.kind === "run_agent" || a.kind === "publish_pr" || a.kind === "merge"
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
    }
  }, []);

  useEffect(() => {
    // Intentional: fetch approvals on mount, then poll + refresh events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(load, 10000);
    const onRefresh = () => void load();
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setDeciding(id);
    try {
      await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
    } catch {
      // decision failed — keep the card so the user can retry
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

  if (approvals.length === 0) return null;

  return (
    <div className="approval-cards" aria-label="Pending approvals">
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
