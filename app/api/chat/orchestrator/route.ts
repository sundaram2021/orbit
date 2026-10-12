import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { getAnthropicClient, orbitModel } from "@/lib/ai";
import { memoryRecall, memoryRemember } from "@/lib/memory";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";
import { runTool, toolSchemas, type ToolContext } from "@/lib/tools/registry";
import { registerOrchestratorTools } from "@/lib/tools/orchestrator-tools";
import { registerGithubTools } from "@/lib/tools/github";
import { registerWebTools } from "@/lib/tools/web";

import { buildOrchestratorSystemPrompt } from "@/lib/orchestrator/system-prompt";

let orchestratorToolsRegistered = false;
function ensureOrchestratorTools(): void {
  if (orchestratorToolsRegistered) return;
  registerOrchestratorTools();
  registerGithubTools();
  registerWebTools();
  orchestratorToolsRegistered = true;
}

export const maxDuration = 120;

interface ChatAttachmentIn {
  type: "issue" | "pr" | "file" | "image";
  number?: number;
  title?: string;
  name?: string;
  content?: string;
  /** Downscaled JPEG data URL (image attachments). */
  dataUrl?: string;
  mediaType?: string;
}

interface ChatBody {
  message: string;
  /** Repo selected in the UI — all work defaults to it unless the user names another. */
  repo?: string;
  thread_id?: string;
  /** Attachments from the "+" menu: uploaded file, selected issue, selected PR. */
  attachments?: ChatAttachmentIn[];
}

function sseEncode(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function getThread(
  supabase: Awaited<ReturnType<typeof createOrbitServerClient>>,
  userId: string,
  threadId?: string
) {
  // Explicit thread (verified to belong to the user).
  if (threadId) {
    const { data: owned } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .eq("kind", "orchestrator")
      .single();
    if ((owned as { id?: string } | null)?.id) return threadId;
  }
  // Latest thread, else create the first one.
  const { data: existing } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "orchestrator")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if ((existing as { id?: string } | null)?.id) {
    return (existing as { id: string }).id;
  }
  const { data: created } = await supabase
    .from("chat_threads")
    .insert([{ user_id: userId, kind: "orchestrator", title: "New conversation" }])
    .select("id")
    .single();
  return (created as { id: string }).id;
}

