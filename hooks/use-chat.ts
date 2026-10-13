"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, ChatKind } from "@/types/orbit-types";

const STORAGE_VERSION = "v1";
const REPO_KEY = `orbit:${STORAGE_VERSION}:repo`;
const THREAD_KEY = `orbit:${STORAGE_VERSION}:thread`;
const LEGACY_REPO_KEY = "orbit-active-repo";
const LEGACY_THREAD_KEY = "orbit-thread-id";

function readStorage(key: string, legacyKey?: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) {
      // New envelope: {"v":1,"value":"..."}; bare strings accepted for compat.
      try {
        const parsed = JSON.parse(raw) as { v?: number; value?: unknown };
        if (parsed && parsed.v === 1 && typeof parsed.value === "string") return parsed.value;
        if (typeof parsed === "string") return parsed;
      } catch {
        return raw;
      }
      return raw;
    }
    if (legacyKey) return localStorage.getItem(legacyKey);
    return null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, value }));
  } catch {
    // storage unavailable
  }
}

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  message_count: number;
}

export interface ChatAttachment {
  type: "issue" | "pr" | "file" | "image";
  /** Issue / PR number (for issue/pr attachments). */
  number?: number;
  /** Issue / PR title snapshot (for display + prompt). */
  title?: string;
  /** File / image name (for file/image attachments). */
  name?: string;
  /** File text content (truncated client-side, for file attachments). */
  content?: string;
  /** Data-URL (base64, downscaled client-side) for image attachments. */
  dataUrl?: string;
  /** MIME type for image attachments (e.g. image/png). */
  mediaType?: string;
}

/**
 * Legacy system notices ("Agent started…", "Your agent is ready…") that were
 * written into chat threads before notifications moved to toasts/activity.
 * Hidden so the chat stays a clean conversation.
 */
const NOTICE_PATTERN =
  /^\*\*(Agent started|Your agent is ready|Work ready|Done|Evaluation|Evaluator|PR (opened|merged)|Comment posted|Approval rejected|Agent cancelled|No changes needed|Orchestrator chat)/;

export function isNotice(content: string): boolean {
  return NOTICE_PATTERN.test(content.trim());
}

