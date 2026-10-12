"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  Loader2,
  AlertCircle,
  CircleDot,
  GitPullRequest,
  Cpu,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { ChatStep } from "@/types/orbit-types";

interface ChatStepsProps {
  steps: ChatStep[];
  isLive?: boolean;
}

function getStepIcon(tool: string) {
  if (tool.includes("issue")) {
    return <CircleDot className="size-3.5 text-amber-400" />;
  }
  if (tool.includes("pr")) {
    return <GitPullRequest className="size-3.5 text-purple-400" />;
  }
  if (tool.includes("spawn") || tool.includes("agent")) {
    return <Cpu className="size-3.5 text-blue-400" />;
  }
  if (tool.includes("comment")) {
    return <MessageSquare className="size-3.5 text-sky-400" />;
  }
  return <Wrench className="size-3.5 text-primary" />;
}

export function ChatSteps({ steps, isLive = false }: ChatStepsProps) {
  const [isOpen, setIsOpen] = useState<boolean>(isLive);

  if (!steps || steps.length === 0) return null;

  const runningCount = steps.filter((s) => s.status === "running").length;
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="chat-steps-container">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="chat-steps-header"
        aria-expanded={isOpen}
      >
        <div className="chat-steps-header-left">
          {runningCount > 0 ? (
            <span className="chat-steps-live-indicator">
              <Loader2 className="size-3 animate-spin text-primary" />
            </span>
          ) : (
            <span className="chat-steps-done-indicator">
              <Sparkles className="size-3 text-primary" />
            </span>
          )}
          <span className="chat-steps-title">
            {runningCount > 0
              ? `Agent executing (${runningCount} active, ${doneCount} done)`
              : `Thought process & actions (${steps.length} ${steps.length === 1 ? "step" : "steps"})`}
          </span>
        </div>
        <span className="chat-steps-toggle">
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>

      {isOpen && (
        <div className="chat-steps-timeline">
          {steps.map((step, idx) => (
            <div key={`${step.tool}-${idx}`} className={`chat-step-item chat-step-${step.status}`}>
              <div className="chat-step-icon-wrap">
                {step.status === "running" ? (
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                ) : step.status === "error" ? (
                  <AlertCircle className="size-3.5 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                )}
              </div>
              <div className="chat-step-content">
                <div className="chat-step-meta">
                  <span className="chat-step-tool-badge">
                    {getStepIcon(step.tool)}
                    <code>{step.tool}</code>
                  </span>
                  <span className={`chat-step-status-tag status-${step.status}`}>
                    {step.status === "running" ? "running" : step.status === "done" ? "completed" : "error"}
                  </span>
                </div>
                <div className="chat-step-label">{step.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatLiveIndicator({ activeStep }: { activeStep: string }) {
  if (!activeStep) return null;

  return (
    <div className="chat-live-pulse-card">
      <div className="chat-live-pulse-spinner">
        <Loader2 className="size-4 animate-spin text-primary" />
      </div>
      <div className="chat-live-pulse-info">
        <span className="chat-live-pulse-tag">Orchestrator working</span>
        <span className="chat-live-pulse-text">{activeStep}</span>
      </div>
    </div>
  );
}
