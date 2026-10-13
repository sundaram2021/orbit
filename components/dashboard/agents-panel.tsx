"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bot } from "lucide-react";
import { SubAgent } from "@/types/orbit-types";
import { RowSkeleton, FetchError } from "@/components/common/loading";

const STATUS_LABEL: Record<SubAgent["status"], string> = {
  awaiting_approval: "Awaiting approval",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function AgentsPanel() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as { agents: SubAgent[] };
      setAgents(data.agents ?? []);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load agents. Retry.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 15000);
    const onRefresh = () => void load().catch(() => {});
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

      <div className="item-list">
        {isLoading ? (
          <div aria-busy="true">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : null}
        {loadError && !isLoading ? (
          <FetchError message={loadError} onRetry={handleRetry} />
        ) : null}
        {!isLoading && !loadError && agents.length === 0 && (
          <div className="panel-empty">
            No sub-agents yet. Polled GitHub events and orchestrator chat requests will spawn them here.
          </div>
        )}
        {agents.map((a) => (
          <div key={a.id} className="item">
            <Bot className="size-3.5" />
            <div className="item-body">
              <div className="item-title">
                {a.title} <span className={`status-badge status-${a.status}`}>{STATUS_LABEL[a.status]}</span>
              </div>
              <div className="item-desc">
                {a.kind}
                {a.eval_score != null && ` · score ${a.eval_score}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
