import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { destroySandbox } from "@/lib/sandbox/tensorlake";

export const maxDuration = 120;

/**
 * Reaper cron: heals stuck states left by crashed runs, lost fire-and-forget
 * promises, and leaked sandboxes. Trigger like the github poller:
 *   GET or POST /api/cron/reaper  (x-cron-secret header or ?secret=)
 *
 * 1. sub_agents stuck `running` for >40min → `failed` (timeout) + destroy sandbox.
 * 2. sub_agents stuck `awaiting_approval` for >24h with no pending approval → `failed` (expired).
 */
export async function GET(request: Request) {
  return handleReap(request);
}

export async function POST(request: Request) {
  return handleReap(request);
}

async function handleReap(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const provided =
    request.headers.get("x-cron-secret") ??
    new URL(request.url).searchParams.get("secret");
  let isAuthorized = false;
  if (cronSecret && provided === cronSecret) isAuthorized = true;
  if (!isAuthorized && process.env.NODE_ENV !== "production") isAuthorized = true;
  if (!isAuthorized) {
    try {
      const { createOrbitServerClient } = await import("@/lib/supabase-server");
      const authSupabase = await createOrbitServerClient();
      const {
        data: { user },
      } = await authSupabase.auth.getUser();
      if (user) isAuthorized = true;
    } catch {
      // not logged in
    }
  }
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }

  const reaped: Array<{ id: string; action: string }> = [];
  const errors: string[] = [];

  // 1) Stuck running agents (>40min without update).
  try {
    const cutoff = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const { data: stuck, error } = await supabase
      .from("sub_agents")
      .select("id,user_id,title,sandbox_id,event_id,trace_id")
      .eq("status", "running")
      .lt("updated_at", cutoff)
      .limit(50);
    if (error) throw new Error(error.message);
    for (const agent of (stuck ?? []) as Array<{
      id: string;
      user_id: string;
      title: string;
      sandbox_id?: string | null;
      event_id?: string | null;
      trace_id?: string | null;
    }>) {
      try {
        if (agent.sandbox_id) {
          await destroySandbox({ id: agent.sandbox_id, mock: false });
        }
        await supabase.from("sub_agents").update({ status: "failed" }).eq("id", agent.id);
        if (agent.event_id) {
          await supabase.from("github_events").update({ status: "ignored" }).eq("id", agent.event_id);
        }
        try {
          const { traceSpan } = await import("@/lib/traces");
          await traceSpan(agent.trace_id ?? agent.id, {
            name: "reaped",
            detail: "stuck running >40min — marked failed by reaper",
          });
        } catch {
          // tracing is best-effort
        }
        await supabase.from("activities").insert([
          {
            user_id: agent.user_id,
            title: `Agent timed out: ${agent.title}`,
            description: "It was stuck for over 40 minutes with no progress. Re-approve or ask the orchestrator to retry.",
            type: "event",
          },
        ]);
        reaped.push({ id: agent.id, action: "running→failed" });
      } catch (err) {
        errors.push(`${agent.id}: ${(err as Error).message.slice(0, 150)}`);
      }
    }
  } catch (err) {
    errors.push(`running sweep: ${(err as Error).message.slice(0, 150)}`);
  }

  // 2) Stale awaiting_approval agents (>24h, approval gone) → failed (expired).
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stale, error } = await supabase
      .from("sub_agents")
      .select("id,user_id,title")
      .eq("status", "awaiting_approval")
      .lt("created_at", cutoff)
      .limit(50);
    if (error) throw new Error(error.message);
    for (const agent of (stale ?? []) as Array<{ id: string; user_id: string; title: string }>) {
      try {
        const { data: pending } = await supabase
          .from("approvals")
          .select("id")
          .eq("kind", "run_agent")
          .eq("ref_id", agent.id)
          .eq("status", "pending")
          .limit(1);
        if (pending && (pending as unknown[]).length > 0) continue;
        await supabase.from("sub_agents").update({ status: "failed" }).eq("id", agent.id);
        await supabase.from("activities").insert([
          {
            user_id: agent.user_id,
            title: `Agent expired: ${agent.title}`,
            description: "It waited for approval for over 24 hours with no pending approval. Ask the orchestrator to propose it again.",
            type: "event",
          },
        ]);
        reaped.push({ id: agent.id, action: "awaiting_approval→failed" });
      } catch (err) {
        errors.push(`${agent.id}: ${(err as Error).message.slice(0, 150)}`);
      }
    }
  } catch (err) {
    errors.push(`stale sweep: ${(err as Error).message.slice(0, 150)}`);
  }

  return NextResponse.json({ ok: true, reaped, errors });
}
