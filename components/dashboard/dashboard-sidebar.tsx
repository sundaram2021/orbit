"use client";

import React from "react";
import {
  Bot,
  Cpu,
  Sparkles,
  Activity,
  Brain,
  Database,
  ListVideo,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { LiveDot } from "@/components/common/live-dot";
import { OrbitUser } from "@/types/orbit-types";
import { getUserInitials } from "@/lib/format-helpers";

export type OrbitNav =
  | "orchestrator"
  | "agents"
  | "skills"
  | "traces"
  | "evaluator"
  | "memory"
  | "activity"
  | "settings";

export const ORBIT_NAV_LABELS: Record<OrbitNav, string> = {
  orchestrator: "Orchestrator",
  agents: "Agents",
  skills: "Skills",
  traces: "Traces",
  evaluator: "Evaluator",
  memory: "Memory",
  activity: "Activity",
  settings: "Settings",
};

const MAIN_NAV: { id: OrbitNav; icon: React.ReactNode }[] = [
  { id: "orchestrator", icon: <Bot className="size-4" /> },
  { id: "agents", icon: <Cpu className="size-4" /> },
  { id: "skills", icon: <Sparkles className="size-4" /> },
  { id: "traces", icon: <Activity className="size-4" /> },
  { id: "evaluator", icon: <Brain className="size-4" /> },
  { id: "memory", icon: <Database className="size-4" /> },
  { id: "activity", icon: <ListVideo className="size-4" /> },
];

interface DashboardSidebarProps {
  user: OrbitUser | null;
  isOpen: boolean;
  activeNav: OrbitNav;
  setActiveNav: (nav: OrbitNav) => void;
  onLogout: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DashboardSidebar({
  user,
  isOpen,
  activeNav,
  setActiveNav,
  onLogout,
  collapsed,
  onToggleCollapse,
}: DashboardSidebarProps) {
  const initials = getUserInitials(user?.name);
  const displayName = user?.name || "User";
  const displayHandle = user?.githubUsername ? `@${user.githubUsername}` : "";

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="brand-row">
        <span className="brand">
          <OrbitMark />
          <span className="brand-name">orbit</span>
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="collapse-btn"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>

      <div className="workspace">
        <span className="workspace-avatar">{initials[0]}</span>
        <div className="collapse-hide">
          <div>
            <strong>Orbit workspace</strong>
          </div>
        </div>
      </div>

      <div className="nav-label collapse-hide">WORKSPACE</div>
      <nav>
        {MAIN_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeNav === item.id ? "active" : ""}
            onClick={() => setActiveNav(item.id)}
            title={ORBIT_NAV_LABELS[item.id]}
          >
            {item.icon}
            <span className="collapse-hide">{ORBIT_NAV_LABELS[item.id]}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <nav>
          <button
            type="button"
            className={activeNav === "settings" ? "active" : ""}
            onClick={() => setActiveNav("settings")}
            title="Settings"
          >
            <Settings className="size-4" />
            <span className="collapse-hide">Settings</span>
          </button>
        </nav>

        <div className="sidebar-status collapse-hide">
          <div>
            <LiveDot /> All systems operational
          </div>
        </div>

        <div className="account">
          <span className="avatar">{initials}</span>
          <div className="collapse-hide">
            <div>
              <strong>{displayName}</strong>
              <small>{displayHandle ? `${displayHandle} · GitHub` : "GitHub"}</small>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            aria-label="Sign out"
            className="p-1 rounded hover:bg-accent cursor-pointer"
          >
            <LogOut className="size-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      </div>
    </aside>
  );
}
