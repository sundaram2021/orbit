"use client";

import React, { useState, useEffect } from "react";
import { Settings2, Loader2 } from "lucide-react";
import { UserSettings } from "@/types/orbit-types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings?: UserSettings; error?: string }) => {
        if (data.settings) setSettings(data.settings);
        else {
          setSettings(null);
          if (data.error) setSaveError(data.error);
        }
      })
      .catch(() => setSettings(null))
      .finally(() => setIsLoading(false));
  }, []);

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

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading settings…
        </div>
      )}

      {saveError && <div className="chat-error" style={{ padding: "10px 19px" }}>{saveError}</div>}

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
