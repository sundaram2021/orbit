"use client";

import React, { useState } from "react";
import { Plus, History } from "lucide-react";
import { useChat } from "@/hooks/use-chat";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatHistoryPanel } from "@/components/chat/chat-history-panel";

const ORCHESTRATOR_SUGGESTIONS = [
  "What assigned issues do I have?",
  "Review my latest PR",
  "Create a PR for my recent changes",
];

export function OrchestratorView() {
  const chat = useChat("orchestrator");
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="orch-page">
      <div className="orch-top">
        <button
          type="button"
          onClick={() => {
            void chat.refreshThreads();
            setHistoryOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors border border-input bg-background hover:bg-accent h-9 px-4 py-2"
          aria-expanded={historyOpen}
          aria-label="Open chat history"
        >
          <History className="size-4" />
          History
        </button>
        <button
          id="new-task-btn"
          type="button"
          onClick={() => {
            // New-task workflow: start a fresh centered chat. The user picks
            // a repo, optionally attaches file/issue/PR via "+", then prompts.
            void chat.newChat();
          }}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
        >
          <Plus className="size-4" />
          New task
        </button>
      </div>

      <ChatPanel
        kind="orchestrator"
        title="Orchestrator"
        greeting="Where should we begin?"
        placeholder="Ask for anything…"
        suggestions={ORCHESTRATOR_SUGGESTIONS}
        chat={chat}
      />

      <ChatHistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        threads={chat.threads}
        activeThreadId={chat.threadId}
        isLoading={chat.isLoading && chat.threads.length === 0}
        onSelect={(id: string) => {
          void chat.selectThread(id);
          setHistoryOpen(false);
        }}
        onNew={() => {
          void chat.newChat();
          setHistoryOpen(false);
        }}
      />
    </div>
  );
}
