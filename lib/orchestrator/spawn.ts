import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyWork } from "./classify";
import { buildSystemPrompt } from "./prompts";
import { resolveSkills } from "./skills";
import { memoryRecall, memoryRemember } from "../memory";
import { newTraceId, traceStart, traceSpan } from "../traces";
import type { GithubEvent, UserSettings } from "@/types/orbit-types";

export async function getUserSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  try {
    const { data } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (data) return data as UserSettings;
  } catch {
    // fall through to default
  }
  return {
    user_id: userId,
    orchestrator_auto_approve: false,
    evaluator_auto_apply: false,
  };
}

async function notify(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  description: string,
  type: "sparkles" | "brain" | "pr" | "issue" | "event" = "sparkles"
): Promise<void> {
  try {
    await supabase.from("activities").insert([
      { title, description, type },
    ]);
  } catch (err) {
    console.warn("activity notify failed:", err);
  }
  // Also drop a message into the orchestrator chat thread so the user
  // sees "your agent is ready" in conversation form.
  try {
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "orchestrator")
      .single();
    let threadId = (thread as { id?: string } | null)?.id;
    if (!threadId) {
      const { data: created } = await supabase
        .from("chat_threads")
        .insert([{ user_id: userId, kind: "orchestrator" }])
        .select("id")
        .single();
      threadId = (created as { id?: string } | null)?.id;
    }
    if (threadId) {
      await supabase.from("chat_messages").insert([
        { thread_id: threadId, role: "assistant", content: `**${title}**\n\n${description}` },
      ]);
    }
  } catch (err) {
    console.warn("chat notify failed:", err);
  }
}

interface ProposalInput {
  userId: string;
  source: string;
  repo: string;
  number?: number | null;
  title?: string | null;
  body?: string | null;
  eventId?: string | null;
}

/**
 * Shared propose → (maybe auto-)run pipeline used by polling, webhooks,
 * and orchestrator chat alike.
 */
export async function proposeAndMaybeRun(
  supabase: SupabaseClient,
  input: ProposalInput
): Promise<{ agentId: string; autoStarted: boolean }> {
  const settings = await getUserSettings(supabase, input.userId);

  const classification = await classifyWork({
    source: input.source,
    repo: input.repo,
    number: input.number,
    title: input.title,
    body: input.body,
  });

  const memoryDigest = await memoryRecall(
    input.userId,
    `${classification.title} ${classification.repo}`
  );

  const skills = await resolveSkills(supabase, classification.skillsNeeded);

  const systemPrompt = await buildSystemPrompt(supabase, classification, {
    memoryDigest,
    skillDefinitions: skills.map((s) => `${s.name}: ${s.definition}`),
    eventContext: input.body ?? undefined,
  });

  const traceId = newTraceId();
  await traceStart({
    traceId,
    title: classification.title,
    metadata: { repo: classification.repo, kind: classification.kind },
  });
  await traceSpan(traceId, { name: "classified", detail: classification.plan });

  const { data: agent, error } = await supabase
    .from("sub_agents")
    .insert([
      {
        user_id: input.userId,
        event_id: input.eventId ?? null,
        kind: classification.kind,
        title: classification.title,
        system_prompt: systemPrompt,
        skills: skills.map((s) => s.name),
        status: settings.orchestrator_auto_approve ? "running" : "awaiting_approval",
        trace_id: traceId,
      },
    ])
    .select("id")
    .single();
  if (error || !agent) throw new Error(`sub_agents insert failed: ${error?.message}`);
  const agentId = (agent as { id: string }).id;

  if (input.eventId) {
    await supabase
      .from("github_events")
      .update({ status: "proposed" })
      .eq("id", input.eventId);
  }

  await memoryRemember(input.userId, `Spawned ${classification.kind} agent "${classification.title}" for ${classification.repo}.`, {
    agent_id: agentId,
  });

  if (settings.orchestrator_auto_approve) {
    await notify(
      supabase,
      input.userId,
      `Agent started: ${classification.title}`,
      `Auto-approval is on — the ${classification.kind} agent is working in a sandbox now.`
    );
    // Fire-and-forget: the run loop outlives the request.
    const { runSubAgent } = await import("../sandbox/run");
    void runSubAgent(supabase, input.userId, agentId);
    return { agentId, autoStarted: true };
  }

  await supabase.from("approvals").insert([
    { user_id: input.userId, kind: "run_agent", ref_id: agentId, status: "pending" },
  ]);
  await notify(
    supabase,
    input.userId,
    `Your agent is ready: ${classification.title}`,
    `A ${classification.kind} agent with ${skills.length} skill(s) is waiting for your approval in ${classification.repo}.`
  );
  return { agentId, autoStarted: false };
}

export async function proposeFromEvent(
  supabase: SupabaseClient,
  event: GithubEvent
): Promise<{ agentId: string; autoStarted: boolean }> {
  const payload = event.payload as Record<string, unknown>;
  const body =
    (payload.body as string | undefined) ??
    (payload.description as string | undefined) ??
    null;
  return proposeAndMaybeRun(supabase, {
    userId: event.user_id,
    source: `github:${event.type}`,
    repo: event.repo,
    number: event.number,
    title: event.title,
    body,
    eventId: event.id,
  });
}
