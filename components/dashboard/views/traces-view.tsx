"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
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
import { LogSkeleton, FetchError } from "@/components/common/loading";

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

const UNDERSCORE_RE = /_/g;

const NO_TRACES_EMPTY = (
  <section className="panel">
    <div className="panel-empty">
      No agents found matching the selected filter. Run an agent to see execution traces here.
    </div>
  </section>
);

function classifyLogLine(line: string): string {
  if (line.startsWith("[tools:") || line.includes("tool call:")) return "text-amber-400 font-semibold";
  if (line.startsWith("[step") || line.startsWith("Step ")) return "text-sky-400 font-medium";
  if (line.startsWith("stdout:") || line.startsWith("stderr:")) return "text-zinc-400";
  if (line.includes("completed") || line.includes("Finished")) return "text-emerald-400 font-semibold";
  return "text-zinc-300";
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [, setUserExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deferredFilter = React.useDeferredValue(filter);
  const deferredAgentId = React.useDeferredValue(selectedAgentId);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as { agents: SubAgent[] };
      const list = data.agents ?? [];
      setAgents(list);
      setLoadError(null);
      // Auto-expand the most recent agent on initial load if user never toggled.
      setUserExpanded((touched) => {
        if (!touched && list.length > 0) {
          setExpandedIds(new Set([list[0].id]));
        }
        return touched;
      });
    } catch {
      setLoadError("Couldn't load traces. Check your connection and retry.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 20000);
    const onRefresh = () => void load().catch(() => {});
    window.addEventListener("orbit:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("orbit:refresh", onRefresh);
    };
  }, [load]);

  const toggleExpand = (id: string) => {
    setUserExpanded(true);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setUserExpanded(true);
    setExpandedIds(new Set(agents.map((a) => a.id)));
  };

  const collapseAll = () => {
    setUserExpanded(true);
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
    const f = deferredFilter;
    const sel = deferredAgentId;
    return agents.filter((a) => {
      if (sel !== "all" && a.id !== sel) return false;
      if (f === "logs") return Boolean(a.run_log && a.run_log.trim());
      if (f === "running") return a.status === "running";
      if (f === "completed") return a.status === "completed";
      if (f === "failed") return a.status === "failed";
      return true;
    });
  }, [agents, deferredFilter, deferredAgentId]);

  const withLogsCount = useMemo(() => {
    let n = 0;
    for (const a of agents) {
      if (a.run_log && a.run_log.trim()) n++;
    }
    return n;
  }, [agents]);

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

      {loadError && !isLoading ? (
        <FetchError message={loadError} onRetry={handleRetry} />
      ) : null}

      {isLoading ? (
        <div aria-busy="true">
          <LogSkeleton />
          <LogSkeleton />
        </div>
      ) : null}

      {!isLoading && !loadError && filteredAgents.length === 0
        ? (agents.length === 0 ? NO_TRACES_EMPTY : (
          <section className="panel">
            <div className="panel-empty">
              No traces match the selected filter. Adjust the filters to see more.
            </div>
          </section>
        ))
        : null}

      {filteredAgents.map((a) => (
        <TraceCard
          key={a.id}
          agent={a}
          expanded={expandedIds.has(a.id)}
          onToggle={() => toggleExpand(a.id)}
          copied={copiedId === a.id}
          onCopy={(log) => void copyLog(a.id, log)}
        />
      ))}
    </div>
  );
}

function TraceCard({
  agent: a,
  expanded: isExpanded,
  onToggle,
  copied,
  onCopy,
}: {
  agent: SubAgent;
  expanded: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: (log: string) => void;
}) {
  const lines = useMemo(() => {
    const log = a.run_log?.trim() ?? "";
    if (!log) return [] as string[];
    const all = log.split("\n");
    return all.length > 400 ? all.slice(0, 400) : all;
  }, [a.run_log]);
  const log = a.run_log?.trim() ?? "";
  const lineCount = log ? lines.length : 0;
  return (
          <section
            key={a.id}
            className="panel transition-all duration-150"
            style={{ marginBottom: 16, contentVisibility: "auto", containIntrinsicSize: "0 320px" }}
          >
            {/* Clickable Dropdown Header */}
            <div
              onClick={onToggle}
              className="panel-heading cursor-pointer select-none hover:bg-accent/40 transition-colors flex items-center justify-between gap-3 px-4 py-3"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
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
                  {(a.status ?? "").replace(UNDERSCORE_RE, " ")}
                </span>

                {a.eval_score != null ? (
                  <span className="mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">
                    SCORE {a.eval_score}
                  </span>
                ) : null}

                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  {formatRelativeTime(a.created_at)}
                </span>
              </div>
            </div>

            {/* Dropdown Content */}
            {isExpanded ? (
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
                    {lineCount > 0 ? (
                      <span className="text-[11px] text-muted-foreground mono">
                        {lineCount} lines
                      </span>
                    ) : null}

                    {log ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopy(log);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-input bg-background hover:bg-accent cursor-pointer transition-colors"
                        title="Copy execution trace to clipboard"
                      >
                        {copied ? (
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
                    ) : null}
                  </div>
                </div>

                {/* Log display */}
                {log ? (
                  <div className="relative rounded-md border border-border/80 bg-black/60 p-3.5 font-mono text-[11.5px] leading-relaxed text-zinc-200 overflow-x-auto max-h-[500px] overflow-y-auto space-y-1 shadow-inner">
                    {lines.map((line, idx) => (
                      <div key={idx} className={`whitespace-pre-wrap break-all ${classifyLogLine(line)}`}>
                        {line || " "}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-md border border-dashed border-border">
                    <Terminal className="size-5 mx-auto mb-1.5 opacity-40" />
                    <p>No execution trace recorded yet for this agent.</p>
                    <p className="text-[11px] mt-0.5">Status: <strong className="uppercase">{a.status}</strong></p>
                  </div>
                )}
              </div>
            ) : null}
          </section>
  );
}
