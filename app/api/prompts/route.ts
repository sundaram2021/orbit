import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

/**
 * Customized prompts — the full detailed prompt the orchestrator wrote for
 * each sub-agent, listed with its task title. Replaces the old skill library:
 * the customized prompt IS the customization now.
 */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: agents } = await supabase
    .from("sub_agents")
    .select("id, title, kind, status, system_prompt, eval_score, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({
    prompts: ((agents ?? []) as {
      id: string;
      title: string;
      kind: string;
      status: string;
      system_prompt: string;
      eval_score: number | null;
      created_at: string;
    }[]).map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      status: a.status,
      system_prompt: a.system_prompt,
      eval_score: a.eval_score,
      created_at: a.created_at,
    })),
  });
}
