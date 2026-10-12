"use client";

import React, { useState, useEffect } from "react";
import { Settings2, Loader2 } from "lucide-react";
import { UserSettings } from "@/types/orbit-types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: UserSettings }) => setSettings(data.settings))
      .catch(() => setSettings(null))
      .finally(() => setIsLoading(false));
  }, []);

  const toggle = async (key: "orchestrator_auto_approve" | "evaluator_auto_apply") => {
    if (!settings || isSaving) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orchestrator_auto_approve: next.orchestrator_auto_approve,
          evaluator_auto_apply: next.evaluator_auto_apply,
        }),
      });
      const data = (await res.json()) as { settings: UserSettings };
      if (data.settings) setSettings(data.settings);
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

      {!isLoading && settings && (
        <div className="settings-list">
          <label className="setting-row">
            <div>
              <p>Auto-approve agent runs</p>
              <small>Orchestrator runs, pushes, opens and merges PRs without asking. Off by default.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.orchestrator_auto_approve}
              className={`toggle ${settings.orchestrator_auto_approve ? "toggle-on" : ""}`}
              onClick={() => void toggle("orchestrator_auto_approve")}
            >
              <span />
            </button>
          </label>

          <label className="setting-row">
            <div>
              <p>Evaluator auto-apply tuning</p>
              <small>Evaluator rewrites sub-agent prompts and skills on its own. Off by default.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.evaluator_auto_apply}
              className={`toggle ${settings.evaluator_auto_apply ? "toggle-on" : ""}`}
              onClick={() => void toggle("evaluator_auto_apply")}
            >
              <span />
            </button>
          </label>
        </div>
      )}
    </section>
  );
}
