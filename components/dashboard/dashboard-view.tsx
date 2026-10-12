"use client";

import React, { useState, useEffect } from "react";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser } from "@/types/orbit-types";
import { useAuth } from "@/hooks/use-auth";
import { createOrbitBrowserClient } from "@/lib/supabase-client";
import { Toaster } from "@/components/common/toaster";
import { DashboardSidebar, OrbitNav } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { OrchestratorView } from "./views/orchestrator-view";
import { AgentsView } from "./views/agents-view";
import { PromptsView } from "./views/prompts-view";
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
}: DashboardViewProps) {
  const { user, logout } = useAuth(initialUser);
  const [activeNav, setActiveNav] = useState<OrbitNav>("orchestrator");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  useEffect(() => {
    // Background polling: check every 60s while dashboard is active
    const pollTimer = setInterval(() => {
      void fetch("/api/github/poll", { method: "POST" })
        .then((r) => r.json())
        .then((data: { proposed?: number }) => {
          if ((data.proposed ?? 0) > 0) {
            window.dispatchEvent(new Event("orbit:refresh"));
          }
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(pollTimer);
  }, []);

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
          {activeNav === "orchestrator" && <OrchestratorView />}
          {activeNav === "agents" && <AgentsView />}
          {activeNav === "prompts" && <PromptsView />}
          {activeNav === "traces" && <TracesView />}
          {activeNav === "evaluator" && <EvaluatorView />}
          {activeNav === "memory" && <MemoryView />}
          {activeNav === "activity" && <ActivityView />}
          {activeNav === "settings" && <SettingsView />}
        </div>
      </div>
    </main>
  );
}
