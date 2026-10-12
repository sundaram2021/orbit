"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Check, X, Loader2 } from "lucide-react";
import { Approval, ApprovalKind } from "@/types/orbit-types";

const KIND_LABELS: Record<ApprovalKind, string> = {
  run_agent: "Run agent",
  publish_pr: "Open PR",
  merge: "Merge PR",
  github_comment: "Post comment",
};

function describeApproval(a: Approval): string {
  try {
    const ref = JSON.parse(a.ref_id) as Record<string, unknown>;
    if (a.kind === "publish_pr" && typeof ref.branch === "string") {
      return `Branch ${ref.branch} in ${String(ref.repo ?? "")} is ready to become a PR.`;
    }
    if (a.kind === "merge" && typeof ref.prNumber !== "undefined") {
      return `Merge PR #${String(ref.prNumber)} in ${String(ref.repo ?? "")}.`;
    }
  } catch {
    // ref_id is a plain id
  }
  if (a.kind === "run_agent") return "A sub-agent is ready and waiting to start work.";
  return "Waiting for your decision.";
}

export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals?status=pending");
      if (!res.ok) return;
      const data = (await res.json()) as { approvals: Approval[] };
      setApprovals(data.approvals ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
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
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setDeciding(null);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Approvals {approvals.length > 0 && <span className="approval-count">{approvals.length}</span>}</h2>
        <ShieldCheck className="size-3.5" />
      </div>

      <div className="item-list">
        {isLoading && (
          <div className="chat-loading">
            <Loader2 className="size-4 animate-spin" /> Loading approvals…
          </div>
        )}
        {!isLoading && approvals.length === 0 && (
          <div className="panel-empty">Nothing waiting. New agent proposals and tuning suggestions will appear here.</div>
        )}
        {approvals.map((a) => (
          <div key={a.id} className="item">
            <div className="item-body">
              <div className="item-title">
                {KIND_LABELS[a.kind]} <span className="item-meta">{new Date(a.created_at ?? "").toLocaleString()}</span>
              </div>
              <div className="item-desc">{describeApproval(a)}</div>
              <div className="approval-actions">
                <button
                  type="button"
                  disabled={deciding === a.id}
                  onClick={() => void decide(a.id, "approved")}
                  className="approval-btn approval-approve"
                >
                  <Check className="size-3.5" /> Approve
                </button>
                <button
                  type="button"
                  disabled={deciding === a.id}
                  onClick={() => void decide(a.id, "rejected")}
                  className="approval-btn approval-reject"
                >
                  <X className="size-3.5" /> Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
