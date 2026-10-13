"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Radio, Clock, Zap, Star } from "lucide-react";
import { GithubIcon } from "@/components/common/github-icon";
import { SubAgent, Evaluation, GithubEvent, UserSettings } from "@/types/orbit-types";

interface StatusData {
  awaiting: number;
  running: number;
  completedToday: number;
  avgScore: number;
  lastEventAt: string | null;
  stale: boolean;
  autoApprove: boolean;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function OrchestratorStatus() {
  const [data, setData] = useState<StatusData | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, eRes, evRes, sRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/agents?which=evaluations"),
        fetch("/api/agents?which=events"),
        fetch("/api/settings"),
      ]);
      if (!aRes.ok) return;
      const { agents } = (await aRes.json()) as { agents: SubAgent[] };
      const evals = eRes.ok
        ? (((await eRes.json()) as { evaluations: Evaluation[] }).evaluations ?? [])
        : [];
      const events = evRes.ok
        ? (((await evRes.json()) as { events: GithubEvent[] }).events ?? [])
        : [];
      const settings = sRes.ok
        ? (((await sRes.json()) as { settings: UserSettings }).settings)
        : null;
      const today = new Date().toISOString().slice(0, 10);
      let awaiting = 0;
      let running = 0;
      let completedToday = 0;
      for (const a of agents) {
        if (a.status === "awaiting_approval") awaiting++;
        else if (a.status === "running") running++;
        else if (a.status === "completed" && (a.created_at ?? "").slice(0, 10) === today) completedToday++;
      }
      let scoreSum = 0;
      let scoreCount = 0;
      for (const e of evals) {
        const n = Number(e.score);
        if (!Number.isNaN(n)) {
          scoreSum += n;
          scoreCount++;
        }
      }
      const lastEventAt = events[0]?.created_at ?? null;
      setData({
        awaiting,
        running,
        completedToday,
        avgScore: scoreCount
          ? Math.round((scoreSum / scoreCount) * 10) / 10
          : 0,
        lastEventAt,
        stale: lastEventAt
          ? Date.now() - new Date(lastEventAt).getTime() > 10 * 60 * 1000
          : true,
        autoApprove: settings?.orchestrator_auto_approve ?? false,
      });
    } catch {
      // strip stays empty on error
    }
  }, []);

  useEffect(() => {
    // Intentional: fetch status on mount, then poll + refresh events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(load, 15000);
    const onRefresh = () => void load();
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  const stale = data?.stale ?? true;

  return (
    <section className="panel status-strip" aria-label="Orchestrator status">
      <div className="status-item">
        <GithubIcon className="size-4" />
        <div>
          <p>GitHub live</p>
          <small>OAuth connected</small>
        </div>
      </div>
      <div className="status-item" title={stale ? "No GitHub events seen for a while — check the poller" : "Poller is delivering events"}>
        <Radio className="size-4" />
        <div>
          <p>Poll {data ? timeAgo(data.lastEventAt) : "…"}</p>
          <small className={stale ? "status-warn" : ""}>{stale ? "stale — check cron" : "healthy"}</small>
        </div>
      </div>
      <div className="status-item">
        <Clock className="size-4" />
        <div>
          <p>{data ? `${data.awaiting} waiting · ${data.running} running` : "…"}</p>
          <small>{data ? `${data.completedToday} completed today` : "loading"}</small>
        </div>
      </div>
      <div className="status-item">
        <Star className="size-4" />
        <div>
          <p>{data ? (data.avgScore > 0 ? `${data.avgScore}/100` : "no scores") : "…"}</p>
          <small>mean eval score</small>
        </div>
      </div>
      <div className="status-item">
        <Zap className="size-4" />
        <div>
          <p>Auto-approve {data ? (data.autoApprove ? "on" : "off") : "…"}</p>
          <small>settings → automation</small>
        </div>
      </div>
    </section>
  );
}

const STAGES = ["Event", "Proposed", "Approved", "Running", "PR opened", "Evaluated"];

export function PipelineStages({ counts }: { counts?: number[] }) {
  return (
    <section className="panel pipeline" aria-label="Agent pipeline">
      {STAGES.map((label, i) => (
        <React.Fragment key={label}>
          <div className="pipe-stage">
            <strong>{counts?.[i] ?? "·"}</strong>
            <span>{label}</span>
          </div>
          {i < STAGES.length - 1 && <span className="pipe-link" />}
        </React.Fragment>
      ))}
    </section>
  );
}
