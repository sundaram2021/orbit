"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, ChatKind } from "@/types/orbit-types";

const ACTIVE_REPO_KEY = "orbit-active-repo";
const ACTIVE_THREAD_KEY = "orbit-thread-id";

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
  const [error, setError] = useState<string | null>(null);
  const [activeRepo, setActiveRepoState] = useState<string>("");
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const activeRepoRef = useRef<string>("");
  const threadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Intentional: hydrate persisted repo/thread on mount.
    try {
      const saved = localStorage.getItem(ACTIVE_REPO_KEY) ?? "";
      activeRepoRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRepoState(saved);
      threadIdRef.current = localStorage.getItem(ACTIVE_THREAD_KEY);
    } catch {
      // storage unavailable
    }
  }, []);

  const setActiveRepo = useCallback((repo: string) => {
    activeRepoRef.current = repo;
    setActiveRepoState(repo);
    try {
      if (repo) localStorage.setItem(ACTIVE_REPO_KEY, repo);
      else localStorage.removeItem(ACTIVE_REPO_KEY);
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
      if (!res.ok) return [];
      const data = (await res.json()) as { threads: ChatThread[] };
      const list = data.threads ?? [];
      setThreads(list);
      return list;
    } catch {
      return [];
    }
  }, [kind]);

  const selectThread = useCallback(
    async (id: string | null) => {
      threadIdRef.current = id;
      setThreadIdState(id);
      try {
        if (id) localStorage.setItem(ACTIVE_THREAD_KEY, id);
        else localStorage.removeItem(ACTIVE_THREAD_KEY);
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
    if (kind !== "orchestrator") return null;
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
    }
  }, [kind, loadThreads, selectThread]);

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
                status?: string;
                tool?: string;
                label?: string;
                steps?: Array<{ tool: string; label: string; status: "done" | "error" }>;
              };
              if (payload.type === "status" && payload.label) {
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
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          steps: (m.steps ?? []).map((s) =>
                            s.tool === payload.tool && s.status === "running"
                              ? { ...s, status: "done", label: payload.label ?? s.label }
                              : s
                          ),
                        }
                      : m
                  )
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
        // Refresh ids from server (replaces optimistic entries).
        const refreshed = (await fetch(
          `/api/chat/${kind}${threadIdRef.current ? `?thread_id=${encodeURIComponent(threadIdRef.current)}` : ""}`
        ).then((r) => r.json())) as {
          messages: ChatMessage[];
        };
        setMessages((prev) => {
          const lastWithSteps = prev.find((m) => m.id === assistantId && m.steps && m.steps.length > 0);
          return (refreshed.messages ?? [])
            .filter((m) => !isNotice(m.content))
            .map((m, idx, arr) => {
              if (idx === arr.length - 1 && m.role === "assistant" && lastWithSteps?.steps) {
                return { ...m, steps: lastWithSteps.steps };
              }
              return m;
            });
        });
        // Titles/counts may have changed (auto-title on first message).
        void loadThreads();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Send failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
        setActiveStep(null);
      }
    },
    [kind, isStreaming, loadThreads]
  );

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
    activeStep,
    error,
    send,
    stop,
    reload: load,
    selectThread,
    newChat,
    refreshThreads: loadThreads,
    activeRepo,
    setActiveRepo,
  };
}

export type UseChat = ReturnType<typeof useChat>;
