import React from "react";
import { Sparkles } from "lucide-react";

interface EvalPanelProps {
  score?: number;
  scores?: number[];
}

export function EvalPanel({ score = 0, scores }: EvalPanelProps) {
  const bars =
    scores && scores.length > 0
      ? scores.map((s) => Math.max(4, Math.min(100, s)))
      : [24, 38, 34, 55, 63, 60, 79, 90];
  const latest = bars[bars.length - 1] ?? 0;
  const first = bars[0] ?? 0;
  const delta = bars.length > 1 ? Math.round((latest - first) * 10) / 10 : 0;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Getting better, together.</h2>
        <Sparkles className="size-3.5" />
      </div>

      <div className="eval-panel">
        <div className="eval-score">
          {score}
          <span>/ 100</span>
        </div>
        <p>Subagent evaluation score</p>

        <div className="eval-bars">
          {bars.map((h, i) => (
            <i key={i} style={{ height: `${h}%`, opacity: i === bars.length - 1 ? 0.85 : 1 }} />
          ))}
        </div>

        <div className="eval-caption">
          <span>{bars.length > 1 ? `${bars.length} runs` : "No runs yet"}</span>
          <span className="text-success font-medium">
            {delta >= 0 ? `↑ ${delta} points` : `↓ ${Math.abs(delta)} points`}
          </span>
          <span>Today</span>
        </div>
      </div>
    </section>
  );
}
