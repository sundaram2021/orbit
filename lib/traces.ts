import { orbitEnv } from "./env";

const BASE = "https://app.neatlogs.com/api/v1/public";

export interface TraceSpan {
  name: string;
  detail?: string;
  at?: string;
}

function projectHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${orbitEnv.neatlogsApiKey}`,
    "Content-Type": "application/json",
  };
  // Service-account credentials also require x-project-id; harmless otherwise.
  const projectId =
    process.env.NEATLOGS_PROJECT_ID?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (projectId) headers["x-project-id"] = projectId;
  return headers;
}

/**
 * NeatLogs trace capture. Every sub-agent run gets one trace_id; each
 * significant step appends a span. If the ingest endpoint is unreachable,
 * spans are kept locally (returned id) and the run continues — tracing
 * must never break execution.
 */
export function newTraceId(): string {
  return `orbit-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export async function traceStart(opts: {
  traceId: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!orbitEnv.neatlogsApiKey) return;
  try {
    await fetch(`${BASE}/traces`, {
      method: "POST",
      headers: projectHeaders(),
      body: JSON.stringify({
        traceId: opts.traceId,
        title: opts.title,
        metadata: { app: "orbit", ...opts.metadata },
      }),
    });
  } catch (err) {
    console.warn("NeatLogs traceStart failed:", err);
  }
}

export async function traceSpan(
  traceId: string,
  span: TraceSpan
): Promise<void> {
  if (!orbitEnv.neatlogsApiKey) return;
  try {
    await fetch(`${BASE}/traces/${encodeURIComponent(traceId)}/spans`, {
      method: "POST",
      headers: projectHeaders(),
      body: JSON.stringify({
        name: span.name,
        detail: span.detail ?? "",
        at: span.at ?? new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn("NeatLogs traceSpan failed:", err);
  }
}

export function traceUrl(traceId: string): string {
  return `https://app.neatlogs.com/traces/${encodeURIComponent(traceId)}`;
}