function titleFor(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 45 ? `${clean.slice(0, 45)}…` : clean || "New conversation";
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
  const userId = user.id;

  const { message, repo: activeRepo, thread_id: requestedThread, attachments } =
    (await request.json()) as ChatBody;
  if (!message?.trim() && (!attachments || attachments.length === 0)) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  const selectedRepo = (activeRepo ?? "").trim();
  const incoming = (attachments ?? []).filter((a) => a && a.type) as ChatAttachmentIn[];
  // Multiple issues/PRs per message are allowed — the orchestrator spawns
  // ONE sub-agent per attached issue/PR (one task per sub-agent).
  const issueAtts = incoming.filter((a) => a.type === "issue" && a.number);
  const prAtts = incoming.filter((a) => a.type === "pr" && a.number);
  const fileAtts = incoming.filter((a) => a.type === "file");
  // Pasted/uploaded images: sent as vision context to the orchestrator.
  // Sub-agents can't see images, so the orchestrator describes the relevant
  // bits inside each spawn_task description.
  const imageAtts = incoming
    .filter((a) => a.type === "image" && a.dataUrl)
    .slice(0, 3)
    .map((a) => ({
      name: a.name ?? "pasted image",
      dataUrl: a.dataUrl as string,
      mediaType: (a.mediaType ?? "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp",
    }));

  const threadId = await getThread(supabase, userId, requestedThread);
  const userStoredContent = [
    message,
    ...incoming.map((a) =>
      a.type === "file"
        ? `[file: ${a.name ?? "upload"}]`
        : a.type === "image"
          ? `[image: ${a.name ?? "pasted image"}]`
          : `[${a.type} #${a.number}: ${a.title ?? ""}]`.trim()
    ),
  ]
    .filter(Boolean)
    .join("\n");
  await supabase.from("chat_messages").insert([{ thread_id: threadId, role: "user", content: userStoredContent }]);
  // Touch recency + auto-title untitled threads from the first message.
  await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
  const { data: threadRow } = await supabase.from("chat_threads").select("title").eq("id", threadId).single();
  if ((threadRow as { title?: string } | null)?.title === "New conversation") {
    await supabase.from("chat_threads").update({ title: titleFor(message) }).eq("id", threadId);
  }

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(30);

  const digest = await memoryRecall(userId, userStoredContent);
  const svc = createServiceClient();

  // Pre-fetch every attached issue/PR body so the orchestrator can write a
  // detailed customized prompt per sub-agent.
  async function fetchAttachmentContexts(): Promise<{ label: string; body: string }[]> {
    const contexts: { label: string; body: string }[] = [];
    for (const f of fileAtts) {
      if (f.name || f.content) {
        contexts.push({
          label: `file: ${f.name ?? "upload"}`,
          body: (f.content ?? "").slice(0, 6000) || "(empty file)",
        });
      }
    }
    if (imageAtts.length > 0) {
      contexts.push({
        label: `${imageAtts.length} attached image(s)`,
        body: `The user attached ${imageAtts.length} image(s) (${imageAtts.map((i) => i.name).join(", ")}). They are visible to you in this turn's images — describe what is relevant inside each spawn_task description, because sub-agents cannot see images.`,
      });
    }
    if (
      (issueAtts.length === 0 && prAtts.length === 0) ||
      !selectedRepo ||
      !selectedRepo.includes("/")
    ) {
      return contexts;
    }
    try {
      const { data: tokenRow } = await svc
        .from("github_connections")
        .select("provider_token")
        .eq("user_id", userId)
        .single();
      const token = (tokenRow as { provider_token?: string } | null)?.provider_token;
      if (!token) return contexts;
      const { Octokit } = await import("@octokit/rest");
      const octokit = new Octokit({ auth: token });
      const [owner, name] = selectedRepo.split("/");
      for (const issueAtt of issueAtts) {
        if (!issueAtt.number) continue;
        try {
          const [issue, comments] = await Promise.all([
            octokit.issues.get({ owner, repo: name, issue_number: issueAtt.number }),
            octokit.issues.listComments({
              owner,
              repo: name,
              issue_number: issueAtt.number,
              per_page: 10,
            }),
          ]);
          contexts.push({
            label: `issue #${issueAtt.number}: ${issue.data.title}`,
            body: [
              `State: ${issue.data.state}`,
              issue.data.body?.slice(0, 4000) ?? "(no body)",
              "--- comments ---",
              ...comments.data.slice(-5).map((c) => `@${c.user?.login}: ${(c.body ?? "").slice(0, 600)}`),
            ].join("\n"),
          });
        } catch (err) {
          contexts.push({
            label: `issue #${issueAtt.number}`,
            body: `Could not fetch issue: ${(err as Error).message.slice(0, 200)}`,
          });
        }
      }
      for (const prAtt of prAtts) {
        if (!prAtt.number) continue;
        try {
          const [pr, diff] = await Promise.all([
            octokit.pulls.get({ owner, repo: name, pull_number: prAtt.number }),
            octokit
              .request(`GET /repos/${owner}/${name}/pulls/${prAtt.number}`, {
                headers: { accept: "application/vnd.github.diff" },
              })
              .then((res) => String(res.data).slice(0, 8000))
              .catch(() => "(diff unavailable)"),
          ]);
          contexts.push({
            label: `PR #${prAtt.number}: ${pr.data.title}`,
            body: [
              `State: ${pr.data.state} ${pr.data.head.ref} → ${pr.data.base.ref}`,
              pr.data.body?.slice(0, 2000) ?? "(no body)",
              "--- diff (truncated) ---",
              diff,
            ].join("\n"),
          });
        } catch (err) {
          contexts.push({
            label: `PR #${prAtt.number}`,
            body: `Could not fetch PR: ${(err as Error).message.slice(0, 200)}`,
          });
        }
      }
    } catch (err) {
      console.warn("attachment fetch failed:", err);
    }
    return contexts;
  }

  const attachmentContexts = await fetchAttachmentContexts();
  const attachmentSummary =
    attachmentContexts.length > 0
      ? `\n\nATTACHED CONTEXT (user selected via "+" menu):\n${attachmentContexts
          .map((c) => `--- ${c.label} ---\n${c.body.slice(0, 1500)}`)
          .join("\n\n")}`
      : "";

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: object) => controller.enqueue(encoder.encode(sseEncode(obj)));
      let fullText = "";

      try {
        const anthropic: Anthropic = getAnthropicClient();
        ensureOrchestratorTools();

        const { data: conn } = await svc
          .from("github_connections")
          .select("provider_token")
          .eq("user_id", userId)
          .single();
        const toolCtx: ToolContext = {
          userId,
          supabase: svc,
          traceId: `chat-${threadId}`,
          githubToken: (conn as { provider_token?: string } | null)?.provider_token ?? null,
        };
        const tools = [
          ...toolSchemas([
            "list_agents",
            "get_agent",
            "running_agents",
            "message_agent",
            "cancel_agent",
            "github_read",
            "github_comment",
            "github_code_search",
            "close_issue",
            "close_pr",
            "list_issues",
            "list_prs",
            "repo_overview",
            "web_search",
            "fetch_url",
            "search_memory",
          ]),
          {
            name: "spawn_task",
            description:
              "Propose ONE sub-agent for ONE unit of work (fix an issue, review a PR, implement a feature). Call this ONCE PER attached issue/PR — never bundle two issues into one call. The spawn pipeline builds a detailed customized prompt from the issue/PR/file context for that task.",
            input_schema: {
              type: "object" as const,
              properties: {
                repo: { type: "string", description: "owner/name of the GitHub repo" },
                title: { type: "string", description: "short task title, mention the issue/PR number" },
                description: {
                  type: "string",
                  description:
                    "full task brief: what to do, acceptance criteria, the issue/PR number, findings from github_read, and a text description of any attached images relevant to THIS task (sub-agents cannot see images)",
                },
                issue_number: { type: "number", description: "attached issue number for THIS task, if any" },
                pr_number: { type: "number", description: "attached PR number for THIS task, if any" },
              },
              required: ["repo", "title"],
            },
          },
        ] as Anthropic.Tool[];

        const enrichedUserContent = `${userStoredContent}${attachmentSummary}`;

        // Vision blocks for pasted/uploaded images (Anthropic image content).
        const imageBlocks: Anthropic.ImageBlockParam[] = imageAtts.map((img) => {
          const base64 = img.dataUrl.includes(",")
            ? img.dataUrl.slice(img.dataUrl.indexOf(",") + 1)
            : img.dataUrl;
          return {
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: base64 },
          };
        });

        const messages: Anthropic.MessageParam[] = [
          ...((history ?? []) as { role: "user" | "assistant"; content: string }[])
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
          {
            role: "user",
            content:
              imageBlocks.length > 0
                ? [{ type: "text" as const, text: enrichedUserContent }, ...imageBlocks]
                : enrichedUserContent,
          },
        ];

        const systemPrompt = buildOrchestratorSystemPrompt({
          activeRepo: selectedRepo,
          issues: issueAtts.map((a) => ({ number: a.number as number, title: a.title })),
          prs: prAtts.map((a) => ({ number: a.number as number, title: a.title })),
          fileCount: fileAtts.length,
          imageCount: imageAtts.length,
          memoryDigest: digest,
        });

        function formatToolLabel(name: string, input: Record<string, unknown>): string {
          switch (name) {
            case "list_issues":
              return `Checking ${input.state ?? "open"} issues in ${input.repo ?? "repo"}…`;
            case "list_prs":
              return `Checking ${input.state ?? "open"} pull requests in ${input.repo ?? "repo"}…`;
            case "close_issue":
              return `Closing issue #${input.issue_number ?? ""} in ${input.repo ?? ""}…`;
            case "close_pr":
              return `Closing PR #${input.pr_number ?? ""} in ${input.repo ?? ""}…`;
            case "github_read":
              return `Reading GitHub ${input.kind ?? "item"} #${input.number ?? ""} on ${input.repo ?? ""}…`;
            case "github_comment":
              return `Drafting comment on ${input.repo ?? ""}#${input.number ?? ""}…`;
            case "github_code_search":
              return `Searching codebase for "${String(input.query ?? "").slice(0, 30)}"…`;
            case "spawn_task":
              return `Spawning sub-agent for: "${String(input.title ?? "task").slice(0, 40)}"…`;
            case "list_agents":
              return "Checking recent sub-agent runs…";
            case "running_agents":
              return "Checking active running agents…";
            case "search_memory":
              return "Recalling workspace memory…";
            default:
              return `Executing ${name}…`;
          }
        }

        const executedSteps: Array<{ tool: string; label: string; status: "done" | "error" }> = [];

        for (let round = 0; round < 5; round++) {
          send({
            type: "status",
            status: "thinking",
            label: round === 0 ? "Analyzing request & tools…" : "Formulating response…",
          });

          const response = await anthropic.messages.create({
            model: orbitModel(),
            max_tokens: 2048,
            system: systemPrompt,
            tools,
            messages,
          });
          messages.push({ role: "assistant", content: response.content });

          const uses = response.content.filter((b) => b.type === "tool_use");
          if (uses.length === 0) {
            // Extract and stream the assistant's response text directly
            const textBlocks = response.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;
            const answer = textBlocks.map((b) => b.text).join("");
            if (answer) {
              fullText += answer;
              // Smooth typewriter streaming
              const chunkSize = 20;
              for (let i = 0; i < answer.length; i += chunkSize) {
                send({ delta: answer.slice(i, i + chunkSize) });
              }
            }
            break;
          }

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of uses) {
            if (use.type !== "tool_use") continue;
            const input = (use.input ?? {}) as Record<string, unknown>;
            const label = formatToolLabel(use.name, input);

            send({
              type: "step_start",
              tool: use.name,
              label,
            });

            if (use.name === "spawn_task") {
              const spawnInput = input as {
                repo?: string;
                title?: string;
                description?: string;
                issue_number?: number;
                pr_number?: number;
              };
              const repo =
                (spawnInput.repo ?? "").trim() ||
                selectedRepo ||
                "unknown/unknown";

              const scopedContexts =
                spawnInput.issue_number || spawnInput.pr_number
                  ? attachmentContexts.filter((c) => {
                      if (c.label.startsWith("file:") || c.label.includes("attached image")) {
                        return true;
                      }
                      if (spawnInput.issue_number) {
                        const re = new RegExp(`\\bissue #${spawnInput.issue_number}\\b`, "i");
                        if (re.test(c.label)) return true;
                      }
                      if (spawnInput.pr_number) {
                        const re = new RegExp(`\\bPR #${spawnInput.pr_number}\\b`);
                        if (re.test(c.label)) return true;
                      }
                      return false;
                    })
                  : attachmentContexts;
              const fallbackIssue =
                issueAtts.length === 1 ? (issueAtts[0].number as number) : null;
              const fallbackPr = prAtts.length === 1 ? (prAtts[0].number as number) : null;
              try {
                const { agentId, autoStarted } = await proposeAndMaybeRun(svc, {
                  userId,
                  source: "chat",
                  repo,
                  title: spawnInput.title ?? userStoredContent.slice(0, 80),
                  body: spawnInput.description ?? userStoredContent,
                  issueNumber: spawnInput.issue_number ?? fallbackIssue,
                  prNumber: spawnInput.pr_number ?? fallbackPr,
                  userInstruction: message,
                  attachmentContexts:
                    scopedContexts.length > 0 ? scopedContexts : attachmentContexts,
                });
                results.push({
                  type: "tool_result",
                  tool_use_id: use.id,
                  content: `Sub-agent proposed (id ${agentId}). ${autoStarted ? "Auto-approval is ON so it started running immediately." : "It is waiting for user approval."}`,
                });
                executedSteps.push({ tool: use.name, label, status: "done" });
                send({ type: "step_done", tool: use.name, label: `Sub-agent ready (id ${agentId.slice(0, 8)})` });
              } catch (err) {
                results.push({
                  type: "tool_result",
                  tool_use_id: use.id,
                  content: `Failed to spawn agent: ${(err as Error).message}`,
                  is_error: true,
                });
                executedSteps.push({ tool: use.name, label, status: "error" });
                send({ type: "step_done", tool: use.name, label: `Failed to spawn: ${(err as Error).message.slice(0, 60)}` });
              }
              continue;
            }

            // Registry tools (close_issue, close_pr, list_issues, list_prs, github_read, etc.)
            const out = await runTool(use.name, input as Record<string, string>, toolCtx);
            let content = out.output;
            if (out.needsApproval === "github_comment") {
              const commInput = input as { repo?: string; number?: string; body?: string };
              await svc
                .from("approvals")
                .insert([
                  {
                    user_id: userId,
                    kind: "github_comment",
                    ref_id: JSON.stringify({ repo: commInput.repo, number: commInput.number, body: commInput.body }),
                    status: "pending",
                  },
                ]);
              content = "Comment queued for user approval — it will post once approved.";
            }

            executedSteps.push({ tool: use.name, label, status: out.ok ? "done" : "error" });
            send({
              type: "step_done",
              tool: use.name,
              label: out.ok ? `Done: ${use.name}` : `Failed: ${use.name}`,
            });

            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: content.slice(0, 12000),
              is_error: out.ok ? undefined : true,
            });
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
        void memoryRemember(userId, `Orchestrator chat: user asked "${userStoredContent.slice(0, 200)}", assistant replied "${fullText.slice(0, 300)}".`);
      }
      send({ done: true, steps: executedSteps });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

/** Chat history for the UI (?thread_id= to open a specific chat). */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const threadId = await getThread(
    supabase,
    user.id,
    new URL(request.url).searchParams.get("thread_id") ?? undefined
  );
  const { data } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(100);
  return NextResponse.json({ messages: data ?? [] });
}
