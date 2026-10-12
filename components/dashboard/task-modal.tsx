"use client";

import React, { useState } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";
import { OrbitRepo } from "@/types/orbit-types";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: OrbitRepo[];
  onCreateTask: (data: {
    title: string;
    description: string;
    repo_name: string;
    assigned_agent: string;
  }) => Promise<unknown>;
}

export function TaskModal({
  isOpen,
  onClose,
  repositories,
  onCreateTask,
}: TaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoName, setRepoName] = useState(
    repositories[0]?.full_name || "orbit/platform"
  );
  const [agent, setAgent] = useState("implementation-012");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await onCreateTask({
        title: title.trim(),
        description: description.trim(),
        repo_name: repoName,
        assigned_agent: agent,
      });
      setTitle("");
      setDescription("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <h2>Dispatch autonomous agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <p>
          Configure a new task for your Orbit agents. The orchestrator will
          create an execution plan and dispatch the designated agent.
        </p>

        <form onSubmit={handleSubmit}>
          <label>Target repository</label>
          <select
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.full_name}>
                {r.full_name} ({r.branch})
              </option>
            ))}
          </select>

          <label>Task title / Issue headline</label>
          <input
            placeholder="e.g. Implement Webhook retry mechanism"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <label>Designated agent</label>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="implementation-012">Implementation agent (implementation-012)</option>
            <option value="review-008">Code review agent (review-008)</option>
            <option value="testing-006">Testing agent (testing-006)</option>
            <option value="orchestrator-core">Orchestrator Core (auto-delegate)</option>
          </select>

          <label>Task instructions &amp; constraints</label>
          <textarea
            placeholder="Provide context, acceptance criteria, or linked issue number..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="modal-actions">
            <button
              id="cancel-modal-btn"
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium cursor-pointer border border-input bg-background hover:bg-accent px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {submitting ? "Dispatching..." : "Dispatch Agent"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
