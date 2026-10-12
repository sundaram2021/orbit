"use client";

import React from "react";

/**
 * Minimal safe markdown renderer for agent chat (zero dependencies).
 * Supports: ## headings, **bold**, `code`, ``` fenced blocks,
 * - / 1. lists, [text](https://url) links. No raw HTML is ever emitted.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key} className="md-code">{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="md-link">
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split out fenced code blocks first.
  const chunks = text.split(/(```[\s\S]*?```)/g);
  let key = 0;
  for (const chunk of chunks) {
    if (chunk.startsWith("```")) {
      const body = chunk.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
      out.push (
        <pre key={key++} className="md-pre"><code>{body}</code></pre>
      );
      continue;
    }
    const lines = chunk.split("\n");
    let listItems: string[] = [];
    let ordered = false;
    const flushList = () => {
      if (listItems.length === 0) return;
      const items = listItems;
      const isOrdered = ordered;
      listItems = [];
      out.push(
        isOrdered ? (
          <ol key={key++} className="md-list">{items.map((li, i) => <li key={i}>{renderInline(li, `ol-${key}-${i}`)}</li>)}</ol>
        ) : (
          <ul key={key++} className="md-list">{items.map((li, i) => <li key={i}>{renderInline(li, `ul-${key}-${i}`)}</li>)}</ul>
        )
      );
    };
    for (const line of lines) {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (heading) {
        flushList();
        out.push(<p key={key++} className="md-heading">{renderInline(heading[2], `h-${key}`)}</p>);
      } else if (bullet) {
        if (ordered && listItems.length > 0) flushList();
        ordered = false;
        listItems.push(bullet[1]);
      } else if (numbered) {
        if (!ordered && listItems.length > 0) flushList();
        ordered = true;
        listItems.push(numbered[1]);
      } else if (line.trim() === "") {
        flushList();
      } else {
        flushList();
        out.push(<p key={key++}>{renderInline(line, `p-${key}`)}</p>);
      }
    }
    flushList();
  }
  return out;
}
