import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";

/** Live lists for the dashboard: sub-agents, events, evaluations. */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const which = new URL(request.url).searchParams.get("which") ?? "agents";

  if (which === "events") {
    const { data } = await supabase
      .from("github_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    return NextResponse.json({ events: data ?? [] });
  }

  if (which === "evaluations") {
    const { data: agents } = await supabase.from("sub_agents").select("id");
    const ids = ((agents ?? []) as { id: string }[]).map((a) => a.id);
    if (ids.length === 0) return NextResponse.json({ evaluations: [] });
    const { data } = await supabase
      .from("evaluations")
      .select("*")
      .in("sub_agent_id", ids)
      .order("created_at", { ascending: false })
      .limit(30);
    return NextResponse.json({ evaluations: data ?? [] });
  }

  const { data } = await supabase
    .from("sub_agents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ agents: data ?? [] });
}

/** Manually propose a sub-agent (dashboard "New task" → orchestrator pipeline). */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    repo?: string;
    title?: string;
    description?: string;
  };
  if (!body.title?.trim() || !body.repo?.trim()) {
    return NextResponse.json({ error: "title and repo are required" }, { status: 400 });
  }

  const svc = createServiceClient();
  try {
    const result = await proposeAndMaybeRun(svc, {
      userId: user.id,
      source: "manual",
      repo: body.repo.trim(),
      title: body.title.trim(),
      body: body.description?.trim() || null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
