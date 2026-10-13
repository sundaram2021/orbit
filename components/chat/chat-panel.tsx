"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  SendHorizontal,
  Square,
  Bot,
  User,
  Loader2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Plus,
  Upload,
  CircleDot,
  GitPullRequest,
  Check,
  X,
  Image as ImageIcon,
  Sparkles,
  Orbit,
} from "lucide-react";
import { UseChat, ChatAttachment } from "@/hooks/use-chat";
import { ChatKind } from "@/types/orbit-types";
import { renderMarkdown } from "@/lib/chat-markdown";
import { ApprovalCards } from "./approval-cards";
import { ChatSteps, ChatLiveIndicator } from "./chat-steps";

interface RepoOption {
  full_name: string;
  default_branch: string;
  private: boolean;
}

interface GithubItem {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
}

interface ChatPanelProps {
  kind: ChatKind;
  title: string;
  greeting: string;
  placeholder: string;
  suggestions: string[];
  chat: UseChat;
}

type PickerTab = "issues" | "prs" | null;

const MAX_FILE_CHARS = 20000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_IMAGE_DIM = 1568;

/**
 * Downscale an image client-side (canvas) so pasted/uploaded images stay
 * small enough to send as vision context. Returns a JPEG data URL.
 */
async function processImageFile(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, mediaType: "image/jpeg" };
}

async function fileToImageAttachment(file: File): Promise<ChatAttachment> {
  const { dataUrl, mediaType } = await processImageFile(file);
  return { type: "image", name: file.name || "pasted image", dataUrl, mediaType };
}

