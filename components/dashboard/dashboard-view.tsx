"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser, SubAgent, Evaluation } from "@/types/orbit-types";
import { useTasks } from "@/hooks/use-tasks";
import { useAuth } from "@/hooks/use-auth";
import { useModal } from "@/hooks/use-modal";
import { createOrbitBrowserClient } from "@/lib/supabase-client";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { DashboardStats } from "./dashboard-stats";
import { WorkflowCompact } from "./workflow-compact";
import { TaskPanel } from "./task-panel";
import { ActivityPanel } from "./activity-panel";
import { EvalPanel } from "./eval-panel";
import { RepoPanel } from "./repo-panel";
import { TaskModal } from "./task-modal";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ApprovalsPanel } from "./approvals-panel";
import { AgentsPanel } from "./agents-panel";
import { SettingsPanel } from "./settings-panel";

interface DashboardViewProps {
  initialUser: OrbitUser | null;
  initialTasks: OrbitTask[];
  initialActivities: OrbitActivity[];
  initialRepositories: OrbitRepo[];
}

interface LiveStats {
  activeAgents: number;
  tasksCompleted: number;
  prsMerged: number;
  avgScore: number;
  evalScores: number[];
}

export function DashboardView({
  initialUser,
  initialTasks,
  initialActivities,
  initialRepositories,
}: DashboardViewProps) {
  const { user, logout } = useAuth(initialUser);
  const {
    filteredTasks,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    stats: taskStats,
    addNewTask,
  } = useTasks(initialTasks);

  const [activeNav, setActiveNav] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatTab, setChatTab] = useState<"orchestrator" | "evaluator">("orchestrator");
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const taskModal = useModal();

  const displayName = user?.name ? user.name.split(" ")[0] : "there";

  // Live stats from real sub-agents + evaluations (replaces demo hardcodes).
  const loadLiveStats = useCallback(async () => {
    try {
      const [agentsRes, evalsRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/agents?which=evaluations"),
      ]);
      if (!agentsRes.ok) return;
      const { agents } = (await agentsRes.json()) as { agents: SubAgent[] };
      const evals = evalsRes.ok
        ? (((await evalsRes.json()) as { evaluations: Evaluation[] }).evaluations ?? [])
        : [];
      const running = agents.filter((a) => a.status === "running").length;
      const completed = agents.filter((a) => a.status === "completed").length;
      const scores = evals.map((e) => Number(e.score)).filter((s) => !Number.isNaN(s));
      setLiveStats({
        activeAgents: running,
        tasksCompleted: taskStats.tasksCompleted + completed,
        prsMerged: completed,
        avgScore: scores.length
          ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10
          : 0,
        evalScores: scores.slice(-8),
      });
    } catch {
      // keep demo fallback stats on error
    }
  }, [taskStats.tasksCompleted]);

  useEffect(() => {
    void loadLiveStats();
    const t = setInterval(loadLiveStats, 20000);

    // Realtime: refresh live stats the moment agents/approvals change.
    const supabase = createOrbitBrowserClient();
    const channel = supabase
      .channel("orbit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sub_agents" }, () => {
        void loadLiveStats();
        window.dispatchEvent(new Event("orbit:refresh"));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => {
        window.dispatchEvent(new Event("orbit:refresh"));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "github_events" }, () => {
        void loadLiveStats();
      })
      .subscribe();

    const onRefresh = () => void loadLiveStats();
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
      void supabase.removeChannel(channel);
    };
  }, [loadLiveStats]);

  // "New task" dispatches through the orchestrator pipeline (propose → approve → run),
  // while still keeping a local task row for the task list.
  const dispatchTask = async (data: {
    title: string;
    description: string;
    repo_name: string;
    assigned_agent: string;
  }) => {
    const task = await addNewTask(data);
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
      // task row is kept; agent proposal can be retried from chat
    }
    window.dispatchEvent(new Event("orbit:refresh"));
    return task;
  };

  const stats = liveStats
    ? {
        activeAgents: liveStats.activeAgents,
        tasksCompleted: liveStats.tasksCompleted,
        prsMerged: liveStats.prsMerged,
        avgScore: liveStats.avgScore,
      }
    : taskStats;

  return (
    <main className="dashboard">
      <DashboardSidebar
        user={user}
        isOpen={sidebarOpen}
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        onLogout={logout}
      />

      <div className="dash-main">
        <DashboardHeader
          user={user}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        <div className="dash-content">
          <div className="dash-title">
            <div>
              <h1>
                Your factory, in motion.
                <span className="demo-badge">{user ? "LIVE" : "DEMO"}</span>
              </h1>
              <p>
                Good morning, {displayName}. Here&apos;s what&apos;s happening in your orbit.
              </p>
            </div>

            <button
              id="new-task-btn"
              type="button"
              onClick={() => taskModal.open()}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
            >
              <Plus className="size-4" />
              New task
            </button>
          </div>

          <DashboardStats stats={stats} />

          <div className="dash-columns">
            <div>
              <div className="chat-tabs" role="tablist" aria-label="Agent chats">
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatTab === "orchestrator"}
                  className={`chat-tab ${chatTab === "orchestrator" ? "active" : ""}`}
                  onClick={() => setChatTab("orchestrator")}
                >
                  Orchestrator
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatTab === "evaluator"}
                  className={`chat-tab ${chatTab === "evaluator" ? "active" : ""}`}
                  onClick={() => setChatTab("evaluator")}
                >
                  Evaluator
                </button>
              </div>

              {chatTab === "orchestrator" ? (
                <ChatPanel
                  kind="orchestrator"
                  title="Orchestrator"
                  subtitle="Spawns sub-agents for GitHub work"
                  placeholder="Ask for anything — e.g. fix issue #128 in owner/repo…"
                />
              ) : (
                <ChatPanel
                  kind="evaluator"
                  title="Evaluator"
                  subtitle="Scores agents and proposes improvements"
                  placeholder="Ask about scores, traces, or tuning…"
                />
              )}

              <WorkflowCompact />
              <TaskPanel
                tasks={filteredTasks}
                filter={filter}
                setFilter={setFilter}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelectTask={() => taskModal.open()}
              />
            </div>

            <div className="dash-right">
              <ApprovalsPanel />
              <AgentsPanel />
              <ActivityPanel activities={initialActivities} />
              <EvalPanel
                score={liveStats?.avgScore || stats.avgScore}
                scores={liveStats?.evalScores}
              />
              <SettingsPanel />
              <RepoPanel repositories={initialRepositories} />
            </div>
          </div>
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
