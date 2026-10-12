import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { memoryRecall } from "@/lib/memory";

/** Search global shared memory (powers the Memory view). */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { q } = (await request.json()) as { q?: string };
  if (!q?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });

  const result = await memoryRecall(user.id, q.trim(), 10);
  return NextResponse.json({ result });
}
