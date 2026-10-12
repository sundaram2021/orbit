"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, ChatKind } from "@/types/orbit-types";

export function useChat(kind: ChatKind) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/${kind}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    } finally {
      setIsLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    // Intentional: fetch history on mount / kind change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const send = useCallback(
    async (content: string) => {
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
          body: JSON.stringify({ message: text }),
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
        const refreshed = await fetch(`/api/chat/${kind}`).then((r) => r.json()) as {
          messages: ChatMessage[];
        };
        setMessages(refreshed.messages ?? []);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Send failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
      }
    },
    [kind, isStreaming]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { messages, isLoading, isStreaming, error, send, stop, reload: load };
}
