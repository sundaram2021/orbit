"use client";

import React from "react";
import { Plus, History } from "lucide-react";
import { useModal } from "@/hooks/use-modal";
import { useChat } from "@/hooks/use-chat";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatHistoryModal } from "@/components/chat/chat-history-modal";

const ORCHESTRATOR_SUGGESTIONS = [
  "What assigned issues do I have?",
  "Review my latest PR",
  "Create a PR for my recent changes",
];

export function OrchestratorView({ onNewTask }: { onNewTask: () => void }) {
  const chat = useChat("orchestrator");
  const historyModal = useModal();

  return (
    <div className="orch-page">
      <div className="orch-top">
        <button
          type="button"
          onClick={() => {
            void chat.refreshThreads();
            historyModal.open();
          }}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors border border-input bg-background hover:bg-accent h-9 px-4 py-2"
        >
          <History className="size-4" />
          History
        </button>
        <button
          id="new-task-btn"
          type="button"
          onClick={onNewTask}
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

      <ChatHistoryModal
        isOpen={historyModal.isOpen}
        onClose={historyModal.close}
        threads={chat.threads}
        activeThreadId={chat.threadId}
        isLoading={chat.isLoading && chat.threads.length === 0}
        onSelect={(id) => {
          void chat.selectThread(id);
          historyModal.close();
        }}
        onNew={() => {
          void chat.newChat();
          historyModal.close();
        }}
      />
    </div>
  );
}
