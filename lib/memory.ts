import { orbitEnv } from "./env";
import { fetchWithTimeout } from "./fetch-utils";

const BASE = "https://api.supermemory.ai";

/**
 * Global shared memory (Supermemory) for orchestrator + sub-agents + evaluator.
 * Namespaced per user: `orbit-<userId>`. All failures degrade gracefully —
 * memory must never break an agent run. Every call is bounded by a timeout
 * so a hung memory backend can't stall chat streams or agent runs.
 */
export function namespaceFor(userId: string): string {
  return `orbit-${userId}`.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

export async function memoryRemember(
  userId: string,
  content: string,
  metadata?: Record<string, string>
): Promise<void> {
  try {
    if (!orbitEnv.supermemoryApiKey) return;
    const res = await fetchWithTimeout(
      `${BASE}/v3/documents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${orbitEnv.supermemoryApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          containerTag: namespaceFor(userId),
          metadata: { app: "orbit", ...metadata },
          // "instant" extracts memories right away instead of waiting to batch
          // with other documents — agents read back what they wrote within minutes.
          dreaming: "instant",
        }),
      },
      8000
    );
    if (!res.ok) {
      console.warn(`Supermemory remember failed (${res.status})`);
    }
  } catch (err) {
    console.warn("Supermemory remember failed:", err);
  }
}

export async function memoryRecall(
  userId: string,
  query: string,
  limit = 5
): Promise<string> {
  try {
    if (!orbitEnv.supermemoryApiKey) return "";
    const res = await fetchWithTimeout(
      `${BASE}/v4/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${orbitEnv.supermemoryApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          containerTag: namespaceFor(userId),
          limit,
        }),
      },
      8000
    );
    if (!res.ok) return "";
    const data = (await res.json()) as {
      results?: Array<{ memory?: string; content?: string; chunk?: string }>;
    };
    const items = (data.results ?? [])
      .map((r) => r.memory ?? r.content ?? r.chunk ?? "")
      .filter(Boolean);
    return items.join("\n---\n");
  } catch (err) {
    console.warn("Supermemory recall failed:", err);
    return "";
  }
}
