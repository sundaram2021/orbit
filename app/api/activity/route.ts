import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

/** Full activity feed (powers the Activity view + notifications). */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Math.min(
    Number(new URL(request.url).searchParams.get("limit") ?? 100) || 100,
    200
  );
  const { data } = await supabase
    .from("activities")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return NextResponse.json({ activities: data ?? [] });
}
