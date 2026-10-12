"use client";

import React from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  GitPullRequest,
  Cpu,
  Activity,
  Sparkles,
  Brain,
  Settings,
  BookOpen,
  ArrowUpRight,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { LiveDot } from "@/components/common/live-dot";
import { GithubIcon } from "@/components/common/github-icon";
import { OrbitUser } from "@/types/orbit-types";
import { getUserInitials } from "@/lib/format-helpers";

interface DashboardSidebarProps {
  user: OrbitUser | null;
  isOpen: boolean;
  activeNav: string;
  setActiveNav: (nav: string) => void;
  onLogout: () => void;
}

export function DashboardSidebar({
  user,
  isOpen,
  activeNav,
  setActiveNav,
  onLogout,
}: DashboardSidebarProps) {
  const initials = getUserInitials(user?.name);
  const displayName = user?.name || "Alex Chen";
  const displayHandle = user?.githubUsername ? `@${user.githubUsername}` : "@alexchen";

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <Link className="brand" href="/">
        <OrbitMark />
        <span>orbit</span>
      </Link>

      <div className="workspace">
        <span className="workspace-avatar">{initials[0]}</span>
        <div>
          <strong>Orbit workspace</strong>
          <small>{user ? "Pro plan · Live" : "Pro plan · Demo"}</small>
        </div>
        <ChevronDown className="size-3" />
      </div>

      <div className="nav-label">WORKSPACE</div>
      <nav>
        <button
          type="button"
          className={activeNav === "overview" ? "active" : ""}
          onClick={() => setActiveNav("overview")}
        >
          <LayoutDashboard className="size-4" />
          Overview
        </button>
        <button
          type="button"
          className={activeNav === "tasks" ? "active" : ""}
          onClick={() => setActiveNav("tasks")}
        >
          <GitPullRequest className="size-4" />
          Tasks
          <span>5</span>
        </button>
        <button
          type="button"
          className={activeNav === "agents" ? "active" : ""}
          onClick={() => setActiveNav("agents")}
        >
          <Cpu className="size-4" />
          Agents
          <span>8</span>
        </button>
        <button
          type="button"
          className={activeNav === "repositories" ? "active" : ""}
          onClick={() => setActiveNav("repositories")}
        >
          <GithubIcon className="size-4" />
          Repositories
        </button>
      </nav>

      <div className="nav-label mt-7">INTELLIGENCE</div>
      <nav>
        <button
          type="button"
          className={activeNav === "traces" ? "active" : ""}
          onClick={() => setActiveNav("traces")}
        >
          <Activity className="size-4" />
          Traces &amp; evals
        </button>
        <button
          type="button"
          className={activeNav === "skills" ? "active" : ""}
          onClick={() => setActiveNav("skills")}
        >
          <Sparkles className="size-4" />
          Skills
        </button>
        <button
          type="button"
          className={activeNav === "memory" ? "active" : ""}
          onClick={() => setActiveNav("memory")}
        >
          <Brain className="size-4" />
          Memory
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <div>
            <LiveDot /> All systems operational
          </div>
          <p>{user ? "Live Supabase & GitHub connection" : "Demo workspace · Ready to connect"}</p>
        </div>

        <nav>
          <button type="button">
            <Settings className="size-4" />
            Settings
          </button>
          <Link href="/">
            <BookOpen className="size-4" />
            Back to Orbit
            <ArrowUpRight className="size-3.5" />
          </Link>
        </nav>

        <div className="account">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{displayName}</strong>
            <small>{displayHandle} · {user ? "GitHub User" : "Demo"}</small>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title={user ? "Sign out" : "Go to Sign in"}
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
