"use client";

import React, { useEffect } from "react";
import { X, MessageSquareText, Plus } from "lucide-react";
import { ChatThread } from "@/hooks/use-chat";
import { RowSkeleton, FetchError } from "@/components/common/loading";

interface ChatHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ChatThread[];
  activeThreadId: string | null;
  isLoading: boolean;
  threadsError?: string | null;
  onRetryThreads?: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  isCreating?: boolean;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ChatHistoryPanel({
  isOpen,
  onClose,
  threads,
  activeThreadId,
  isLoading,
  threadsError,
  onRetryThreads,
  onSelect,
  onNew,
  isCreating,
}: ChatHistoryPanelProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="history-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="history-panel" aria-label="Chat history">
        <div className="history-panel-head">
          <h2>Chat history</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Close history"
          >
            <X className="size-4" />
          </button>
        </div>

        <button type="button" onClick={onNew} disabled={isCreating} className="history-new">
          <Plus className="size-3.5" /> {isCreating ? "Starting…" : "New chat"}
        </button>

        {isLoading ? (
          <div aria-busy="true">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : null}

        {threadsError && !isLoading ? (
          <FetchError message={threadsError} onRetry={onRetryThreads} />
        ) : null}

        {!isLoading && !threadsError && threads.length === 0 && (
          <div className="panel-empty">No past chats yet.</div>
        )}

        <div className="history-list">
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`history-item ${t.id === activeThreadId ? "active" : ""}`}
              onClick={() => onSelect(t.id)}
            >
              <MessageSquareText className="size-4" />
              <div>
                <p>{t.title || "New conversation"}</p>
                <small>
                  {t.message_count} message{t.message_count === 1 ? "" : "s"} · {timeAgo(t.updated_at)}
                </small>
              </div>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
