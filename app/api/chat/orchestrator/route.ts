import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { getAnthropicClient, orbitModel } from "@/lib/ai";
import { memoryRecall, memoryRemember } from "@/lib/memory";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";

export const maxDuration = 120;

interface ChatBody {
  message: string;
}

function sseEncode(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function getThread(supabase: Awaited<ReturnType<typeof createOrbitServerClient>>, userId: string) {
  const { data: existing } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "orchestrator")
    .single();
  if ((existing as { id?: string } | null)?.id) {
    return (existing as { id: string }).id;
  }
  const { data: created } = await supabase
    .from("chat_threads")
    .insert([{ user_id: userId, kind: "orchestrator" }])
    .select("id")
    .single();
  return (created as { id: string }).id;
}

/**
 * Orchestrator chat (claude.ai-like, streamed).
 * The model can spawn sub-agents via the spawn_task tool — user requests
 * follow the identical propose → approve → run pipeline as polled events.
 */
export async function POST(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { message } = (await request.json()) as ChatBody;
  if (!message?.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const threadId = await getThread(supabase, user.id);
  await supabase.from("chat_messages").insert([{ thread_id: threadId, role: "user", content: message }]);

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(30);

  const digest = await memoryRecall(user.id, message);
  const svc = createServiceClient();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: object) => controller.enqueue(encoder.encode(sseEncode(obj)));
      let fullText = "";

      try {
        const anthropic: Anthropic = getAnthropicClient();
        const tools: Anthropic.Tool[] = [
          {
            name: "spawn_task",
            description:
              "Propose a sub-agent for a GitHub task (fix an issue, review a PR, implement a feature). Call this when the user asks for work to be done.",
            input_schema: {
              type: "object" as const,
              properties: {
                repo: { type: "string", description: "owner/name of the GitHub repo" },
                title: { type: "string", description: "short task title" },
                description: { type: "string", description: "task details, issue/PR numbers if known" },
              },
              required: ["repo", "title"],
            },
          },
        ];

        const messages: Anthropic.MessageParam[] = [
          ...((history ?? []) as { role: "user" | "assistant"; content: string }[])
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
          { role: "user", content: message },
        ];

        // Tool loop (max 2 rounds), then stream the final answer.
        for (let round = 0; round < 2; round++) {
          const response = await anthropic.messages.create({
            model: orbitModel(),
            max_tokens: 2048,
            system: `You are Orbit, the user's GitHub orchestrator. You spawn specialized sub-agents (implementation, review, testing) that work in sandboxes and open PRs. Be concise and concrete. When the user asks for work, call spawn_task once per task, then summarize what the agent will do and whether it needs approval.\n\nShared memory from past work:\n${digest.slice(0, 2000) || "(none yet)"}`,
            tools,
            messages,
          });
          messages.push({ role: "assistant", content: response.content });

          const uses = response.content.filter((b) => b.type === "tool_use");
          if (uses.length === 0) {
            // Stream this final response.
            const streamResp = await anthropic.messages.create({
              model: orbitModel(),
              max_tokens: 2048,
              system: "You are Orbit, the user's GitHub orchestrator. Repeat your previous answer verbatim.",
              messages: [...messages, { role: "user", content: "Repeat your previous answer verbatim." }],
              stream: true,
            });
            for await (const event of streamResp) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                fullText += event.delta.text;
                send({ delta: event.delta.text });
              }
            }
            break;
          }

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of uses) {
            if (use.type !== "tool_use" || use.name !== "spawn_task") continue;
            const input = use.input as { repo?: string; title?: string; description?: string };
            try {
              const { agentId, autoStarted } = await proposeAndMaybeRun(svc, {
                userId: user.id,
                source: "chat",
                repo: input.repo ?? "unknown/unknown",
                title: input.title ?? message.slice(0, 80),
                body: input.description ?? message,
              });
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: `Sub-agent proposed (id ${agentId}). ${autoStarted ? "Auto-approval is ON so it started running immediately." : "It is waiting for user approval."}`,
              });
            } catch (err) {
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: `Failed to spawn agent: ${(err as Error).message}`,
                is_error: true,
              });
            }
          }
          messages.push({ role: "user", content: results });
        }
      } catch (err) {
        const msg = `Orchestrator error: ${(err as Error).message.slice(0, 300)}`;
        fullText += (fullText ? "\n\n" : "") + msg;
        send({ delta: msg });
      }

      if (fullText) {
        await supabase.from("chat_messages").insert([{ thread_id: threadId, role: "assistant", content: fullText }]);
        void memoryRemember(user.id, `Orchestrator chat: user asked "${message.slice(0, 200)}", assistant replied "${fullText.slice(0, 300)}".`);
      }
      send({ done: true });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

/** Chat history for the UI. */
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
