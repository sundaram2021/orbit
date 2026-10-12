"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Square, Bot, User, Loader2 } from "lucide-react";
import { useChat } from "@/hooks/use-chat";
import { ChatKind } from "@/types/orbit-types";

interface ChatPanelProps {
  kind: ChatKind;
  title: string;
  subtitle: string;
  placeholder: string;
}

export function ChatPanel({ kind, title, subtitle, placeholder }: ChatPanelProps) {
  const { messages, isLoading, isStreaming, error, send, stop } = useChat(kind);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    void send(input);
    setInput("");
  };

  return (
    <section className="chat-panel" aria-label={title}>
      <header className="chat-panel-head">
        <span className="chat-avatar" data-kind={kind}>
          <Bot className="size-4" />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {isStreaming && <span className="live-dot" title="streaming" />}
      </header>

      <div className="chat-messages">
        {isLoading && messages.length === 0 && (
          <div className="chat-loading">
            <Loader2 className="size-4 animate-spin" /> Loading conversation…
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="chat-empty">
            {kind === "orchestrator"
              ? "Ask me to fix an issue, review a PR, or ship a feature — I'll spin up a sub-agent for it."
              : "Ask me how your agents are performing, why something scored the way it did, or what I'm proposing to improve."}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <span className="chat-msg-icon">
              {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </span>
            <div className="chat-msg-body">
              {m.content.split("\n").map((line, i) => (
                <p key={i}>{line || "\u00A0"}</p>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-composer" onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={isStreaming}
          aria-label={`${title} message`}
        />
        {isStreaming ? (
          <button type="button" onClick={stop} aria-label="Stop streaming">
            <Square className="size-4" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} aria-label="Send message">
            <Send className="size-4" />
          </button>
        )}
      </form>
    </section>
  );
}
