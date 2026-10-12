import React from "react";
import { Cpu, Check, GitPullRequest, Activity } from "lucide-react";
import { OrbitStats } from "@/types/orbit-types";

interface DashboardStatsProps {
  stats: OrbitStats;
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-label">
          Active agents
          <Cpu className="size-3.5" />
        </div>
        <div className="stat-value">{stats.activeAgents}</div>
        <div className="stat-foot">
          <em>live</em> sub-agents running now
        </div>
      </div>

      <div className="stat">
        <div className="stat-label">
          Tasks completed
          <Check className="size-3.5" />
        </div>
        <div className="stat-value">{stats.tasksCompleted}</div>
        <div className="stat-foot">
          tasks + agent runs <em>completed</em>
        </div>
      </div>

      <div className="stat">
        <div className="stat-label">
          Pull requests merged
          <GitPullRequest className="size-3.5" />
        </div>
        <div className="stat-value">{stats.prsMerged}</div>
        <div className="stat-foot">
          agent runs <em>shipped</em>
        </div>
      </div>

      <div className="stat">
        <div className="stat-label">
          Avg. evaluation score
          <Activity className="size-3.5" />
        </div>
        <div className="stat-value">{stats.avgScore}</div>
        <div className="stat-foot">
          mean evaluator <em>score</em>
        </div>
      </div>
    </div>
  );
}
