import { OrbitTask, TaskStatus, OrbitStats } from "@/types/orbit-types";

export function filterTasks(
  tasks: OrbitTask[],
  filter: "all" | TaskStatus,
  searchQuery: string
): OrbitTask[] {
  const query = searchQuery.trim().toLowerCase();

  return tasks.filter((task) => {
    const matchesFilter = filter === "all" || task.status === filter;
    const matchesQuery =
      !query ||
      task.title.toLowerCase().includes(query) ||
      task.repo_name.toLowerCase().includes(query) ||
      task.assigned_agent.toLowerCase().includes(query);

    return matchesFilter && matchesQuery;
  });
}

export function computeTaskCounts(tasks: OrbitTask[]) {
  return {
    all: tasks.length,
    running: tasks.filter((t) => t.status === "running").length,
    review: tasks.filter((t) => t.status === "review").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  };
}

export function computeOrbitStats(tasks: OrbitTask[]): OrbitStats {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const running = tasks.filter((t) => t.status === "running").length;
  return {
    activeAgents: running,
    tasksCompleted: completed,
    prsMerged: 0,
    avgScore: 0,
  };
}
