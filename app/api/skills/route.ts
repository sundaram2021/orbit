import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

/** Skill library — every skill the orchestrator created or used. */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: skills } = await supabase
    .from("skill_library")
    .select("name, definition, updated_at")
    .order("updated_at", { ascending: false });

  // Usage count per skill across sub-agents.
  const { data: agents } = await supabase.from("sub_agents").select("skills");
  const usage = new Map<string, number>();
  for (const a of ((agents ?? []) as { skills: string[] }[])) {
    for (const s of a.skills ?? []) usage.set(s, (usage.get(s) ?? 0) + 1);
  }

  return NextResponse.json({
    skills: ((skills ?? []) as { name: string; definition: string; updated_at: string }[]).map(
      (s) => ({ ...s, used_by_agents: usage.get(s.name) ?? 0 })
    ),
  });
}
