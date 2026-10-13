"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { GitPullRequest, Sparkles, Brain, CircleDot, Loader2, Search } from "lucide-react";
import { OrbitActivity } from "@/types/orbit-types";

const TYPE_ICON: Record<string, React.ReactNode> = {
  pr: <GitPullRequest className="size-3.5" />,
  sparkles: <Sparkles className="size-3.5" />,
  brain: <Brain className="size-3.5" />,
  issue: <CircleDot className="size-3.5" />,
};

const ACTIVITY_EMPTY = (
  <section className="panel"><div className="panel-empty">
    Nothing yet. Activity from agents, polls, and evaluations will stream in here.
  </div></section>
);

export function ActivityView() {
  const [activities, setActivities] = useState<OrbitActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = React.useDeferredValue(query);

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
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
    );
  }, [activities, deferredQuery]);

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

      {isLoading ? (
        <div className="chat-loading">
          <span className="inline-flex animate-spin"><Loader2 className="size-4" /></span> Loading activity…
        </div>
      ) : null}

      {!isLoading && filtered.length === 0 ? (
        activities.length === 0 ? ACTIVITY_EMPTY : (
          <section className="panel"><div className="panel-empty">
            {`No activity matches "${deferredQuery.trim()}".`}
          </div></section>
        )
      ) : null}

      <section className="panel">
        <div className="activity-list activity-full">
          {filtered.map((act) => (
            <div key={act.id} className="activity" style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}>
              {TYPE_ICON[act.type] ?? <CircleDot className="size-3.5" />}
              <div>
                <p>{act.title}</p>
                <small>
                  {act.description}
                  {act.created_at ? (
                    <> · <span className="mono">{new Date(act.created_at).toLocaleString()}</span></>
                  ) : null}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
