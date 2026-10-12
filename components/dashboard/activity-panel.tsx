import React from "react";
import { GitPullRequest, Sparkles, Brain, CircleDot, ArrowRight } from "lucide-react";
import { OrbitActivity } from "@/types/orbit-types";

interface ActivityPanelProps {
  activities: OrbitActivity[];
}

export function ActivityPanel({ activities }: ActivityPanelProps) {
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
    <section className="panel">
      <div className="panel-heading">
        <h2>Activity</h2>
        <span className="mono">LIVE FEED</span>
      </div>

      <div className="activity-list">
        {activities.map((act) => (
          <div key={act.id} className="activity">
            {renderIcon(act.type)}
            <div>
              <p>{act.title}</p>
              <small>{act.description}</small>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 w-full rounded-none text-xs border-t border-border"
      >
        View all activity <ArrowRight className="size-3.5" />
      </button>
    </section>
  );
}
