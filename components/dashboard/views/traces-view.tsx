"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { SubAgent } from "@/types/orbit-types";

export function TracesView() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = (await res.json()) as { agents: SubAgent[] };
      setAgents((data.agents ?? []).filter((a) => a.run_log));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    const onRefresh = () => void load();
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Traces</h1>
          <p>Every step of every sub-agent run, captured in the execution log.</p>
        </div>
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading traces…
        </div>
      )}

      {!isLoading && agents.length === 0 && (
        <section className="panel"><div className="panel-empty">
          No traces yet. Run an agent and its full execution log will appear here.
        </div></section>
      )}

      {agents.map((a) => (
        <section key={a.id} className="panel">
          <div className="panel-heading">
            <h2>{a.title}</h2>
            <span className="mono">{a.eval_score != null ? `SCORE ${a.eval_score}` : (a.status ?? "").toUpperCase().replace(/_/g, " ")}</span>
          </div>
          <div className="memory-result">
            {(a.run_log ?? "").split("\n").slice(0, 40).map((line, i) => (
              <p key={i}>{line || "\u00A0"}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
