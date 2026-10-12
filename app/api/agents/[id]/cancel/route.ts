import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { ensureAllTools } from "@/lib/tools/setup";
import { runTool, type ToolContext } from "@/lib/tools/registry";

/** POST /api/agents/:id/cancel — stop a running/waiting agent, destroy sandbox. */
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
  ensureAllTools();
  const svc = createServiceClient();
  const ctx: ToolContext = { userId: user.id, supabase: svc, traceId: id, agentId: id };
  const result = await runTool("cancel_agent", { agent_id: id }, ctx);
  if (!result.ok) return NextResponse.json({ error: result.output }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.output });
}
