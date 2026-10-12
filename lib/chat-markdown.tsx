"use client";

import React from "react";

export interface MarkdownOptions {
  /** owner/name used to resolve #123 shorthand into GitHub links. */
  repo?: string;
}

/**
 * Safe markdown renderer for agent chat (zero dependencies, no raw HTML).
 * Block: headings, fenced code, tables, quotes, hr, task lists, lists, paragraphs.
 * Inline: `code`, **bold**, *italic*, ~~strike~~, [text](url), bare URLs,
 * owner/repo#123 and #123 (resolved via opts.repo) GitHub references.
 */

const INLINE_RE =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]]+\]\((?:https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+)/g;

function shortUrl(url: string): string {
  const clean = url.replace(/^(https?:\/\/)?(www\.)?/, "");
  return clean.length > 56 ? `${clean.slice(0, 56)}…` : clean;
}

function issueHref(ref: string, repo?: string): string | null {
  const full = ref.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/);
  if (full) return `https://github.com/${full[1]}/issues/${full[2]}`;
  const short = ref.match(/^#(\d+)$/);
  // github.com/.../issues/N redirects to /pull/N when N is a PR, so one href covers both.
  if (short && repo && repo.includes("/")) return `https://github.com/${repo}/issues/${short[1]}`;
  return null;
}

function renderInline(text: string, keyPrefix: string, opts: MarkdownOptions): React.ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return <React.Fragment key={key} />;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{renderInline(part.slice(2, -2), `${key}-b`, opts)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return (
        <span key={key} className="md-strike">
          {renderInline(part.slice(2, -2), `${key}-s`, opts)}
        </span>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2 && !part.startsWith("**")) {
      return (
        <em key={key} className="md-italic">
          {renderInline(part.slice(1, -1), `${key}-i`, opts)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="md-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    const mdLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (mdLink) {
      return (
        <a key={key} href={mdLink[2]} target="_blank" rel="noreferrer" className="md-link">
          {renderInline(mdLink[1], `${key}-t`, opts)}
        </a>
      );
    }
    if (/^https?:\/\/[^\s<>()]+$/.test(part) || /^www\.[^\s<>()]+$/.test(part)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="md-link" title={part}>
          {shortUrl(part)}
        </a>
      );
    }
    const gh = issueHref(part, opts.repo);
    if (gh) {
      return (
        <a key={key} href={gh} target="_blank" rel="noreferrer" className="md-link md-ref" title={gh}>
          {part}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

export function renderMarkdown(text: string, opts?: MarkdownOptions): React.ReactNode[] {
  const options = opts ?? {};
  const out: React.ReactNode[] = [];
  // Split out fenced code blocks first (never linkify inside them).
  const chunks = text.split(/(```[\s\S]*?```)/g);
  let key = 0;
  for (const chunk of chunks) {
    if (chunk.startsWith("```")) {
      const langMatch = chunk.match(/^```([a-zA-Z0-9+-]*)\n?/);
      const lang = langMatch?.[1] ?? "";
      const body = chunk.replace(/^```[a-zA-Z0-9+-]*\n?/, "").replace(/```$/, "");
      out.push(
        <div key={key++} className="md-codeblock">
          {lang && <span className="md-codeblock-lang">{lang}</span>}
          <pre className="md-pre">
            <code>{body.replace(/\n$/, "")}</code>
          </pre>
        </div>
      );
      continue;
    }
    const lines = chunk.split("\n");
    let para: string[] = [];
    let listItems: { text: string; task?: boolean; done?: boolean }[] = [];
    let ordered = false;
    let quote: string[] = [];

    const flushPara = () => {
      if (para.length === 0) return;
      const bits = para;
      para = [];
      out.push(
        <p key={key++}>
          {bits.map((ln, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {renderInline(ln, `p-${key}-${li}`, options)}
            </React.Fragment>
          ))}
        </p>
      );
    };
    const flushList = () => {
      if (listItems.length === 0) return;
      const items = listItems;
      const isOrdered = ordered;
      listItems = [];
      out.push(
        isOrdered ? (
          <ol key={key++} className="md-list">
            {items.map((li, i) => (
              <li key={i}>{renderInline(li.text, `ol-${key}-${i}`, options)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className="md-list">
            {items.map((li, i) => (
              <li key={i} className={li.task ? "md-task" : undefined}>
                {li.task && (
                  <span className={`md-checkbox ${li.done ? "is-done" : ""}`} aria-hidden="true">
                    {li.done ? "✓" : ""}
                  </span>
                )}
                {renderInline(li.text, `ul-${key}-${i}`, options)}
              </li>
            ))}
          </ul>
        )
      );
    };
    const flushQuote = () => {
      if (quote.length === 0) return;
      const linesQ = quote;
      quote = [];
      out.push(
        <blockquote key={key++} className="md-quote">
          {linesQ.map((ln, i) => (
            <p key={i}>{renderInline(ln, `q-${key}-${i}`, options)}</p>
          ))}
        </blockquote>
      );
    };

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const trimmed = line.trim();

      // GFM table: header row + separator row + body rows.
      if (
        trimmed.includes("|") &&
        li + 1 < lines.length &&
        isTableSeparator(lines[li + 1])
      ) {
        flushPara();
        flushList();
        flushQuote();
        const head = splitRow(line);
        li += 2; // skip separator
        const bodyRows: string[][] = [];
        while (li < lines.length && lines[li].includes("|") && lines[li].trim() !== "") {
          bodyRows.push(splitRow(lines[li]));
          li++;
        }
        li--; // step back for the for-loop increment
        out.push(
          <div key={key++} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {head.map((h, i) => (
                    <th key={i}>{renderInline(h, `th-${key}-${i}`, options)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, r) => (
                  <tr key={r}>
                    {head.map((_, c) => (
                      <td key={c}>{renderInline(row[c] ?? "", `td-${key}-${r}-${c}`, options)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      const hr = /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed);
      const quoteLine = line.match(/^\s*>\s?(.*)$/);
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);

      if (heading) {
        flushPara();
        flushList();
        flushQuote();
        const level = heading[1].length;
        out.push(
          <p key={key++} className={`md-heading md-h${level}`}>
            {renderInline(heading[2], `h-${key}`, options)}
          </p>
        );
      } else if (hr) {
        flushPara();
        flushList();
        flushQuote();
        out.push(<hr key={key++} className="md-hr" />);
      } else if (quoteLine) {
        flushPara();
        flushList();
        quote.push(quoteLine[1]);
      } else if (task) {
        flushPara();
        flushQuote();
        if (ordered && listItems.length > 0) flushList();
        ordered = false;
        listItems.push({ text: task[2], task: true, done: task[1].toLowerCase() === "x" });
      } else if (bullet) {
        flushPara();
        flushQuote();
        if (ordered && listItems.length > 0) flushList();
        ordered = false;
        listItems.push({ text: bullet[1] });
      } else if (numbered) {
        flushPara();
        flushQuote();
        if (!ordered && listItems.length > 0) flushList();
        ordered = true;
        listItems.push({ text: numbered[1] });
      } else if (trimmed === "") {
        flushPara();
        flushList();
        flushQuote();
      } else {
        flushList();
        flushQuote();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    flushQuote();
  }
  return out;
}
