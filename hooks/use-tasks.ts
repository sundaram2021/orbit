"use client";

import { useState, useMemo } from "react";
import { OrbitTask, TaskStatus } from "@/types/orbit-types";
import { filterTasks, computeTaskCounts, computeOrbitStats } from "@/lib/task-helpers";
import { createBrowserTask } from "@/lib/supabase-helpers";

export function useTasks(initialTasks: OrbitTask[] = []) {
  const [tasks, setTasks] = useState<OrbitTask[]>(initialTasks);
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredTasks = useMemo(() => {
    return filterTasks(tasks, filter, searchQuery);
  }, [tasks, filter, searchQuery]);

  const counts = useMemo(() => {
    return computeTaskCounts(tasks);
  }, [tasks]);

  const stats = useMemo(() => {
    return computeOrbitStats(tasks);
  }, [tasks]);

  const addNewTask = async (taskData: {
    title: string;
    description: string;
    repo_name: string;
    assigned_agent: string;
  }) => {
    setIsSubmitting(true);
    try {
      const newTask = await createBrowserTask({
        ...taskData,
        status: "running",
        issue_number: Math.floor(100 + Math.random() * 900),
      });
      setTasks((prev) => [newTask, ...prev]);
      return newTask;
    } catch {
      // Optimistic fallback for local preview
      const fallbackTask: OrbitTask = {
        id: `local-${Date.now()}`,
        ...taskData,
        status: "running",
        issue_number: Math.floor(100 + Math.random() * 900),
        created_at: new Date().toISOString(),
      };
      setTasks((prev) => [fallbackTask, ...prev]);
      return fallbackTask;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    tasks,
    filteredTasks,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    counts,
    stats,
    isSubmitting,
    addNewTask,
  };
}
