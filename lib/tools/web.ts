import { orbitEnv } from "../env";
import { registerTool } from "./registry";

const EXA_BASE = "https://api.exa.ai";
const FETCH_TIMEOUT_MS = 15000;

interface ExaSearchResult {
  title?: string;
  url?: string;
  highlights?: string[];
  text?: string;
}

interface ExaContentsResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
}

async function exaPost<T>(path: string, key: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${EXA_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Exa ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function excerpt(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Web tools (Exa): independent outside search for the orchestrator.
 * Read-only → auto permission. Degrades gracefully when EXA_API_KEY
 * is missing — the run continues, the model just can't search the web.
 */
export function registerWebTools(): void {
  registerTool({
    name: "web_search",
    description:
      "Search the public web (docs, error messages, CVEs, library APIs, changelogs). Use when the task involves unfamiliar libraries, cryptic errors, or anything outside the repo. Returns titles, URLs, and relevance excerpts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        num_results: { type: "string", description: "How many results (default 5, max 10)" },
      },
      required: ["query"],
    },
    permission: "auto",
    handler: async (input) => {
      const key = orbitEnv.exaApiKey;
      if (!key) {
        return {
          ok: true,
          output:
            "Web search is not configured (EXA_API_KEY missing) — proceed with repo context only and note the limitation in your summary.",
        };
      }
      const query = (input.query ?? "").trim();
      if (!query) return { ok: false, output: "Empty query." };
      const numResults = Math.min(10, Math.max(1, Number(input.num_results ?? 5) || 5));
      try {
        const data = await exaPost<{ results?: ExaSearchResult[] }>(
          "/search",
          key,
          { query, type: "auto", numResults, contents: { highlights: true } }
        );
        const results = data.results ?? [];
        if (results.length === 0) return { ok: true, output: "(no web results)" };
        const out = results
          .map((r, i) => {
            const hl = (r.highlights ?? []).slice(0, 2).join(" … ").slice(0, 600);
            return `${i + 1}. ${r.title || "(untitled)"}\n   ${r.url || ""}${hl ? `\n   ${hl}` : ""}`;
          })
          .join("\n\n");
        return { ok: true, output: excerpt(out, 6000) };
      } catch (err) {
        return { ok: false, output: `Web search failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "fetch_url",
    description:
      "Read a web page (docs, release notes, StackOverflow answer) into context. Use after web_search finds a promising URL, or when the user pastes a link. Returns page text (or focused excerpts when a focus query is given).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL to read" },
        focus: { type: "string", description: "Optional: what to focus excerpt extraction on" },
      },
      required: ["url"],
    },
    permission: "auto",
    handler: async (input) => {
      const key = orbitEnv.exaApiKey;
      if (!key) {
        return {
          ok: true,
          output: "Page fetch is not configured (EXA_API_KEY missing) — proceed without it.",
        };
      }
      const url = (input.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return { ok: false, output: `Bad URL: ${url}` };
      const focus = (input.focus ?? "").trim();
      try {
        const data = await exaPost<{ results?: ExaContentsResult[] }>(
          "/contents",
          key,
          focus
            ? { ids: [url], highlights: { query: focus } }
            : { ids: [url], text: { maxCharacters: 8000 } }
        );
        const page = (data.results ?? [])[0];
        if (!page) return { ok: false, output: `No content extracted from ${url}` };
        const body =
          (focus ? (page.highlights ?? []).join("\n…\n") : page.text ?? "") || "(empty page)";
        return {
          ok: true,
          output: excerpt(`# ${page.title || url}\n${body}`, 8000),
        };
      } catch (err) {
        return { ok: false, output: `Page fetch failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });
}
