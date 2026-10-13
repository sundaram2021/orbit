"use client";

import React, { useState, useEffect, useCallback } from "react";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser } from "@/types/orbit-types";
import { useAuth } from "@/hooks/use-auth";
import { createOrbitBrowserClient } from "@/lib/supabase-client";
import { Toaster } from "@/components/common/toaster";
import { DashboardSidebar, OrbitNav } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { OrchestratorView } from "./views/orchestrator-view";
import dynamic from "next/dynamic";

const AgentsView = dynamic(() => import("./views/agents-view").then((m) => m.AgentsView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const PromptsView = dynamic(() => import("./views/prompts-view").then((m) => m.PromptsView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const TracesView = dynamic(() => import("./views/traces-view").then((m) => m.TracesView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const EvaluatorView = dynamic(() => import("./views/evaluator-view").then((m) => m.EvaluatorView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const MemoryView = dynamic(() => import("./views/memory-view").then((m) => m.MemoryView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const ActivityView = dynamic(() => import("./views/activity-view").then((m) => m.ActivityView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});
const SettingsView = dynamic(() => import("./views/settings-view").then((m) => m.SettingsView), {
  loading: () => <div className="chat-loading">Loading…</div>,
});

interface DashboardViewProps {
  initialUser: OrbitUser | null;
  initialTasks?: OrbitTask[];
  initialActivities?: OrbitActivity[];
  initialRepositories?: OrbitRepo[];
}

export function DashboardView({
  initialUser,
}: DashboardViewProps) {
  const { user, logout } = useAuth(initialUser);
  const [activeNav, setActiveNav] = useState<OrbitNav>("orchestrator");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const handleNav = useCallback((nav: OrbitNav) => {
    setActiveNav(nav);
    setSidebarOpen(false);
  }, []);
  const toggleCollapse = useCallback(() => setCollapsed((v) => !v), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

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
    // Background polling: check every 60s while dashboard is active.
    // After 3 consecutive failures, toast once so a dead poller surfaces
    // instead of silently never proposing again.
    let failures = 0;
    let toasted = false;
    const pollTimer = setInterval(() => {
      void fetch("/api/github/poll", { method: "POST" })
        .then((r) => r.json())
        .then((data: { proposed?: number }) => {
          failures = 0;
          toasted = false;
          if ((data.proposed ?? 0) > 0) {
            window.dispatchEvent(new Event("orbit:refresh"));
          }
        })
        .catch(() => {
          failures++;
          if (failures >= 3 && !toasted) {
            toasted = true;
            window.dispatchEvent(
              new CustomEvent("orbit:toast", {
                detail: {
                  id: `toast-poll-${Date.now()}`,
                  title: "Background sync failing",
                  body: "GitHub polling failed 3 times. Check connection, then reload.",
                },
              })
            );
          }
        });
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
        setActiveNav={handleNav}
        onLogout={logout}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      <div className="dash-main">
        <DashboardHeader
          user={user}
          activeNav={activeNav}
          onToggleSidebar={toggleSidebar}
        />

        <div className="dash-content">
          {activeNav === "orchestrator" ? (
            <OrchestratorView />
          ) : activeNav === "agents" ? (
            <AgentsView />
          ) : activeNav === "prompts" ? (
            <PromptsView />
          ) : activeNav === "traces" ? (
            <TracesView />
          ) : activeNav === "evaluator" ? (
            <EvaluatorView />
          ) : activeNav === "memory" ? (
            <MemoryView />
          ) : activeNav === "activity" ? (
            <ActivityView />
          ) : (
            <SettingsView />
          )}
        </div>
      </div>
    </main>
  );
}
