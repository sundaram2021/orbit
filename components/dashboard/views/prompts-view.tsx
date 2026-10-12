"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ScrollText, Loader2, Search, ChevronDown } from "lucide-react";

interface CustomizedPrompt {
  id: string;
  title: string;
  kind: string;
  status: string;
  system_prompt: string;
  eval_score: number | null;
  created_at: string;
}

export function PromptsView() {
  const [prompts, setPrompts] = useState<CustomizedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data: { prompts: CustomizedPrompt[] }) => setPrompts(data.prompts ?? []))
      .catch(() => setPrompts([]))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q) ||
        p.system_prompt.toLowerCase().includes(q)
    );
  }, [prompts, query]);

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Customized Prompts</h1>
          <p>
            Every detailed prompt the orchestrator wrote for its sub-agents — title plus the
            whole prompt. This is what customizes each agent; there are no skills.
          </p>
        </div>
      </div>

      <div className="search-bar" role="search">
        <Search className="size-4" style={{ alignSelf: "center", color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}…`}
          aria-label="Search customized prompts"
        />
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading prompts…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="panel"><div className="panel-empty">
          {prompts.length === 0
            ? "No customized prompts yet. Spawn an agent and its prompt will be listed here."
            : `No prompts match "${query.trim()}".`}
        </div></section>
      )}

      <div className="agent-list">
        {filtered.map((p) => {
          const isOpen = expanded === p.id;
          return (
            <section key={p.id} className="panel agent-card">
              <button
                type="button"
                className="agent-card-head"
                onClick={() => setExpanded(isOpen ? null : p.id)}
                aria-expanded={isOpen}
              >
                <span className="agent-kind-icon">
                  <ScrollText className="size-4" />
                </span>
                <div>
                  <p>{p.title}</p>
                  <div className="agent-meta">
                    <span>{p.kind}</span>
                    <span className="item-meta">{p.status.replace(/_/g, " ")}</span>
                    {p.eval_score != null && (
                      <span className="item-meta">score {p.eval_score}</span>
                    )}
                    {p.created_at && (
                      <span className="item-meta">
                        {new Date(p.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className="size-4" />
              </button>

              {isOpen && (
                <div className="agent-card-body">
                  <h4>Whole detailed prompt</h4>
                  <pre>{p.system_prompt || "(empty prompt)"}</pre>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
