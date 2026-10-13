import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";
import { parseRepo } from "@/lib/octokit";

/** Live lists for the dashboard: sub-agents, events, evaluations. */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const which = new URL(request.url).searchParams.get("which") ?? "agents";

  if (which === "events") {
    const { data, error } = await supabase
      .from("github_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      return NextResponse.json(
        { events: [], error: "Couldn't load events. Retry.", retryable: true },
        { status: 503 }
      );
    }
    return NextResponse.json({ events: data ?? [] });
  }

  if (which === "evaluations") {
    const { data: agents, error: agentsError } = await supabase.from("sub_agents").select("id");
    if (agentsError) {
      return NextResponse.json(
        { evaluations: [], error: "Couldn't load evaluations. Retry.", retryable: true },
        { status: 503 }
      );
    }
    const ids = ((agents ?? []) as { id: string }[]).map((a) => a.id);
    if (ids.length === 0) return NextResponse.json({ evaluations: [] });
    const { data, error } = await supabase
      .from("evaluations")
      .select("*")
      .in("sub_agent_id", ids)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      return NextResponse.json(
        { evaluations: [], error: "Couldn't load evaluations. Retry.", retryable: true },
        { status: 503 }
      );
    }
    return NextResponse.json({ evaluations: data ?? [] });
  }

  const { data, error } = await supabase
    .from("sub_agents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { agents: [], error: "Couldn't load agents. Retry.", retryable: true },
      { status: 503 }
    );
  }
  return NextResponse.json({ agents: data ?? [] });
}

/** Manually propose a sub-agent (legacy direct API; new UI uses orchestrator chat). */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    repo?: string;
    title?: string;
    description?: string;
    issueNumber?: number | null;
    prNumber?: number | null;
    userInstruction?: string | null;
  } | null;
  if (!body?.title?.trim() || !body?.repo?.trim()) {
    return NextResponse.json({ error: "title and repo are required" }, { status: 400 });
  }
  if (!parseRepo(body.repo.trim())) {
    return NextResponse.json({ error: "repo must be owner/name" }, { status: 400 });
  }

  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: `Server misconfigured: ${(err as Error).message}`, retryable: false },
      { status: 503 }
    );
  }
  try {
    const result = await proposeAndMaybeRun(svc, {
      userId: user.id,
      source: "manual",
      repo: body.repo.trim(),
      title: body.title.trim(),
      body: body.description?.trim() || null,
      issueNumber: body.issueNumber ?? null,
      prNumber: body.prNumber ?? null,
      userInstruction: body.userInstruction ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
