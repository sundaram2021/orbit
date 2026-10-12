"use client";

import React from "react";
import { X, MessageSquareText, Plus, Loader2 } from "lucide-react";
import { ChatThread } from "@/hooks/use-chat";

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ChatThread[];
  activeThreadId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ChatHistoryModal({
  isOpen,
  onClose,
  threads,
  activeThreadId,
  isLoading,
  onSelect,
  onNew,
}: ChatHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="task-modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
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

        <button type="button" onClick={onNew} className="history-new">
          <Plus className="size-3.5" /> New chat
        </button>

        {isLoading && (
          <div className="chat-loading">
            <Loader2 className="size-4 animate-spin" /> Loading history…
          </div>
        )}

        {!isLoading && threads.length === 0 && (
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
      </div>
    </div>
  );
}
