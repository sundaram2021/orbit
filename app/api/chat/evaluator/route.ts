import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { getAnthropicClient, orbitModel } from "@/lib/ai";
import { memoryRecall } from "@/lib/memory";
import { buildEvaluatorChatPrompt } from "@/lib/eval/evaluator-prompt";

export const maxDuration = 120;

function sseEncode(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function getThread(supabase: Awaited<ReturnType<typeof createOrbitServerClient>>, userId: string) {
  const { data: existing } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "evaluator")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if ((existing as { id?: string } | null)?.id) return (existing as { id: string }).id;
  const { data: created } = await supabase
    .from("chat_threads")
    .insert([{ user_id: userId, kind: "evaluator" }])
    .select("id")
    .single();
  return (created as { id: string }).id;
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

  const { message } = (await request.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const threadId = await getThread(supabase, user.id);
  await supabase.from("chat_messages").insert([{ thread_id: threadId, role: "user", content: message }]);

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
      try {
        const anthropic = getAnthropicClient();
        const streamResp = await anthropic.messages.create({
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
        for await (const event of streamResp) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            send({ delta: event.delta.text });
          }
        }
      } catch (err) {
        const msg = `Evaluator error: ${(err as Error).message.slice(0, 300)}`;
        fullText += msg;
        send({ delta: msg });
      }
      send({ done: true });
      controller.close();
      if (fullText) {
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

  const threadId = await getThread(supabase, user.id);
  const { data } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(100);
  return NextResponse.json({ messages: data ?? [] });
}
