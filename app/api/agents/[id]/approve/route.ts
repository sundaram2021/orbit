import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { handleApprove, executeApproval } from "@/app/api/approvals/route";

/** POST /api/agents/:id/approve — approve the pending run_agent approval and start. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (err) {
    return NextResponse.json({ error: `Server misconfigured: ${(err as Error).message}` }, { status: 503 });
  }
  const { data: approval, error } = await svc
    .from("approvals")
    .select("*")
    .eq("user_id", user.id)
    .eq("kind", "run_agent")
    .eq("ref_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !approval) {
    return NextResponse.json({ error: "no pending run approval for this agent" }, { status: 404 });
  }
  // Same execution state machine as the approvals route: mark executing,
  // run in the background, land in approved/failed with a retry path.
  const executing = await svc
    .from("approvals")
    .update({ status: "executing", decided_at: new Date().toISOString() })
    .eq("id", (approval as { id: string }).id)
    .eq("status", "pending");
  if (executing.error) {
    if (/check|constraint|invalid input/i.test(executing.error.message)) {
      await svc
        .from("approvals")
        .update({ status: "approved", decided_at: new Date().toISOString() })
        .eq("id", (approval as { id: string }).id);
      void handleApprove(svc, user.id, approval as never).catch((err) =>
        console.error("approve execution failed:", err)
      );
      return NextResponse.json({ ok: true, legacy: true });
    }
    return NextResponse.json({ error: "Couldn't start execution. Retry.", retryable: true }, { status: 503 });
  }
  void executeApproval(svc, user.id, approval as never, true).catch((err) =>
    console.error("approve execution failed:", err)
  );
  return NextResponse.json({ ok: true, executing: true });
}
