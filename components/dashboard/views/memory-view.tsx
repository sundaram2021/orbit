"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2, Network, ScrollText } from "lucide-react";
import type { GraphApiDocument } from "@supermemory/memory-graph";

// Canvas-based; render client-side only.
const MemoryGraph = dynamic(
  () => import("@supermemory/memory-graph").then((m) => m.MemoryGraph),
  {
    ssr: false,
    loading: () => (
      <div className="chat-loading" style={{ padding: 24 }}>
        <Loader2 className="size-4 animate-spin" /> Loading graph…
      </div>
    ),
  }
);

class GraphErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(err: Error) {
    return { failed: true, message: err.message };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="panel-empty">
          Memory graph failed to render: {this.state.message.slice(0, 200)}
        </div>
      );
    }
    return this.props.children;
  }
}

export function MemoryView() {
  const [documents, setDocuments] = useState<GraphApiDocument[]>([]);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<Error | null>(null);

  useEffect(() => {
    fetch("/api/memory/graph")
      .then((r) => r.json())
      .then((data: { documents?: GraphApiDocument[] }) => {
        setDocuments(data.documents ?? []);
        setGraphLoading(false);
      })
      .catch((err: Error) => {
        setGraphError(err);
        setGraphLoading(false);
      });
  }, []);

  return (
    <div>
      <div className="dash-title">
        <div>
          <h1>Memory</h1>
          <p>Global shared memory, synced across the orchestrator and every sub-agent. Powered by Supermemory.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2><Network className="size-3.5" /> Memory graph</h2>
          <span className="mono">{documents.length} DOCUMENTS</span>
        </div>
        <GraphErrorBoundary>
          <div style={{ height: 560, minHeight: 560, position: "relative" }}>
            <MemoryGraph
              documents={documents}
              isLoading={graphLoading}
              error={graphError}
              variant="consumer"
              maxNodes={600}
            >
              <div className="panel-empty">
                No memories in the graph yet. Run an agent — everything it learns lands here.
              </div>
            </MemoryGraph>
          </div>
        </GraphErrorBoundary>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2><ScrollText className="size-3.5" /> Memory log</h2>
          <span className="mono">WHAT GOT ADDED</span>
        </div>
        <div className="item-list">
          {graphLoading && (
            <div className="chat-loading">
              <Loader2 className="size-4 animate-spin" /> Loading memory log…
            </div>
          )}
          {!graphLoading && documents.length === 0 && (
            <div className="panel-empty">Nothing memorized yet.</div>
          )}
          {documents.map((d) => (
            <div key={d.id} className="item">
              <div className="item-body">
                <div className="item-title">{d.title || "Untitled memory"}</div>
                {(d.summary) && <div className="item-desc">{d.summary.slice(0, 300)}</div>}
                <div className="item-meta">
                  {d.createdAt ? new Date(d.createdAt).toLocaleString() : ""}
                  {d.memories?.length ? ` · ${d.memories.length} ${d.memories.length === 1 ? "memory" : "memories"}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>How it works</h2>
        </div>
        <div className="memory-result">
          <p>Every agent writes back what it learns — decisions, file maps, failures, scores.</p>
          <p>Every evaluation writes its lessons-learned, so future agents avoid the same mistakes.</p>
          <p>Every new agent reads a digest of relevant past work before it starts.</p>
          <p>Nothing is manual. Memory grows with every run and every evaluation.</p>
        </div>
      </section>
    </div>
  );
}
