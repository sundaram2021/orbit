"use client";

import React from "react";
import { Menu, ChevronRight, Bell } from "lucide-react";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { LiveDot } from "@/components/common/live-dot";
import { GithubIcon } from "@/components/common/github-icon";
import { OrbitUser } from "@/types/orbit-types";
import { getUserInitials } from "@/lib/format-helpers";

interface DashboardHeaderProps {
  user: OrbitUser | null;
  onToggleSidebar: () => void;
}

export function DashboardHeader({ user, onToggleSidebar }: DashboardHeaderProps) {
  const initials = getUserInitials(user?.name);

  return (
    <header className="dash-header">
      <div className="dash-header-left">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9 mobile-menu"
          aria-label="Toggle navigation"
        >
          <Menu className="size-4" />
        </button>
        <span>Workspace</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <strong className="font-medium">Overview</strong>
      </div>

      <div className="dash-header-actions">
        <span className="connection">
          <GithubIcon className="size-3.5" />
          {user ? "GitHub live" : "GitHub demo"}
          <LiveDot />
        </span>

        <ThemeToggle />

        <button
          type="button"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
        </button>

        <span className="avatar">{initials}</span>
      </div>
    </header>
  );
}
