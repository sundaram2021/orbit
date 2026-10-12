"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Brain, Loader2, Search, ChevronDown } from "lucide-react";
import { SubAgent, Evaluation } from "@/types/orbit-types";

type StatusFilter = "all" | Evaluation["status"];

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "proposed", label: "Proposed" },
  { id: "applied", label: "Applied" },
  { id: "dismissed", label: "Dismissed" },
];

function extractRepo(systemPrompt: string): string | null {
  const m = systemPrompt.match(/Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  return m ? m[1] : null;
}

export function EvaluatorView() {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [agents, setAgents] = useState<Record<string, SubAgent>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eRes, aRes] = await Promise.all([
        fetch("/api/agents?which=evaluations"),
        fetch("/api/agents"),
      ]);
      if (eRes.ok) {
        const data = (await eRes.json()) as { evaluations: Evaluation[] };
        setEvaluations(data.evaluations ?? []);
      }
      if (aRes.ok) {
        const data = (await aRes.json()) as { agents: SubAgent[] };
        const map: Record<string, SubAgent> = {};
        for (const a of data.agents ?? []) map[a.id] = a;
        setAgents(map);
      }
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

  const avg = useMemo(
    () =>
      evaluations.length
        ? Math.round(
            (evaluations.reduce((s, e) => s + Number(e.score), 0) / evaluations.length) * 10
          ) / 10
        : 0,
    [evaluations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return evaluations.filter((e) => {
      if (filter !== "all" && e.status !== filter) return false;
      if (!q) return true;
      const a = agents[e.sub_agent_id];
      return (
        (a?.title ?? "").toLowerCase().includes(q) ||
        (a?.kind ?? "").toLowerCase().includes(q) ||
        (e.summary ?? "").toLowerCase().includes(q)
      );
    });
  }, [evaluations, agents, query, filter]);

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Evaluator</h1>
          <p>
            {evaluations.length} evaluations · mean score {avg}. Every finished agent is scored
            automatically from its prompt, run log, and output — improvements apply directly.
          </p>
        </div>
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Filter evaluations by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`chat-tab ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="search-bar" role="search">
        <Search className="size-4" style={{ alignSelf: "center", color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by agent, kind, or finding…"
          aria-label="Search evaluations"
        />
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading evaluations…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="panel">
          <div className="panel-empty">
            {evaluations.length === 0
              ? "No evaluations yet. They appear here automatically when agents finish."
              : "No evaluations match this filter."}
          </div>
        </section>
      )}

      <div className="agent-list">
        {filtered.map((e) => {
          const a = agents[e.sub_agent_id];
          const isOpen = expanded === e.id;
          const repo = a ? extractRepo(a.system_prompt) : null;
          const rubricEntries = Object.entries(e.rubric ?? {}).filter(
            ([, v]) => typeof v === "number"
          ) as [string, number][];
          return (
            <section key={e.id} className="panel agent-card">
              <button
                type="button"
                className="agent-card-head"
                onClick={() => setExpanded(isOpen ? null : e.id)}
                aria-expanded={isOpen}
              >
                <span className="agent-kind-icon">
                  <Brain className="size-4" />
                </span>
                <div>
                  <p>
                    {a?.title ?? "Unknown agent"}{" "}
                    <span className="eval-score-inline">{e.score}/100</span>
                  </p>
                  <div className="agent-meta">
                    {a?.kind && <span>{a.kind}</span>}
                    {repo && <span className="mono">{repo}</span>}
                    {e.created_at && (
                      <span className="item-meta">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`status-badge status-${e.status === "applied" ? "completed" : e.status === "dismissed" ? "failed" : "awaiting_approval"}`}>
                  {e.status}
                </span>
              </button>

              {isOpen && (
                <div className="agent-card-body">
                  <h4>Verdict</h4>
                  <p>{e.summary || "—"}</p>

                  {rubricEntries.length > 0 && (
                    <>
                      <h4>Score breakdown</h4>
                      <div className="rubric-bars">
                        {rubricEntries.map(([name, value]) => (
                          <div key={name} className="rubric-row">
                            <span>{name.replace(/_/g, " ")}</span>
                            <div className="rubric-track">
                              <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                            </div>
                            <em>{value}</em>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <h4>Evaluated evidence</h4>
                  <p>
                    Kind template · whole customized prompt ({(a?.system_prompt ?? "").length} chars)
                    {" · "}
                    run log {a?.run_log ? "reviewed" : "missing"}
                    {" · "}
                    output {e.summary ? "reviewed" : "missing"}
                  </p>
                  {a?.system_prompt && (
                    <details className="eval-details">
                      <summary>View the evaluated prompt <ChevronDown className="size-3" /></summary>
                      <pre>{a.system_prompt.slice(0, 3000)}</pre>
                    </details>
                  )}

                  <h4>Recommendations</h4>
                  {!e.prompt_patch && (
                    <p>No changes recommended — prompts stay as they are.</p>
                  )}
                  {e.prompt_patch && (
                    <>
                      <p><strong>Prompt improvement</strong> (applied directly{e.status === "applied" ? "" : " — pending"})</p>
                      <pre>{e.prompt_patch}</pre>
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
