"use client";

import React from "react";
import { SettingsPanel } from "../settings-panel";

export function SettingsView() {
  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Settings</h1>
          <p>Control how autonomous your factory is. Everything is off by default.</p>
        </div>
      </div>

      <div className="view-single">
        <SettingsPanel />
      </div>
    </div>
  );
}
