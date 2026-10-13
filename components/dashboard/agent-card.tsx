"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Bot,
  Wrench,
  FileText,
  TerminalSquare,
  Brain,
  Copy,
  Check,
  Play,
  X,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { SubAgent, Evaluation, AgentResult } from "@/types/orbit-types";
import { formatRelativeTime } from "@/lib/format-helpers";

const STATUS_LABEL: Record<SubAgent["status"], string> = {
  awaiting_approval: "Awaiting approval",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const KIND_ICON: Record<string, React.ReactNode> = {
  implementation: <Wrench className="size-4" />,
  review: <FileText className="size-4" />,
  testing: <TerminalSquare className="size-4" />,
  custom: <Bot className="size-4" />,
};

type DetailTab = "prompt" | "log" | "eval";

const REPO_RE = /Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/;

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "prompt", label: "Prompt" },
  { id: "log", label: "Run log" },
  { id: "eval", label: "Evaluation" },
];

function extractRepo(systemPrompt: string): string | null {
  const m = REPO_RE.exec(systemPrompt);
  return m ? m[1] : null;
}

function duration(agent: SubAgent, evaluation?: Evaluation): string | null {
  if (!agent.created_at || !evaluation?.created_at) return null;
  const ms =
    new Date(evaluation.created_at).getTime() - new Date(agent.created_at).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Proposed → Approved → Running → PR → Evaluated */
function stages(agent: SubAgent, evaluation?: Evaluation): { label: string; done: boolean; failed?: boolean }[] {
  const r = (agent.result ?? {}) as AgentResult;
  const ran = agent.status === "running" || agent.status === "completed" || Boolean(agent.run_log);
  return [
    { label: "Proposed", done: true },
    { label: "Approved", done: agent.status !== "awaiting_approval", failed: agent.status === "failed" && !ran },
    { label: "Running", done: ran, failed: agent.status === "failed" },
    { label: "PR opened", done: r.pr_number != null },
    { label: "Evaluated", done: evaluation != null || agent.eval_score != null },
  ];
}

interface AgentCardProps {
  agent: SubAgent;
  evaluation?: Evaluation;
  onChanged: () => void;
}

export function AgentCard({ agent, evaluation, onChanged }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<DetailTab>("prompt");
  const [copied, setCopied] = useState(false);
  const [acting, setActing] = useState<"approve" | "cancel" | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const r = (agent.result ?? {}) as AgentResult;
  const repo = useMemo(
    () => r.repo ?? extractRepo(agent.system_prompt) ?? "",
    [r.repo, agent.system_prompt]
  );
  const stageList = useMemo(() => stages(agent, evaluation), [agent, evaluation]);
  const dur = useMemo(() => duration(agent, evaluation), [agent, evaluation]);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(agent.system_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }, [agent.system_prompt]);

  const act = useCallback(
    async (action: "approve" | "cancel") => {
      setActing(action);
      setActError(null);
      try {
        const res = await fetch(`/api/agents/${agent.id}/${action}`, { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `${action} failed (${res.status})`);
        }
        onChanged();
      } catch (err) {
        setActError(`${action === "approve" ? "Approve" : "Cancel"} failed: ${(err as Error).message}. Retry.`);
        window.dispatchEvent(
          new CustomEvent("orbit:toast", {
            detail: {
              id: `toast-act-${agent.id}-${Date.now()}`,
              title: `${action === "approve" ? "Approve" : "Cancel"} failed`,
              body: (err as Error).message.slice(0, 120),
            },
          })
        );
      } finally {
        setActing(null);
      }
    },
    [agent.id, onChanged]
  );

  return (
    <section className="panel agent-card">
      <button type="button" className="agent-card-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="agent-kind-icon">{KIND_ICON[agent.kind] ?? <Bot className="size-4" />}</span>
        <div>
          <p>{agent.title}</p>
          <div className="agent-meta">
            {repo ? <span className="mono">{repo}</span> : null}
            {r.issue_number != null && (
              <a
                href={r.issue_url ?? (repo ? `https://github.com/${repo}/issues/${r.issue_number}` : undefined)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                #{r.issue_number}
              </a>
            )}
            {r.pr_number != null ? (
              <a
                href={r.pr_url ?? (repo ? `https://github.com/${repo}/pull/${r.pr_number}` : undefined)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="agent-pr-link"
              >
                PR #{r.pr_number}{r.merged ? " (merged)" : ""}
              </a>
            ) : (
              agent.status === "completed" && <span className="item-meta">no changes</span>
            )}
            <span className="item-meta">{formatRelativeTime(agent.created_at)}</span>
            {dur ? <span className="item-meta">took {dur}</span> : null}
            {agent.eval_score != null && <span className="item-meta">score {agent.eval_score}</span>}
          </div>
        </div>
        <span className={`status-badge status-${agent.status}`}>{STATUS_LABEL[agent.status]}</span>
      </button>

      <div className="agent-stepper" aria-hidden={!expanded}>
        {stageList.map((s, i) => (
          <React.Fragment key={s.label}>
            <span className={`step ${s.done ? "step-done" : ""} ${s.failed ? "step-failed" : ""}`} title={s.label}>
              <i />
              <em>{s.label}</em>
            </span>
            {i < stageList.length - 1 && <span className="step-link" />}
          </React.Fragment>
        ))}
      </div>

      <div className="agent-actions">
        {actError ? (
          <div className="chat-error" role="alert" style={{ flexBasis: "100%" }}>
            {actError}
          </div>
        ) : null}
        {agent.status === "awaiting_approval" ? (
          <button type="button" disabled={acting !== null} onClick={() => void act("approve")} className="approval-btn approval-approve">
            {acting === "approve" ? <span className="inline-flex animate-spin"><Loader2 className="size-3.5" /></span> : <Play className="size-3.5" />} Approve &amp; run
          </button>
        ) : null}
        {(agent.status === "awaiting_approval" || agent.status === "running") ? (
          <button type="button" disabled={acting !== null} onClick={() => void act("cancel")} className="approval-btn approval-reject">
            {acting === "cancel" ? <span className="inline-flex animate-spin"><Loader2 className="size-3.5" /></span> : <X className="size-3.5" />} Cancel
          </button>
        ) : null}
        {r.pr_url && (
          <a href={r.pr_url} target="_blank" rel="noreferrer" className="approval-btn approval-reject">
            Open PR <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {expanded && (
        <div className="agent-card-body">
          <div className="detail-tabs" role="tablist">
            {DETAIL_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`detail-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "prompt" && (
            <div>
              <button type="button" onClick={copyPrompt} className="copy-btn">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
              </button>
              <pre>{agent.system_prompt}</pre>
            </div>
          )}

          {tab === "log" && (
            <pre>{agent.run_log ? agent.run_log.slice(0, 12000) : "No execution log yet."}</pre>
          )}

          {tab === "eval" && (
            <div>
              {evaluation ? (
                <>
                  <p>
                    <strong>{evaluation.score}/100</strong> <span className="status-badge">{evaluation.status}</span>
                  </p>
                  <p>{evaluation.summary}</p>
                  {evaluation.prompt_patch && (
                    <>
                      <h4>Proposed prompt improvement</h4>
                      <pre>{evaluation.prompt_patch}</pre>
                    </>
                  )}
                  <p className="item-meta"><Brain className="size-3" /> Lessons written to global memory.</p>
                </>
              ) : (
                <p>{agent.status === "completed" ? "Evaluation pending…" : "Runs here after completion."}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
