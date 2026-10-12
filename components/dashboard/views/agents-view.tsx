"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Search } from "lucide-react";
import { SubAgent, Evaluation } from "@/types/orbit-types";
import { AgentCard } from "../agent-card";

type StatusFilter = "all" | SubAgent["status"];

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "awaiting_approval", label: "Needs approval" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

export function AgentsView() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [evals, setEvals] = useState<Record<string, Evaluation>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    try {
      const [aRes, eRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/agents?which=evaluations"),
      ]);
      if (aRes.ok) {
        const data = (await aRes.json()) as { agents: SubAgent[] };
        setAgents(data.agents ?? []);
      }
      if (eRes.ok) {
        const data = (await eRes.json()) as { evaluations: Evaluation[] };
        const map: Record<string, Evaluation> = {};
        for (const e of data.evaluations ?? []) map[e.sub_agent_id] = e;
        setEvals(map);
      }
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: agents.length,
      awaiting_approval: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const a of agents) c[a.status] += 1;
    return c;
  }, [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (!q) return true;
      const repo = ((a.result as { repo?: string } | undefined)?.repo ?? "").toLowerCase();
      return (
        a.title.toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q) ||
        a.status.replace(/_/g, " ").includes(q) ||
        repo.includes(q)
      );
    });
  }, [agents, query, filter]);

  const running = counts.running;

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Agents</h1>
          <p>
            {running} running · {counts.awaiting_approval} waiting for approval ·{" "}
            {agents.length} total sub-agents spawned by the orchestrator.
          </p>
        </div>
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Filter agents by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`chat-tab ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span className="item-meta">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="search-bar" role="search">
        <Search className="size-4" style={{ alignSelf: "center", color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, repo, kind, status…"
          aria-label="Search agents"
        />
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading agents…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="panel"><div className="panel-empty">
          {agents.length === 0
            ? "No sub-agents yet. Ask the orchestrator for work or wait for the next GitHub poll."
            : "No agents match this filter."}
        </div></section>
      )}

      <div className="agent-list">
        {filtered.map((a) => (
          <AgentCard key={a.id} agent={a} evaluation={evals[a.id]} onChanged={() => void load()} />
        ))}
      </div>
    </div>
  );
}