export function ChatPanel({ kind, title, greeting, placeholder, suggestions, chat }: ChatPanelProps) {
  const { messages, isLoading, isStreaming, activeStep, error, send, stop, retryLast, lastFailed, activeRepo, setActiveRepo } = chat;
  const [input, setInput] = useState("");
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoOpen, setRepoOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>(null);
  const [pickerItems, setPickerItems] = useState<GithubItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const repoBoxRef = useRef<HTMLDivElement>(null);
  const plusBoxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  // Single global scrollbar: stickiness is measured against the page, not an
  // inner scroll box, so the chat never renders a second scrollbar.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      stickRef.current = doc.scrollHeight - window.innerHeight - window.scrollY < 160;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Follow the conversation: snap on new messages, follow deltas while streaming.
  useEffect(() => {
    if (stickRef.current) scrollToBottom(isStreaming);
  }, [messages, activeStep, isStreaming, scrollToBottom]);

  // Keep the composer focused after sending.
  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  const autogrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      autogrow();
    },
    [autogrow]
  );

  useEffect(() => {
    if (kind !== "orchestrator") return;
    // Intentional: fetch repos on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReposLoading(true);
    setReposError(null);
    fetch("/api/repos")
      .then((r) => {
        if (!r.ok) throw new Error(`repos failed (${r.status})`);
        return r.json();
      })
      .then((data: { repos?: RepoOption[] }) => setRepos(data.repos ?? []))
      .catch(() => {
        setRepos([]);
        setReposError("Couldn't load repositories. Check GitHub connection.");
      })
      .finally(() => setReposLoading(false));
  }, [kind]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (repoBoxRef.current && !repoBoxRef.current.contains(e.target as Node)) {
        setRepoOpen(false);
      }
      if (plusBoxRef.current && !plusBoxRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
        setPickerTab(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Clear issue/PR attachments when the repo changes — they belong to the old repo.
  // Files and pasted images are repo-independent, so they survive the switch.
  const handleSelectRepo = (fullName: string) => {
    setActiveRepo(fullName);
    setRepoOpen(false);
    setAttachments((prev) => prev.filter((a) => a.type === "file" || a.type === "image"));
    setPickerTab(null);
    setPickerItems([]);
  };

  const openPicker = async (tab: "issues" | "prs") => {
    if (!activeRepo) return;
    setPickerTab(tab);
    setPickerLoading(true);
    setPickerError(null);
    setPickerItems([]);
    try {
      const res = await fetch(
        `/api/github/list?repo=${encodeURIComponent(activeRepo)}&type=${tab}`
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `list failed (${res.status})`);
      }
      const data = (await res.json()) as { items?: GithubItem[] };
      setPickerItems(data.items ?? []);
    } catch (err) {
      setPickerItems([]);
      setPickerError((err as Error).message);
    } finally {
      setPickerLoading(false);
    }
  };

  const toggleAttachment = (item: GithubItem, type: "issue" | "pr") => {
    setAttachments((prev) => {
      const exists = prev.some((a) => a.type === type && a.number === item.number);
      if (exists) return prev.filter((a) => !(a.type === type && a.number === item.number));
      return [...prev, { type, number: item.number, title: item.title }];
    });
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Images go through the vision path (downscaled data URL), not the text path.
    if (file.type.startsWith("image/")) {
      await addImageFiles([file]);
      setPlusOpen(false);
      return;
    }
    try {
      const text = await file.text();
      const truncated =
        text.length > MAX_FILE_CHARS
          ? text.slice(0, MAX_FILE_CHARS) + `\n…(truncated ${text.length - MAX_FILE_CHARS} chars)`
          : text;
      setAttachments((prev) => [...prev, { type: "file", name: file.name, content: truncated }]);
      setFileNotice(null);
    } catch {
      setFileNotice(`Couldn't read ${file.name} — skipped.`);
    }
    setPlusOpen(false);
  };

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const room = MAX_IMAGES - attachments.filter((a) => a.type === "image").length;
    if (room <= 0) {
      setFileNotice(`Image limit reached (${MAX_IMAGES}). Remove one to add more.`);
      return;
    }
    let skipped = 0;
    for (const file of imageFiles.slice(0, room)) {
      if (file.size > MAX_IMAGE_BYTES * 3) { skipped++; continue; } // reject absurdly large originals
      try {
        const att = await fileToImageAttachment(file);
        // Approx guard: downscaled JPEG data URL should stay well under ~1.5MB.
        if ((att.dataUrl?.length ?? 0) > 2_000_000) { skipped++; continue; }
        setAttachments((prev) => [...prev, att]);
      } catch {
        skipped++;
      }
    }
    setFileNotice(skipped > 0 ? `Skipped ${skipped} image${skipped === 1 ? "" : "s"} (too large or unreadable).` : null);
  };

  /** Paste screenshots / copied images straight into the composer. */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;
    e.preventDefault();
    void addImageFiles(files);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const needsRepo = kind === "orchestrator" && !activeRepo;

  const doSend = useCallback(
    (text: string) => {
      if ((!text.trim() && attachments.length === 0) || isStreaming || needsRepo) return;
      stickRef.current = true;
      void send(text, { attachments });
      setInput("");
      setAttachments([]);
      setPlusOpen(false);
      setPickerTab(null);
      requestAnimationFrame(() => scrollToBottom(false));
    },
    [attachments, isStreaming, needsRepo, send, scrollToBottom]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSend(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend(input);
    }
  };

  const isLanding = messages.length === 0 && !isLoading;
  const hasRepo = kind === "orchestrator" && !!activeRepo;
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const filteredPicker = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerItems;
    return pickerItems.filter(
      (i) => i.title.toLowerCase().includes(q) || String(i.number).includes(q)
    );
  }, [pickerItems, pickerQuery]);

  const selectedKeys = useMemo(
    () => new Set(attachments.map((a) => `${a.type}:${a.number}`)),
    [attachments]
  );

  const repoSelector = kind === "orchestrator" ? (
    <div className="orbit-repo" ref={repoBoxRef}>
      <button
        type="button"
        onClick={() => setRepoOpen((v) => !v)}
        aria-expanded={repoOpen}
        aria-label="Select repository"
        title={activeRepo || "Select a repository to work on"}
        className={`orbit-repo-btn ${activeRepo ? "is-set" : "is-empty"}`}
      >
        <FolderGit2 className="size-4" />
        <span>{activeRepo || "Select repo"}</span>
        <ChevronDown className="size-3.5 orbit-repo-chev" />
      </button>
      {repoOpen && (
        <div className="orbit-repo-menu" role="listbox">
          {reposLoading ? (
            <div aria-busy="true" className="space-y-1.5 p-2">
              <div className="animate-pulse rounded-md bg-muted/60 h-8 w-full" aria-hidden="true" />
              <div className="animate-pulse rounded-md bg-muted/60 h-8 w-full" aria-hidden="true" />
              <div className="animate-pulse rounded-md bg-muted/60 h-8 w-full" aria-hidden="true" />
            </div>
          ) : null}
          {!reposLoading && reposError ? (
            <div className="repo-empty" role="alert">
              {reposError}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setReposLoading(true);
                  setReposError(null);
                  fetch("/api/repos")
                    .then((r) => {
                      if (!r.ok) throw new Error();
                      return r.json();
                    })
                    .then((data: { repos?: RepoOption[] }) => setRepos(data.repos ?? []))
                    .catch(() => {
                      setRepos([]);
                      setReposError("Couldn't load repositories. Check GitHub connection.");
                    })
                    .finally(() => setReposLoading(false));
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!reposLoading && !reposError && repos.length === 0 && (
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
              role="option"
              aria-selected={r.full_name === activeRepo}
              className={r.full_name === activeRepo ? "active" : ""}
              onClick={() => handleSelectRepo(r.full_name)}
            >
              <span>{r.full_name}</span>
              {r.private && <em>private</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const attachmentChips = attachments.length > 0 ? (
    <div className="orbit-files">
      {attachments.map((a, i) => (
        <span key={`${a.type}-${a.number ?? a.name}-${i}`} className="orbit-file">
          {a.type === "file" ? (
            <Upload className="size-3" />
          ) : a.type === "image" ? (
            a.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.dataUrl} alt={a.name ?? "attached image"} className="orbit-file-thumb" />
            ) : (
              <ImageIcon className="size-3" />
            )
          ) : a.type === "issue" ? (
            <CircleDot className="size-3" />
          ) : (
            <GitPullRequest className="size-3" />
          )}
          <span>
            {a.type === "file" || a.type === "image"
              ? (a.name ?? "image")?.slice(0, 32)
              : `#${a.number} ${(a.title ?? "").slice(0, 40)}${(a.title ?? "").length > 40 ? "…" : ""}`}
          </span>
          <button type="button" onClick={() => removeAttachment(i)} aria-label="Remove attachment">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  ) : null;

  // "+" menu inside the composer: upload file always; issue/PR only when a repo is picked.
  const plusMenu = kind === "orchestrator" ? (
    <div className="orbit-plus" ref={plusBoxRef}>
      <button
        type="button"
        onClick={() => {
          setPlusOpen((v) => !v);
          setPickerTab(null);
        }}
        aria-expanded={plusOpen}
        aria-label="Add attachment"
        title="Add file, issue, or PR"
        className="orbit-plus-btn"
      >
        <Plus className="size-4" />
      </button>
      {plusOpen && (
        <div className="orbit-plus-menu" role="menu">
          {!pickerTab && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()}>
                <span className="plus-item-icon">
                  <Upload className="size-4" />
                </span>
                <span className="plus-item-label">Upload a file</span>
              </button>
              {hasRepo && (
                <>
                  <button type="button" onClick={() => void openPicker("issues")}>
                    <span className="plus-item-icon">
                      <CircleDot className="size-4" />
                    </span>
                    <span className="plus-item-label">Select an issue</span>
                    <ChevronRight className="size-4 plus-item-chev" />
                  </button>
                  <button type="button" onClick={() => void openPicker("prs")}>
                    <span className="plus-item-icon">
                      <GitPullRequest className="size-4" />
                    </span>
                    <span className="plus-item-label">Select a PR</span>
                    <ChevronRight className="size-4 plus-item-chev" />
                  </button>
                </>
              )}
              {!hasRepo && (
                <div className="repo-empty">Select a repo to attach issues or PRs.</div>
              )}
            </>
          )}
          {pickerTab && (
            <div className="composer-picker">
              <div className="composer-picker-head">
                <button
                  type="button"
                  onClick={() => setPickerTab(null)}
                  aria-label="Back to attachments"
                  className="composer-picker-back"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <div className="composer-picker-titles">
                  <p>{pickerTab === "issues" ? "Open issues" : "Open PRs"}</p>
                  <small>{activeRepo}</small>
                </div>
              </div>
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={`Search ${pickerTab}…`}
                aria-label={`Search ${pickerTab}`}
              />
              <div className="composer-picker-list">
                {pickerLoading ? (
                  <div aria-busy="true" className="space-y-1.5 p-2">
                    <div className="animate-pulse rounded-md bg-muted/60 h-10 w-full" aria-hidden="true" />
                    <div className="animate-pulse rounded-md bg-muted/60 h-10 w-full" aria-hidden="true" />
                    <div className="animate-pulse rounded-md bg-muted/60 h-10 w-full" aria-hidden="true" />
                  </div>
                ) : null}
                {!pickerLoading && pickerError ? (
                  <div className="repo-empty" role="alert">
                    {pickerError}{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void openPicker(pickerTab)}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {!pickerLoading && !pickerError && filteredPicker.length === 0 && (
                  <div className="repo-empty">
                    No open {pickerTab} in {activeRepo}.
                  </div>
                )}
                {filteredPicker.map((item) => {
                  const type = pickerTab === "issues" ? "issue" : "pr";
                  const selected = selectedKeys.has(`${type}:${item.number}`);
                  return (
                    <button
                      key={item.number}
                      type="button"
                      className={`picker-row ${selected ? "active" : ""}`}
                      onClick={() => toggleAttachment(item, type)}
                      title={item.title}
                    >
                      <span className="picker-row-icon">
                        {type === "issue" ? (
                          <CircleDot className="size-4" />
                        ) : (
                          <GitPullRequest className="size-4" />
                        )}
                      </span>
                      <span className="picker-row-text">
                        <span className="picker-row-title">{item.title}</span>
                        <span className="picker-row-sub">
                          #{item.number}
                          {item.author ? ` · ${item.author}` : ""} · {item.state}
                        </span>
                      </span>
                      {selected && <Check className="size-4 picker-row-check" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="composer-picker-done"
                onClick={() => {
                  setPlusOpen(false);
                  setPickerTab(null);
                  setPickerQuery("");
                }}
              >
                Done ({attachments.filter((a) => a.type === "issue" || a.type === "pr").length} selected)
              </button>
            </div>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" hidden onChange={handleFilePicked} accept="image/*,.txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.yml,.yaml" />
    </div>
  ) : null;

  const composer = (
    <div className="orbit-composer-zone">
      {attachmentChips}
      <form className="orbit-composer" onSubmit={onSubmit}>
        {plusMenu}
        <textarea
          id="orchestrator-chat-input"
          ref={inputRef}
          rows={1}
          value={input}
          onChange={handleInputChange}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          placeholder={
            needsRepo
              ? "Select a repository to start…"
              : activeRepo
                ? `What should Orbit do in ${activeRepo}?`
                : placeholder
          }
          disabled={isStreaming || needsRepo}
          aria-label={`${title} message`}
          title={needsRepo ? "Select a repository first" : undefined}
        />
        {isStreaming ? (
          <button type="button" onClick={stop} aria-label="Stop streaming" className="orbit-send is-stop">
            <Square className="size-4" />
          </button>
        ) : (
          <button
            id="orchestrator-chat-send"
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || needsRepo}
            aria-label="Send message"
            className="orbit-send"
          >
            <SendHorizontal className="size-4" />
          </button>
        )}
      </form>
      {fileNotice ? <p className="orbit-hint" role="status">{fileNotice}</p> : null}
      <p className="orbit-hint">Enter to send · Shift+Enter for a new line · Orbit acts on your GitHub</p>
    </div>
  );

  if (isLanding) {
    return (
      <section className="orbit-landing" aria-label={title}>
        <div className="orbit-landing-status">
          <span className="orbit-live-dot" />
          {activeRepo ? `Working in ${activeRepo}` : "Orchestrator ready"}
        </div>
        <h2>{greeting}</h2>
        {kind === "orchestrator" && !activeRepo ? (
          <p className="orbit-landing-sub">Pick a repository below, then describe the task.</p>
        ) : null}
        <div className="orbit-landing-box">
          {kind === "orchestrator" && (
            <div className="orbit-landing-repo">{repoSelector}</div>
          )}
          {kind === "orchestrator" && <ApprovalCards />}
          {composer}
        </div>
        <div className="orbit-suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => doSend(s)}
              disabled={needsRepo || isStreaming}
              title={needsRepo ? "Select a repository first" : s}
            >
              <Sparkles className="size-3.5" />
              {s}
            </button>
          ))}
        </div>
        {error ? (
          <div className="orbit-error" role="alert">
            {error}{" "}
            {lastFailed ? (
              <button type="button" className="underline" onClick={() => void retryLast()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="orbit-thread" aria-label={title}>
      <div className="orbit-thread-bar">
        <span className="orbit-thread-repo">
          <Orbit className="size-3.5" />
          {activeRepo || title}
        </span>
        {isStreaming ? (
          <span className="orbit-live-badge">
            <span className="orbit-live-dot" />
            {activeStep ? activeStep.slice(0, 72) : "Working…"}
          </span>
        ) : (
          <span className="orbit-idle-badge">{messages.length} messages</span>
        )}
      </div>

      <div className="orbit-scroll">
        {isLoading ? (
          <div aria-busy="true" className="space-y-3">
            <div className="flex justify-end">
              <div className="animate-pulse rounded-2xl bg-muted/60 h-12 w-2/3" aria-hidden="true" />
            </div>
            <div className="flex gap-2">
              <div className="animate-pulse rounded-full bg-muted/60 size-8 shrink-0" aria-hidden="true" />
              <div className="flex-1 space-y-2">
                <div className="animate-pulse rounded-md bg-muted/60 h-4 w-1/4" aria-hidden="true" />
                <div className="animate-pulse rounded-md bg-muted/60 h-16 w-full" aria-hidden="true" />
              </div>
            </div>
          </div>
        ) : null}
        {messages.map((m, mi) =>
          m.role === "user" ? (
            <div key={m.id} className="orbit-user-row" style={{ contentVisibility: "auto", containIntrinsicSize: "0 120px" }}>
              <div className="orbit-user-bubble">
                <div className="orbit-user-lines">
                  {m.content.split("\n").map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed.endsWith("]") || trimmed.length > 120)
                      return <p key={i}>{line || " "}</p>;
                    if (
                      trimmed.startsWith("[issue #") ||
                      trimmed.startsWith("[pr #") ||
                      trimmed.startsWith("[file ")
                    ) {
                      return (
                        <span key={i} className="orbit-ref-chip">
                          <span className="orbit-ref-dot" />
                          {trimmed.slice(1, -1)}
                        </span>
                      );
                    }
                    return <p key={i}>{line || " "}</p>;
                  })}
                </div>
              </div>
              <span className="orbit-avatar orbit-avatar-user" aria-hidden="true">
                <User className="size-4" />
              </span>
            </div>
          ) : (
            <div key={m.id} className="orbit-ai-row" style={{ contentVisibility: "auto", containIntrinsicSize: "0 120px" }}>
              <span className="orbit-avatar orbit-avatar-ai" aria-hidden="true">
                <Bot className="size-4" />
              </span>
              <div className="orbit-ai-body">
                <p className="orbit-ai-name">
                  Orbit
                  {isStreaming && mi === messages.length - 1 && (
                    <span className="orbit-stream-dot" title="streaming" />
                  )}
                </p>
                {(m.steps && m.steps.length > 0) || (isStreaming && mi === messages.length - 1) ? (
                  <ChatSteps
                    steps={m.steps ?? []}
                    isLive={isStreaming && mi === messages.length - 1}
                    activeStep={isStreaming && mi === messages.length - 1 ? activeStep : null}
                    defaultOpen={isStreaming ? true : mi === lastAssistantIdx}
                  />
                ) : null}
                {m.content ? (
                  <div className="orbit-markdown">{renderMarkdown(m.content, { repo: activeRepo })}</div>
                ) : isStreaming && mi === messages.length - 1 ? (
                  <ChatLiveIndicator
                    activeStep={activeStep || "Orchestrator is reasoning and analyzing repository..."}
                  />
                ) : null}
                {isStreaming && mi === messages.length - 1 && activeStep && m.content ? (
                  <div className="orbit-now">
                    <span className="inline-flex animate-spin"><Loader2 className="size-3.5" /></span>
                    <span>{activeStep}</span>
                  </div>
                ) : null}
              </div>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <div className="orbit-error" role="alert">
          {error}{" "}
          {lastFailed ? (
            <button type="button" className="underline" onClick={() => void retryLast()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="orbit-bottom">
        {kind === "orchestrator" && <ApprovalCards />}
        <div className="orbit-toolbar">
          {repoSelector}
          {isStreaming && activeStep ? (
            <span className="orbit-toolbar-live" title={activeStep}>
              <span className="inline-flex animate-spin"><Loader2 className="size-3" /></span>
              {activeStep.slice(0, 60)}
            </span>
          ) : null}
        </div>
        {composer}
      </div>
    </section>
  );
}
