"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Sparkles, Loader2, Search } from "lucide-react";

interface Skill {
  name: string;
  definition: string;
  updated_at: string;
  used_by_agents: number;
}

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data: { skills: Skill[] }) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.definition.toLowerCase().includes(q)
    );
  }, [skills, query]);

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Skills</h1>
          <p>Every skill the orchestrator picked or created for its sub-agents. The evaluator adds more over time.</p>
        </div>
      </div>

      <div className="search-bar" role="search">
        <Search className="size-4" style={{ alignSelf: "center", color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${skills.length} skill${skills.length === 1 ? "" : "s"}…`}
          aria-label="Search skills"
        />
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading skills…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="panel"><div className="panel-empty">
          {skills.length === 0
            ? "No skills yet. Spawn an agent and its skills will be listed here."
            : `No skills match "${query.trim()}".`}
        </div></section>
      )}

      <div className="skills-grid">
        {filtered.map((s) => (
          <section key={s.name} className="panel skill-card">
            <div className="panel-heading">
              <h2><Sparkles className="size-3.5" /> {s.name}</h2>
              <span className="mono">{s.used_by_agents} AGENT{s.used_by_agents === 1 ? "" : "S"}</span>
            </div>
            <p>{s.definition}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
