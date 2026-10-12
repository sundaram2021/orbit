"use client";

import React, { useState, useRef, useEffect } from "react";
import { SendHorizontal, Square, Bot, User, Loader2, ChevronDown, FolderGit2 } from "lucide-react";
import { UseChat } from "@/hooks/use-chat";
import { ChatKind } from "@/types/orbit-types";
import { renderMarkdown } from "@/lib/chat-markdown";

interface RepoOption {
  full_name: string;
  default_branch: string;
  private: boolean;
}

interface ChatPanelProps {
  kind: ChatKind;
  title: string;
  greeting: string;
  placeholder: string;
  suggestions: string[];
  chat: UseChat;
}

export function ChatPanel({ kind, title, greeting, placeholder, suggestions, chat }: ChatPanelProps) {
  const { messages, isLoading, isStreaming, error, send, stop, activeRepo, setActiveRepo } = chat;
  const [input, setInput] = useState("");
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const repoBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (kind !== "orchestrator") return;
    // Intentional: fetch repos on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReposLoading(true);
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data: { repos?: RepoOption[] }) => setRepos(data.repos ?? []))
      .catch(() => setRepos([]))
      .finally(() => setReposLoading(false));
  }, [kind]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (repoBoxRef.current && !repoBoxRef.current.contains(e.target as Node)) {
        setRepoOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    void send(input);
    setInput("");
  };

  const isLanding = messages.length === 0 && !isLoading;

  const repoSelector = kind === "orchestrator" && (
    <div className="repo-select" ref={repoBoxRef}>
      <button
        type="button"
        onClick={() => setRepoOpen((v) => !v)}
        aria-expanded={repoOpen}
        aria-label="Select repository"
        title={activeRepo || "Select a repository to work on"}
      >
        <FolderGit2 className="size-4" />
        <span>{activeRepo || "Select repo"}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {repoOpen && (
        <div className="repo-dropdown">
          {reposLoading && <div className="repo-empty">Loading repositories…</div>}
          {!reposLoading && repos.length === 0 && (
            <div className="repo-empty">No repositories found. Check GitHub connection.</div>
          )}
          {activeRepo && (
            <button type="button" className="repo-clear" onClick={() => { setActiveRepo(""); setRepoOpen(false); }}>
              Clear selection
            </button>
          )}
          {repos.map((r) => (
            <button
              key={r.full_name}
              type="button"
              className={r.full_name === activeRepo ? "active" : ""}
              onClick={() => { setActiveRepo(r.full_name); setRepoOpen(false); }}
            >
              <span>{r.full_name}</span>
              {r.private && <em>private</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const composer = (
    <form className="gpt-composer" onSubmit={onSubmit}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={activeRepo ? `Ask about ${activeRepo}…` : placeholder}
        disabled={isStreaming}
        aria-label={`${title} message`}
      />
      {isStreaming ? (
        <button type="button" onClick={stop} aria-label="Stop streaming" className="gpt-send">
          <Square className="size-4" />
        </button>
      ) : (
        <button type="submit" disabled={!input.trim()} aria-label="Send message" className="gpt-send">
          <SendHorizontal className="size-4" />
        </button>
      )}
    </form>
  );

  if (isLanding) {
    return (
      <section className="gpt-landing" aria-label={title}>
        <h2>{greeting}</h2>
        {repoSelector}
        <div className="gpt-hero-box">
          {composer}
        </div>
        <div className="chat-chips chat-chips-center">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setInput(s)}>
              {s}
            </button>
          ))}
        </div>
        {error && <div className="chat-error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="gpt-thread" aria-label={title}>
      <div className="gpt-thread-head">
        {repoSelector}
        {isStreaming && <span className="chat-streaming-dot" title="streaming" />}
      </div>

      <div className="gpt-messages">
        {isLoading && (
          <div className="chat-loading">
            <Loader2 className="size-4 animate-spin" /> Loading conversation…
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <span className="chat-msg-icon">
              {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </span>
            <div className="chat-msg-body">
              {m.role === "user"
                ? m.content.split("\n").map((line, i) => <p key={i}>{line || "\u00A0"}</p>)
                : renderMarkdown(m.content)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="gpt-bottom">
        <p className="gpt-note">Orbit acts on your GitHub — approvals appear as notifications.</p>
        {composer}
      </div>
    </section>
  );
}
