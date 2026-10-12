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
  // Selected repo context (orchestrator): every request acts on this repo
  // unless the user names another one. Persisted across sessions.
  const [activeRepo, setActiveRepoState] = useState<string>("");
  const activeRepoRef = useRef<string>("");
  const threadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Intentional: hydrate persisted repo/thread on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try {
      const saved = localStorage.getItem(ACTIVE_REPO_KEY) ?? "";
      activeRepoRef.current = saved;
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
    async (content: string, opts?: { repo?: string }) => {
      const text = content.trim();
      if (!text || isStreaming) return;
      setError(null);
      setIsStreaming(true);

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        thread_id: "",
        role: "user",
        content: text,
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
            const payload = JSON.parse(line.slice(5).trim()) as {
              delta?: string;
              done?: boolean;
            };
            if (payload.delta) {
              const delta = payload.delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
              );
            }
          }
        }
        // Refresh ids from server (replaces optimistic entries).
        const refreshed = await fetch(
          `/api/chat/${kind}${threadIdRef.current ? `?thread_id=${encodeURIComponent(threadIdRef.current)}` : ""}`
        ).then((r) => r.json()) as {
          messages: ChatMessage[];
        };
        setMessages((refreshed.messages ?? []).filter((m) => !isNotice(m.content)));
        // Titles/counts may have changed (auto-title on first message).
        void loadThreads();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Send failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
      }
    },
    [kind, isStreaming, loadThreads]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    messages,
    threads,
    threadId,
    isLoading,
    isStreaming,
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
