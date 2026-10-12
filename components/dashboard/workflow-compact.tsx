import React from "react";
import {
  Network,
  Sparkles,
  Terminal,
  GitPullRequest,
  Check,
  Radio,
  Brain,
  ArrowUpRight,
} from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { LiveDot } from "@/components/common/live-dot";

export function WorkflowCompact() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <Network className="size-3.5" />
          Your orchestrator
        </h2>
        <span className="status">
          <LiveDot /> Live
        </span>
      </div>

      <div className="workflow compact">
        <div className="workflow-path">
          <div className="flow-node source">
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            <strong>GitHub event</strong>
            <span>Issue #128 assigned</span>
          </div>

          <div className="flow-line">
            <span />
          </div>

          <div className="flow-node orchestrator">
            <OrbitMark />
            <strong>Orchestrator</strong>
            <span>Plan. Delegate. Coordinate.</span>
            <span className="node-tag">
              <Sparkles className="size-2" />
              Always in context
            </span>
          </div>

          <div className="flow-line branching">
            <span />
          </div>

          <div className="agent-stack">
            <div className="mini-agent">
              <Terminal className="size-3" />
              <span>Implementation</span>
              <LiveDot />
            </div>
            <div className="mini-agent">
              <GitPullRequest className="size-3" />
              <span>Code review</span>
              <LiveDot />
            </div>
            <div className="mini-agent">
              <Check className="size-3" />
              <span>Testing agent</span>
              <LiveDot />
            </div>
          </div>
        </div>

        <div className="flow-bottom">
          <span>
            <Radio className="size-2.5" />
            Neatlogs
          </span>
          <span>
            <Brain className="size-2.5" />
            Memory
          </span>
          <span>
            <Check className="size-2.5" />
            Evals
          </span>
          <ArrowUpRight className="size-3" />
        </div>
      </div>
    </section>
  );
}
