import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

/** Get or update automation toggles (orchestrator auto-approve; evaluator needs no permission). */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    settings: (data as object | null) ?? {
      user_id: user.id,
      orchestrator_auto_approve: false,
      evaluator_auto_apply: false,
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    orchestrator_auto_approve?: boolean;
    evaluator_auto_apply?: boolean;
  };

  // Explicit update-then-insert: surfaces RLS/schema failures instead of
  // silently "succeeding" while nothing persists.
  const { data: existing } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const prev = (existing ?? {}) as { evaluator_auto_apply?: boolean };

  const row = {
    user_id: user.id,
    orchestrator_auto_approve: Boolean(body.orchestrator_auto_approve),
    // Legacy column: no UI writes it anymore (the evaluator needs no
    // permission), but preserve the stored value instead of clobbering it.
    evaluator_auto_apply:
      typeof body.evaluator_auto_apply === "boolean"
        ? body.evaluator_auto_apply
        : Boolean(prev.evaluator_auto_apply),
  };

  const write = existing
    ? await supabase.from("user_settings").update(row).eq("user_id", user.id).select().single()
    : await supabase.from("user_settings").insert([row]).select().single();

  if (write.error || !write.data) {
    return NextResponse.json(
      { error: write.error?.message ?? "settings write failed" },
      { status: 500 }
    );
  }

  // Read-back verification: prove the values actually persisted.
  const { data: verify, error: verifyError } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (verifyError || !verify) {
    return NextResponse.json(
      { error: "settings write not visible — check Row Level Security policies" },
      { status: 500 }
    );
  }
  return NextResponse.json({ settings: verify });
}
