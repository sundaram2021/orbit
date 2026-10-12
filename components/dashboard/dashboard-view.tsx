"use client";

import React, { useState, useEffect } from "react";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser } from "@/types/orbit-types";
import { useAuth } from "@/hooks/use-auth";
import { useModal } from "@/hooks/use-modal";
import { createOrbitBrowserClient } from "@/lib/supabase-client";
import { createBrowserTask } from "@/lib/supabase-helpers";
import { Toaster } from "@/components/common/toaster";
import { DashboardSidebar, OrbitNav } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { TaskModal } from "./task-modal";
import { OrchestratorView } from "./views/orchestrator-view";
import { AgentsView } from "./views/agents-view";
import { SkillsView } from "./views/skills-view";
import { TracesView } from "./views/traces-view";
import { EvaluatorView } from "./views/evaluator-view";
import { MemoryView } from "./views/memory-view";
import { ActivityView } from "./views/activity-view";
import { SettingsView } from "./views/settings-view";

interface DashboardViewProps {
  initialUser: OrbitUser | null;
  initialTasks: OrbitTask[];
  initialActivities: OrbitActivity[];
  initialRepositories: OrbitRepo[];
}

export function DashboardView({
  initialUser,
  initialRepositories,
}: DashboardViewProps) {
  const { user, logout } = useAuth(initialUser);
  const [activeNav, setActiveNav] = useState<OrbitNav>("orchestrator");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const taskModal = useModal();

  useEffect(() => {
    // Realtime: nudge all views the moment anything changes.
    const supabase = createOrbitBrowserClient();
    const channel = supabase
      .channel("orbit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sub_agents" }, () =>
        window.dispatchEvent(new Event("orbit:refresh"))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () =>
        window.dispatchEvent(new Event("orbit:refresh"))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "github_events" }, () =>
        window.dispatchEvent(new Event("orbit:refresh"))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, () =>
        window.dispatchEvent(new Event("orbit:refresh"))
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // "New task" keeps a task row AND proposes a sub-agent through the pipeline.
  const dispatchTask = async (data: {
    title: string;
    description: string;
    repo_name: string;
    assigned_agent: string;
  }) => {
    try {
      await createBrowserTask({
        title: data.title,
        description: data.description,
        repo_name: data.repo_name,
        assigned_agent: data.assigned_agent,
        status: "running",
        issue_number: Math.floor(100 + Math.random() * 900),
      });
    } catch {
      // task row is best-effort; the agent proposal matters
    }
    try {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: data.repo_name,
          title: data.title,
          description: data.description,
        }),
      });
    } catch {
      // proposal can be retried from orchestrator chat
    }
    window.dispatchEvent(new Event("orbit:refresh"));
  };

  return (
    <main className="dashboard">
      <Toaster />
      <DashboardSidebar
        user={user}
        isOpen={sidebarOpen}
        activeNav={activeNav}
        setActiveNav={(nav) => {
          setActiveNav(nav);
          setSidebarOpen(false);
        }}
        onLogout={logout}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      <div className="dash-main">
        <DashboardHeader
          user={user}
          activeNav={activeNav}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        <div className="dash-content">
          {activeNav === "orchestrator" && <OrchestratorView onNewTask={() => taskModal.open()} />}
          {activeNav === "agents" && <AgentsView />}
          {activeNav === "skills" && <SkillsView />}
          {activeNav === "traces" && <TracesView />}
          {activeNav === "evaluator" && <EvaluatorView />}
          {activeNav === "memory" && <MemoryView />}
          {activeNav === "activity" && <ActivityView />}
          {activeNav === "settings" && <SettingsView />}
        </div>
      </div>

      <TaskModal
        isOpen={taskModal.isOpen}
        onClose={taskModal.close}
        repositories={initialRepositories}
        onCreateTask={dispatchTask}
      />
    </main>
  );
}
