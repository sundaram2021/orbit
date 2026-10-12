"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  GitBranch,
  ChevronsUpDown,
  Filter,
} from "lucide-react";
import { SubAgent } from "@/types/orbit-types";
import { formatRelativeTime } from "@/lib/format-helpers";

function getStatusBadge(status?: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    case "running":
      return "bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse";
    case "failed":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    case "awaiting_approval":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getKindBadge(kind?: string) {
  switch (kind) {
    case "review":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "testing":
      return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    case "implementation":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    default:
      return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

export function TracesView() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "logs" | "running" | "completed" | "failed">("all");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = (await res.json()) as { agents: SubAgent[] };
      const list = data.agents ?? [];
      setAgents(list);
      // Auto-expand the most recent agent on initial load if none expanded
      setExpandedIds((prev) => {
        if (prev.size === 0 && list.length > 0) {
          return new Set([list[0].id]);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    const onRefresh = () => void load();
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(agents.map((a) => a.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const copyLog = async (id: string, log: string) => {
    try {
      await navigator.clipboard.writeText(log);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (selectedAgentId !== "all" && a.id !== selectedAgentId) return false;
      if (filter === "logs") return Boolean(a.run_log && a.run_log.trim());
      if (filter === "running") return a.status === "running";
      if (filter === "completed") return a.status === "completed";
      if (filter === "failed") return a.status === "failed";
      return true;
    });
  }, [agents, filter, selectedAgentId]);

  const withLogsCount = useMemo(
    () => agents.filter((a) => Boolean(a.run_log && a.run_log.trim())).length,
    [agents]
  );

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Traces</h1>
          <p>Every step of every sub-agent run, captured in the execution log.</p>
        </div>

        {/* Top Controls: Dropdowns and Expand/Collapse */}
        <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
          {/* Dropdown: Select Agent */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="size-3.5 text-muted-foreground" />
            <select
              value={selectedAgentId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedAgentId(id);
                if (id !== "all") {
                  setExpandedIds(new Set([id]));
                }
              }}
              className="px-2 py-1 text-xs rounded-md border border-input bg-background hover:bg-accent cursor-pointer transition-colors"
              aria-label="Filter by agent"
            >
              <option value="all">All Agents ({agents.length})</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title.slice(0, 36)}… ({a.kind})
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown: Filter by Status / Logs */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-2 py-1 text-xs rounded-md border border-input bg-background hover:bg-accent cursor-pointer transition-colors"
            aria-label="Filter status"
          >
            <option value="all">Status: All ({agents.length})</option>
            <option value="logs">With logs ({withLogsCount})</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>

          {/* Expand / Collapse All Toggle */}
          <button
            type="button"
            onClick={() => {
              if (expandedIds.size === filteredAgents.length) collapseAll();
              else expandAll();
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-input bg-background hover:bg-accent cursor-pointer transition-colors"
            title="Toggle expand/collapse all"
          >
            <ChevronsUpDown className="size-3.5" />
            <span>{expandedIds.size === filteredAgents.length && filteredAgents.length > 0 ? "Collapse all" : "Expand all"}</span>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="size-4 animate-spin" /> Loading traces…
        </div>
      )}

      {!isLoading && filteredAgents.length === 0 && (
        <section className="panel">
          <div className="panel-empty">
            No agents found matching the selected filter. Run an agent to see execution traces here.
          </div>
        </section>
      )}

      {filteredAgents.map((a) => {
        const isExpanded = expandedIds.has(a.id);
        const log = a.run_log?.trim() ?? "";
        const lineCount = log ? log.split("\n").length : 0;

        return (
          <section
            key={a.id}
            className="panel transition-all duration-150"
            style={{ marginBottom: 16 }}
          >
            {/* Clickable Dropdown Header */}
            <div
              onClick={() => toggleExpand(a.id)}
              className="panel-heading cursor-pointer select-none hover:bg-accent/40 transition-colors flex items-center justify-between gap-3 px-4 py-3"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpand(a.id);
                }
              }}
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-muted-foreground hover:text-foreground transition-transform">
                  {isExpanded ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </span>
                <h2 className="text-sm font-medium truncate" title={a.title}>
                  {a.title}
                </h2>
              </div>

              {/* Badges strip */}
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded border ${getKindBadge(a.kind)}`}>
                  {a.kind}
                </span>

                <span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded border ${getStatusBadge(a.status)}`}>
                  {(a.status ?? "").replace(/_/g, " ")}
                </span>

                {a.eval_score != null && (
                  <span className="mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">
                    SCORE {a.eval_score}
                  </span>
                )}

                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  {formatRelativeTime(a.created_at)}
                </span>
              </div>
            </div>

            {/* Dropdown Content */}
            {isExpanded && (
              <div className="border-t border-border/60 bg-card/50 p-4 space-y-3">
                {/* Agent Metadata Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pb-2 border-b border-border/40">
                  <div className="flex flex-wrap items-center gap-3">
                    {a.result?.repo && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <strong>Repo:</strong> {a.result.repo}
                      </span>
                    )}

                    {a.result?.branch && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <GitBranch className="size-3" /> {a.result.branch}
                      </span>
                    )}

                    {a.result?.pr_url && (
                      <a
                        href={a.result.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-[11px]"
                      >
                        PR #{a.result.pr_number ?? "view"} <ExternalLink className="size-3" />
                      </a>
                    )}

                    {a.result?.issue_url && (
                      <a
                        href={a.result.issue_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-[11px]"
                      >
                        Issue #{a.result.issue_number ?? "view"} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {lineCount > 0 && (
                      <span className="text-[11px] text-muted-foreground mono">
                        {lineCount} lines
                      </span>
                    )}

                    {log && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyLog(a.id, log);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-input bg-background hover:bg-accent cursor-pointer transition-colors"
                        title="Copy execution trace to clipboard"
                      >
                        {copiedId === a.id ? (
                          <>
                            <Check className="size-3 text-emerald-500" />
                            <span className="text-emerald-500 font-medium">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>Copy trace</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Log display */}
                {log ? (
                  <div className="relative rounded-md border border-border/80 bg-black/60 p-3.5 font-mono text-[11.5px] leading-relaxed text-zinc-200 overflow-x-auto max-h-[500px] overflow-y-auto space-y-1 shadow-inner">
                    {log.split("\n").map((line, idx) => {
                      const isToolCall = line.startsWith("[tools:") || line.includes("tool call:");
                      const isStep = line.startsWith("[step") || line.startsWith("Step ");
                      const isOutput = line.startsWith("stdout:") || line.startsWith("stderr:");
                      const isCompleted = line.includes("completed") || line.includes("Finished");

                      let lineClass = "text-zinc-300";
                      if (isToolCall) lineClass = "text-amber-400 font-semibold";
                      else if (isStep) lineClass = "text-sky-400 font-medium";
                      else if (isOutput) lineClass = "text-zinc-400";
                      else if (isCompleted) lineClass = "text-emerald-400 font-semibold";

                      return (
                        <div key={idx} className={`whitespace-pre-wrap break-all ${lineClass}`}>
                          {line || "\u00A0"}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-md border border-dashed border-border">
                    <Terminal className="size-5 mx-auto mb-1.5 opacity-40" />
                    <p>No execution trace recorded yet for this agent.</p>
                    <p className="text-[11px] mt-0.5">Status: <strong className="uppercase">{a.status}</strong></p>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
