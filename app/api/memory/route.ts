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

  const body = (await request.json().catch(() => null)) as { q?: string } | null;
  const q = body?.q?.trim();
  if (!q) return NextResponse.json({ error: "query required" }, { status: 400 });

  const result = await memoryRecall(user.id, q, 10);
  return NextResponse.json({ result });
}
