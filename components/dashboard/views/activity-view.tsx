"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { GitPullRequest, Sparkles, Brain, CircleDot, Loader2, Search } from "lucide-react";
import { OrbitActivity } from "@/types/orbit-types";

export function ActivityView() {
  const [activities, setActivities] = useState<OrbitActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=100");
      if (!res.ok) return;
      const data = (await res.json()) as { activities: OrbitActivity[] };
      setActivities(data.activities ?? []);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
    );
  }, [activities, query]);

  const renderIcon = (type: OrbitActivity["type"]) => {
    switch (type) {
      case "pr":
        return <GitPullRequest className="size-3.5" />;
      case "sparkles":
        return <Sparkles className="size-3.5" />;
      case "brain":
        return <Brain className="size-3.5" />;
      case "issue":
      default:
        return <CircleDot className="size-3.5" />;
    }
  };

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Activity</h1>
          <p>Everything happening in your orbit — agent proposals, runs, PRs, evaluations.</p>
        </div>
      </div>

      <div className="search-bar" role="search">
        <Search className="size-4" style={{ alignSelf: "center", color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${activities.length} events…`}
          aria-label="Search activity"
        />
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading activity…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="panel"><div className="panel-empty">
          {activities.length === 0
            ? "Nothing yet. Activity from agents, polls, and evaluations will stream in here."
            : `No activity matches "${query.trim()}".`}
        </div></section>
      )}

      <section className="panel">
        <div className="activity-list activity-full">
          {filtered.map((act) => (
            <div key={act.id} className="activity">
              {renderIcon(act.type)}
              <div>
                <p>{act.title}</p>
                <small>
                  {act.description}
                  {act.created_at && (
                    <> · <span className="mono">{new Date(act.created_at).toLocaleString()}</span></>
                  )}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
