import React from "react";
import { Search } from "lucide-react";
import { OrbitTask, TaskStatus } from "@/types/orbit-types";
import { TaskRowItem } from "./task-row-item";

interface TaskPanelProps {
  tasks: OrbitTask[];
  filter: "all" | TaskStatus;
  setFilter: (f: "all" | TaskStatus) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSelectTask: (task: OrbitTask) => void;
}

export function TaskPanel({
  tasks,
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  onSelectTask,
}: TaskPanelProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          Tasks <span className="muted mono">{tasks.length}</span>
        </h2>
        <span>Updated just now</span>
      </div>

      <div className="task-filter">
        <button
          type="button"
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={filter === "running" ? "selected" : ""}
          onClick={() => setFilter("running")}
        >
          Running
        </button>
        <button
          type="button"
          className={filter === "review" ? "selected" : ""}
          onClick={() => setFilter("review")}
        >
          In review
        </button>
        <button
          type="button"
          className={filter === "completed" ? "selected" : ""}
          onClick={() => setFilter("completed")}
        >
          Completed
        </button>

        <label className="search-input">
          <Search className="size-3" />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      <div>
        {tasks.length === 0 ? (
          <div className="empty-state">No matching tasks found.</div>
        ) : (
          tasks.map((task) => (
            <TaskRowItem key={task.id} task={task} onClick={onSelectTask} />
          ))
        )}
      </div>
    </section>
  );
}