export function useChat(kind: ChatKind) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeRepo, setActiveRepoState] = useState<string>("");
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<{ content: string; attachments: ChatAttachment[] } | null>(null);
  const activeRepoRef = useRef<string>("");
  const threadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Intentional: hydrate persisted repo/thread on mount.
    try {
      const saved = readStorage(REPO_KEY, LEGACY_REPO_KEY) ?? "";
      activeRepoRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRepoState(saved);
      threadIdRef.current = readStorage(THREAD_KEY, LEGACY_THREAD_KEY);
    } catch {
      // storage unavailable
    }
  }, []);

  const setActiveRepo = useCallback((repo: string) => {
    activeRepoRef.current = repo;
    setActiveRepoState(repo);
    try {
      if (repo) writeStorage(REPO_KEY, repo);
      else localStorage.removeItem(REPO_KEY);
    } catch {
      // storage unavailable
    }
  }, []);

  const loadMessages = useCallback(
    async (id: string | null) => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/chat/${kind}${id ? `?thread_id=${encodeURIComponent(id)}` : ""}`
        );
        if (!res.ok) throw new Error(`load failed (${res.status})`);
        const data = (await res.json()) as { messages: ChatMessage[] };
        setMessages((data.messages ?? []).filter((m) => !isNotice(m.content)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chat");
      } finally {
        setIsLoading(false);
      }
    },
    [kind]
  );

  const loadThreads = useCallback(async (): Promise<ChatThread[]> => {
    if (kind !== "orchestrator") return [];
    try {
      const res = await fetch("/api/chat/orchestrator/threads");
      if (!res.ok) throw new Error(`threads failed (${res.status})`);
      const data = (await res.json()) as { threads: ChatThread[] };
      const list = data.threads ?? [];
      setThreads(list);
      setThreadsError(null);
      return list;
    } catch {
      setThreadsError("Couldn't load chat history. Retry.");
      return [];
    }
  }, [kind]);

  const retryThreads = useCallback(() => {
    void loadThreads().catch(() => {});
  }, [loadThreads]);

  const selectThread = useCallback(
    async (id: string | null) => {
      threadIdRef.current = id;
      setThreadIdState(id);
      try {
        if (id) writeStorage(THREAD_KEY, id);
        else localStorage.removeItem(THREAD_KEY);
      } catch {
        // storage unavailable
      }
      await loadMessages(id);
    },
    [loadMessages]
  );

  const load = useCallback(async () => {
    const list = await loadThreads();
    const saved = threadIdRef.current;
    const pick =
      saved && list.some((t) => t.id === saved) ? saved : (list[0]?.id ?? null);
    threadIdRef.current = pick;
    setThreadIdState(pick);
    await loadMessages(pick);
  }, [loadThreads, loadMessages]);

  useEffect(() => {
    // Intentional: fetch history on mount / kind change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const newChat = useCallback(async (): Promise<string | null> => {
    if (kind !== "orchestrator" || isCreating) return null;
    setIsCreating(true);
    try {
      const res = await fetch("/api/chat/orchestrator/threads", { method: "POST" });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const data = (await res.json()) as { thread: ChatThread };
      await loadThreads();
      await selectThread(data.thread.id);
      return data.thread.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chat");
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [kind, isCreating, loadThreads, selectThread]);

  const send = useCallback(
    async (content: string, opts?: { repo?: string; attachments?: ChatAttachment[] }) => {
      const text = content.trim();
      const attachments = (opts?.attachments ?? []).filter(Boolean);
      if ((!text && attachments.length === 0) || isStreaming) return;
      setError(null);
      setIsStreaming(true);

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        thread_id: "",
        role: "user",
        content:
          attachments.length > 0
            ? [
                text,
                ...attachments.map((a) =>
                  a.type === "file"
                    ? `[file: ${a.name}]`
                    : a.type === "image"
                      ? `[image: ${a.name ?? "pasted image"}]`
                      : `[${a.type} #${a.number}: ${a.title ?? ""}]`.trim()
                ),
              ]
                .filter(Boolean)
                .join("\n")
            : text,
      };
      setMessages((prev) => [...prev, optimistic]);

      const assistantId = `stream-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, thread_id: "", role: "assistant", content: "" },
      ]);

      try {
        abortRef.current = new AbortController();
        const res = await fetch(`/api/chat/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            repo: opts?.repo || activeRepoRef.current || undefined,
            thread_id: threadIdRef.current || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
          signal: abortRef.current.signal,
        });
        if (!res.ok || !res.body) throw new Error(`send failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const payload = JSON.parse(line.slice(5).trim()) as {
                type?: string;
                delta?: string;
                done?: boolean;
                error?: string;
                retryable?: boolean;
                status?: string;
                tool?: string;
                label?: string;
                steps?: Array<{ tool: string; label: string; status: "done" | "error" }>;
              };
              if (payload.type === "error") {
                // Typed server failure — surface as a send error with retry,
                // not as assistant text, and never persisted into history.
                throw new Error(payload.error ?? "Request failed");
              } else if (payload.type === "status" && payload.label) {
                setActiveStep(payload.label);
              } else if (payload.type === "step_start" && payload.label) {
                setActiveStep(payload.label);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          steps: [
                            ...(m.steps ?? []),
                            { tool: payload.tool ?? "", label: payload.label ?? "", status: "running" },
                          ],
                        }
                      : m
                  )
                );
              } else if (payload.type === "step_done" && payload.tool) {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    const steps = [...(m.steps ?? [])];
                    // Match the LAST running step with this tool (multiple
                    // spawn_task calls share one tool name).
                    for (let i = steps.length - 1; i >= 0; i--) {
                      if (steps[i].tool === payload.tool && steps[i].status === "running") {
                        const failed = (payload.label ?? "").toLowerCase().startsWith("fail");
                        steps[i] = {
                          ...steps[i],
                          status: failed ? "error" : "done",
                          label: payload.label ?? steps[i].label,
                        };
                        break;
                      }
                    }
                    return { ...m, steps };
                  })
                );
              } else if (payload.delta) {
                setActiveStep(null);
                const delta = payload.delta;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
                );
              } else if (payload.done) {
                setActiveStep(null);
                if (payload.steps) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, steps: payload.steps } : m
                    )
                  );
                }
              }
            } catch {
              // ignore json parse error
            }
          }
        }
        // Refresh ids from server (replaces optimistic entries). Wrapped
        // separately so a refresh failure can't wipe just-streamed content.
        try {
          const refreshRes = await fetch(
            `/api/chat/${kind}${threadIdRef.current ? `?thread_id=${encodeURIComponent(threadIdRef.current)}` : ""}`
          );
          if (!refreshRes.ok) throw new Error(`refresh failed (${refreshRes.status})`);
          const refreshed = (await refreshRes.json()) as {
            messages: ChatMessage[];
          };
          setMessages((prev) => {
            const streamed = prev.find((m) => m.id === assistantId);
            const streamedSteps = streamed?.steps ?? [];
            const streamedContent = streamed?.content ?? "";
            const server = (refreshed.messages ?? []).filter((m) => !isNotice(m.content));
            if (server.length === 0 && (streamedContent || streamedSteps.length > 0)) {
              // Refresh failed silently server-side — keep what we streamed.
              return prev.map((m) =>
                m.id === assistantId ? { ...m, id: `streamed-${Date.now()}` } : m
              );
            }
            return server.map((m, idx, arr) => {
              const isLast = idx === arr.length - 1 && m.role === "assistant";
              // Prefer server-persisted steps (new steps column); fall back to
              // the just-streamed timeline so the UI never goes blank.
              if (isLast && (!m.steps || m.steps.length === 0) && streamedSteps.length > 0) {
                return { ...m, steps: streamedSteps };
              }
              return m;
            });
          });
        } catch (refreshErr) {
          console.warn("chat refresh failed, keeping streamed content:", refreshErr);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, id: `streamed-${Date.now()}` } : m
            )
          );
        }
        setLastFailed(null);
        // Titles/counts may have changed (auto-title on first message).
        void loadThreads().catch(() => {});
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Stopped by the user: drop both optimistic bubbles so nothing sticks.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== optimistic.id));
          setLastFailed({ content: text, attachments });
          return;
        }
        setError(err instanceof Error ? err.message : "Send failed");
        setLastFailed({ content: text, attachments });
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
        setActiveStep(null);
      }
    },
    [kind, isStreaming, loadThreads]
  );

  const retryLast = useCallback(() => {
    if (lastFailed && !isStreaming) {
      const { content, attachments } = lastFailed;
      setLastFailed(null);
      void send(content, { attachments });
    }
  }, [lastFailed, isStreaming, send]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setActiveStep(null);
  }, []);

  return {
    messages,
    threads,
    threadId,
    isLoading,
    isStreaming,
    isCreating,
    activeStep,
    error,
    threadsError,
    lastFailed,
    send,
    retryLast,
    stop,
    reload: load,
    selectThread,
    newChat,
    refreshThreads: loadThreads,
    retryThreads,
    activeRepo,
    setActiveRepo,
  };
}

export type UseChat = ReturnType<typeof useChat>;
