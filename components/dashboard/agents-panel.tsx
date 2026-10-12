"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bot, Loader2 } from "lucide-react";
import { SubAgent } from "@/types/orbit-types";

const STATUS_LABEL: Record<SubAgent["status"], string> = {
  awaiting_approval: "Awaiting approval",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function AgentsPanel() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = (await res.json()) as { agents: SubAgent[] };
      setAgents(data.agents ?? []);
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

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Sub-agents</h2>
        <span className="mono">{agents.filter((a) => a.status === "running").length} RUNNING</span>
      </div>

      <div className="activity-list">
        {isLoading && (
          <div className="chat-loading">
            <Loader2 className="size-4 animate-spin" /> Loading agents…
          </div>
        )}
        {!isLoading && agents.length === 0 && (
          <div className="chat-empty">
            No sub-agents yet. Polled GitHub events and orchestrator chat requests will spawn them here.
          </div>
        )}
        {agents.map((a) => (
          <div key={a.id} className="activity">
            <Bot className="size-3.5" />
            <div>
              <p>
                {a.title} <span className={`status-badge status-${a.status}`}>{STATUS_LABEL[a.status]}</span>
              </p>
              <small>
                {a.kind} · {a.skills.join(", ") || "no skills"}
                {a.eval_score != null && ` · score ${a.eval_score}`}
              </small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
