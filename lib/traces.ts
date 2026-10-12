/**
 * Tracing removed — the external trace backend proved unreliable.
 * These functions are intentional no-ops so all existing call sites
 * keep working. Execution history lives in sub_agents.run_log.
 */

export interface TraceSpan {
  name: string;
  detail?: string;
  at?: string;
}

export function newTraceId(): string {
  return `orbit-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export async function traceStart(_opts: {
  traceId: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  void _opts;
}

export async function traceSpan(
  _traceId: string,
  _span: TraceSpan
): Promise<void> {
  void _traceId;
  void _span;
}

export function traceUrl(traceId: string): string {
  return `#${encodeURIComponent(traceId)}`;
}
