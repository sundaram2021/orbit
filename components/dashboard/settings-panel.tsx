"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Settings2 } from "lucide-react";
import { UserSettings } from "@/types/orbit-types";
import { Skeleton, FetchError } from "@/components/common/loading";

export function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      if (!r.ok) throw new Error(`load failed (${r.status})`);
      const data = (await r.json()) as { settings?: UserSettings; error?: string };
      if (data.settings) {
        setSettings(data.settings);
        setSaveError(null);
      } else {
        setSettings(null);
        setSaveError(data.error ?? "Couldn't load settings. Retry.");
      }
    } catch {
      // Blank-panel fix: surface the failure instead of rendering header-only.
      setSettings(null);
      setSaveError("Couldn't load settings. Check your connection and retry.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setSaveError(null);
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => {});
  }, [load]);

  const toggle = async (key: "orchestrator_auto_approve") => {
    if (!settings || isSaving) return;
    const prev = { ...settings };
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orchestrator_auto_approve: next.orchestrator_auto_approve,
        }),
      });
      const data = (await res.json()) as { settings?: UserSettings; error?: string };
      if (!res.ok || !data.settings) {
        // Revert: the toggle did NOT persist.
        setSettings(prev);
        setSaveError(data.error ?? `Save failed (${res.status}). Run the settings migration, then retry.`);
      } else {
        setSettings(data.settings);
      }
    } catch {
      setSettings(prev);
      setSaveError("Save failed: network error. Your change was reverted.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Automation</h2>
        <Settings2 className="size-3.5" />
      </div>

      {isLoading ? (
        <div className="settings-list" aria-busy="true">
          <div className="setting-row">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-3/4 opacity-70" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        </div>
      ) : null}

      {saveError ? (
        <div style={{ padding: "10px 19px" }}>
          <FetchError message={saveError} onRetry={settings ? undefined : handleRetry} />
        </div>
      ) : null}

      {!isLoading && settings && (
        <div className="settings-list">
          <div className="setting-row" onClick={() => void toggle("orchestrator_auto_approve")}>
            <div>
              <p>Auto-approve agent runs</p>
              <small>When ON: sub-agent starts immediately on assignment and opens PR or reviews PR. When OFF: asks for approval in chat bar first.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.orchestrator_auto_approve}
              aria-label="Auto-approve agent runs"
              className={`toggle ${settings.orchestrator_auto_approve ? "toggle-on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                void toggle("orchestrator_auto_approve");
              }}
            >
              <span />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
