"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Menu, ChevronRight, Bell, Check, X } from "lucide-react";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { LiveDot } from "@/components/common/live-dot";
import { GithubIcon } from "@/components/common/github-icon";
import { OrbitUser, OrbitActivity, Approval } from "@/types/orbit-types";
import { getUserInitials } from "@/lib/format-helpers";
import { ORBIT_NAV_LABELS, OrbitNav } from "./dashboard-sidebar";

const UNDERSCORE_RE = /_/g;

interface DashboardHeaderProps {
  user: OrbitUser | null;
  activeNav: OrbitNav;
  onToggleSidebar: () => void;
}

export function DashboardHeader({ user, activeNav, onToggleSidebar }: DashboardHeaderProps) {
  const initials = getUserInitials(user?.name);
  const [open, setOpen] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activities, setActivities] = useState<OrbitActivity[]>([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, actRes] = await Promise.all([
        fetch("/api/approvals?status=pending"),
        fetch("/api/activity?limit=10"),
      ]);
      let failed = false;
      if (aRes.ok) {
        const data = (await aRes.json()) as { approvals: Approval[] };
        setApprovals(data.approvals ?? []);
      } else {
        failed = true;
      }
      if (actRes.ok) {
        const data = (await actRes.json()) as { activities: OrbitActivity[] };
        setActivities(data.activities ?? []);
      } else {
        failed = true;
      }
      setNotifError(failed ? "Couldn't refresh notifications." : null);
    } catch {
      setNotifError("Couldn't load notifications. Check your connection.");
    } finally {
      setNotifLoading(false);
    }
  }, []);

  const handleNotifRetry = useCallback(() => {
    setNotifLoading(true);
    setNotifError(null);
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    // Fetch notifications on mount, then poll + refresh events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 20000);
    const onRefresh = () => void load().catch(() => {});
    window.addEventListener("orbit:refresh", onRefresh);
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
      document.removeEventListener("mousedown", onClick);
    };
  }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (deciding) return;
    setDeciding(id);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `decide failed (${res.status})`);
      }
      setApprovals((prev) => prev.filter((a) => a.id !== id));
      window.dispatchEvent(new Event("orbit:refresh"));
    } catch (err) {
      setNotifError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  const count = approvals.length;

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
        <strong className="font-medium">{ORBIT_NAV_LABELS[activeNav]}</strong>
      </div>

      <div className="dash-header-actions">
        <span className="connection" title={user ? "GitHub connected" : "Not connected"}>
          <GithubIcon className="size-3.5" />
          <LiveDot />
        </span>

        <ThemeToggle />

        <div className="notif-box" ref={boxRef}>
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              void load();
            }}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9"
            aria-label="Notifications"
            aria-expanded={open}
          >
            <Bell className="size-4" />
            {count > 0 && <span className="notif-badge">{count}</span>}
          </button>

          {open && (
            <div className="notif-dropdown">
              <div className="notif-head">Notifications</div>
              {notifLoading ? (
                <div className="notif-empty" aria-busy="true">
                  <div className="animate-pulse rounded-md bg-muted/60 h-4 w-3/4 mx-auto" aria-hidden="true" />
                </div>
              ) : null}
              {notifError ? (
                <div className="notif-empty" role="alert">
                  {notifError}{" "}
                  <button type="button" onClick={handleNotifRetry} className="underline">
                    Retry
                  </button>
                </div>
              ) : null}
              {!notifLoading && !notifError && count === 0 && activities.length === 0 && (
                <div className="notif-empty">All caught up. Agent proposals and updates will appear here.</div>
              )}
              {approvals.map((a) => (
                <div key={a.id} className="notif-item notif-approval">
                  <div>
                    <p>Awaiting approval: {a.kind.replace(UNDERSCORE_RE, " ")}</p>
                    <small>{new Date(a.created_at ?? "").toLocaleString()}</small>
                  </div>
                  <div className="notif-item-actions">
                    <button type="button" aria-label="Approve" disabled={deciding === a.id} onClick={() => void decide(a.id, "approved")}>
                      <Check className="size-3.5" />
                    </button>
                    <button type="button" aria-label="Reject" disabled={deciding === a.id} onClick={() => void decide(a.id, "rejected")}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {activities.map((act) => (
                <div key={act.id} className="notif-item">
                  <div>
                    <p>{act.title}</p>
                    <small>{act.description}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <span className="avatar">{initials}</span>
      </div>
    </header>
  );
}
