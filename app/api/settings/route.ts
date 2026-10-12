import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

/** Get or update the two automation toggles (both default OFF). */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabase.from("user_settings").select("*").eq("user_id", user.id).single();
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
  const { data, error } = await supabase
    .from("user_settings")
    .upsert(
      [
        {
          user_id: user.id,
          orchestrator_auto_approve: Boolean(body.orchestrator_auto_approve),
          evaluator_auto_apply: Boolean(body.evaluator_auto_apply),
        },
      ],
      { onConflict: "user_id" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
