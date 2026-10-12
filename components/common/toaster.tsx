"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bell, X } from "lucide-react";
import { Approval, OrbitActivity } from "@/types/orbit-types";

interface Toast {
  id: string;
  title: string;
  body: string;
}

/**
 * Global toast notifications: new approvals and new activity pop up
 * visibly (top-right) wherever the user is in the dashboard.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const push = useCallback((t: Toast) => {
    setToasts((prev) => [...prev.slice(-3), t]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, 7000);
  }, []);

  const check = useCallback(async () => {
    try {
      const [aRes, actRes] = await Promise.all([
        fetch("/api/approvals?status=pending"),
        fetch("/api/activity?limit=5"),
      ]);
      const fresh: Toast[] = [];
      if (aRes.ok) {
        const data = (await aRes.json()) as { approvals: Approval[] };
        for (const a of data.approvals ?? []) {
          const id = `appr-${a.id}`;
          if (!seen.current.has(id)) {
            seen.current.add(id);
            if (primed.current) {
              const approvalTitle =
                a.kind === "run_agent"
                  ? "Agent Approval Required"
                  : `Approval needed: ${a.kind.replace(/_/g, " ")}`;
              const approvalBody =
                a.kind === "run_agent"
                  ? "An agent is ready to run. Approve it in the chat bar."
                  : "Review it in the notifications bell.";
              fresh.push({
                id,
                title: approvalTitle,
                body: approvalBody,
              });
            }
          }
        }
      }
      if (actRes.ok) {
        const data = (await actRes.json()) as { activities: OrbitActivity[] };
        for (const act of data.activities ?? []) {
          const id = `act-${act.id}`;
          if (!seen.current.has(id)) {
            seen.current.add(id);
            if (primed.current) {
              fresh.push({ id, title: act.title, body: act.description.slice(0, 120) });
            }
          }
        }
      }
      primed.current = true;
      for (const t of fresh.slice(0, 3)) push(t);
    } catch {
      // toasts must never break the page
    }
  }, [push]);

  useEffect(() => {
    // Prime seen-ids on mount, then poll + listen to realtime refresh events.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
    const t = setInterval(check, 10000);

    const onRefresh = () => void check();
    window.addEventListener("orbit:refresh", onRefresh);

    const onDirectToast = (e: Event) => {
      const detail = (e as CustomEvent<Toast>).detail;
      if (detail?.id && detail?.title) {
        if (!seen.current.has(detail.id)) {
          seen.current.add(detail.id);
          push(detail);
        }
      }
    };
    window.addEventListener("orbit:toast", onDirectToast);

    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
      window.removeEventListener("orbit:toast", onDirectToast);
    };
  }, [check, push]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <Bell className="size-4" />
          <div>
            <p>{t.title}</p>
            <small>{t.body}</small>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
