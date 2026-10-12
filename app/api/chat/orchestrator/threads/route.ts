import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

interface ThreadRow {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
}

/** List orchestrator threads, newest first, with message counts. */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: threads } = await supabase
    .from("chat_threads")
    .select("id,title,updated_at,created_at")
    .eq("user_id", user.id)
    .eq("kind", "orchestrator")
    .order("updated_at", { ascending: false })
    .limit(50);

  const rows = (threads ?? []) as ThreadRow[];
  const counts: Record<string, number> = {};
  if (rows.length > 0) {
    const { data: msgs } = await supabase
      .from("chat_messages")
      .select("thread_id")
      .in("thread_id", rows.map((t) => t.id))
      .limit(2000);
    for (const m of ((msgs ?? []) as { thread_id: string }[])) {
      counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    threads: rows.map((t) => ({ ...t, message_count: counts[t.id] ?? 0 })),
  });
}

/** Start a new chat thread. */
export async function POST() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_threads")
    .insert([{ user_id: user.id, kind: "orchestrator", title: "New conversation" }])
    .select("id,title,updated_at,created_at")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "create failed" }, { status: 500 });
  }
  return NextResponse.json({ thread: data });
}
