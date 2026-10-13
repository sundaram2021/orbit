import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { getAnthropicClient, orbitModel } from "@/lib/ai";
import { memoryRecall } from "@/lib/memory";
import { buildEvaluatorChatPrompt } from "@/lib/eval/evaluator-prompt";

export const maxDuration = 120;

function sseEncode(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function getThread(supabase: Awaited<ReturnType<typeof createOrbitServerClient>>, userId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "evaluator")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if ((existing as { id?: string } | null)?.id) return (existing as { id: string }).id;
  const { data: created, error } = await supabase
    .from("chat_threads")
    .insert([{ user_id: userId, kind: "evaluator" }])
    .select("id")
    .single();
  const createdId = (created as { id?: string } | null)?.id;
  if (error || !createdId) {
    throw new Error(`Could not start conversation: ${error?.message ?? "database unavailable"}`);
  }
  return createdId;
}

/**
 * Evaluator chat (claude.ai-like, streamed). Read-only persona over
 * evaluations + traces: explains scores, shows tuning suggestions,
 * and points at pending tuning approvals.
 */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const message = (body?.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const { isAiConfigured } = await import("@/lib/ai").catch(() => ({ isAiConfigured: () => true }));
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured. Set AI_API_KEY and retry.", retryable: false },
      { status: 503 }
    );
  }

  let threadId: string;
  try {
    threadId = await getThread(supabase, user.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, retryable: true }, { status: 503 });
  }
  const userPersist = await supabase
    .from("chat_messages")
    .insert([{ thread_id: threadId, role: "user", content: message }]);
  if (userPersist.error) {
    console.warn("evaluator user-message persist failed:", userPersist.error.message);
  }

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(30);

  // Recent evaluations + pending tuning approvals as context.
  // async-parallel: agents query and memory recall are independent.
  const [agentsRes, digest] = await Promise.all([
    supabase
      .from("sub_agents")
      .select("id, title, kind, status, eval_score")
      .order("created_at", { ascending: false })
      .limit(10),
    memoryRecall(user.id, message),
  ]);
  const { data: agents } = agentsRes;
  const agentIds = ((agents ?? []) as { id: string }[]).map((a) => a.id);
  let evalContext = "";
  if (agentIds.length > 0) {
    const { data: evals } = await supabase
      .from("evaluations")
      .select("sub_agent_id, score, summary, status")
      .in("sub_agent_id", agentIds)
      .order("created_at", { ascending: false })
      .limit(10);
    evalContext = JSON.stringify({ agents: agents ?? [], evaluations: evals ?? [] }).slice(0, 4000);
  }
  const system = buildEvaluatorChatPrompt({
    evalContext,
    memoryDigest: digest,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: object) => controller.enqueue(encoder.encode(sseEncode(obj)));
      let fullText = "";
      let streamError: string | null = null;
      try {
        const anthropic = getAnthropicClient();
        const { withTimeout } = await import("@/lib/fetch-utils");
        const streamPromise = anthropic.messages.create({
          model: orbitModel(),
          max_tokens: 2048,
          system,
          messages: [
            ...((history ?? []) as { role: "user" | "assistant"; content: string }[])
              .slice(0, -1)
              .map((m) => ({ role: m.role, content: m.content }) as { role: "user" | "assistant"; content: string }),
            { role: "user" as const, content: message },
          ],
          stream: true,
        });
        // Bound the whole stream: a stalled provider must not hold the
        // controller open until the platform timeout.
        const { result: streamResp, timedOut } = await withTimeout(streamPromise, 90000, "evaluator stream");
        if (timedOut || !streamResp) throw new Error("Evaluator timed out — retry.");
        for await (const event of streamResp) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            send({ delta: event.delta.text });
          }
        }
      } catch (err) {
        // Typed error frame — never persisted as chat history.
        streamError = (err as Error).message.slice(0, 300);
        send({ type: "error", error: streamError, retryable: true });
      }
      send({ done: true });
      controller.close();
      if (fullText && !streamError) {
        const content = fullText;
        void (async () => {
          try {
            const { error } = await supabase
              .from("chat_messages")
              .insert([{ thread_id: threadId, role: "assistant", content }]);
            if (error) console.warn("evaluator history persist failed:", error.message);
          } catch (err) {
            console.warn("evaluator history persist failed:", err);
          }
        })();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const threadId = await getThread(supabase, user.id).catch(() => null);
  if (!threadId) {
    return NextResponse.json({ messages: [], error: "Couldn't load history. Retry.", retryable: true }, { status: 503 });
  }
  const { data } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(100);
  return NextResponse.json({ messages: data ?? [] });
}
