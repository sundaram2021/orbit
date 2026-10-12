import React from "react";
import { GitPullRequest, Check, Clock, ChevronRight } from "lucide-react";
import { OrbitTask } from "@/types/orbit-types";
import { LiveDot } from "@/components/common/live-dot";
import { getStatusBadgeClass } from "@/lib/format-helpers";

interface TaskRowItemProps {
  task: OrbitTask;
  onClick: (task: OrbitTask) => void;
}

export function TaskRowItem({ task, onClick }: TaskRowItemProps) {
  const isCompleted = task.status === "completed";
  const isReview = task.status === "review";
  const isRunning = task.status === "running";

  return (
    <div
      className="task-row"
      role="button"
      tabIndex={0}
      onClick={() => onClick(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(task);
      }}
    >
      <span className="task-icon">
        {isCompleted ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <GitPullRequest className="size-3.5" />
        )}
      </span>

      <div className="task-text">
        <h3>{task.title}</h3>
        <div className="task-meta">
          <span>{task.repo_name}</span>
          {task.issue_number && <span>#{task.issue_number}</span>}
          <span>{task.assigned_agent}</span>
        </div>
      </div>

      <span className={getStatusBadgeClass(task.status)}>
        {isRunning && <LiveDot />}
        {isReview && <Clock className="size-2.5" />}
        {isCompleted && <Check className="size-2.5" />}
        <span className="capitalize">{task.status === "review" ? "In review" : task.status}</span>
      </span>

      <ChevronRight className="size-3 text-muted-foreground" />
    </div>
  );
}
