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
  // Notifications live in the activity feed + toasts + bell — NEVER in the
  // chat thread. The orchestrator page is a clean ChatGPT-style chat.
  void userId;
  try {
    await supabase.from("activities").insert([
      { title, description, type },
    ]);
  } catch (err) {
    console.warn("activity notify failed:", err);
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
 * Insert tolerant of the v2 migration not being applied yet
 * (skill_definitions / run_log columns). Retries without new columns.
 */
async function insertAgent(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: any }> {
  const first = await supabase.from("sub_agents").insert([row]).select("id").single();
  if (!first.error) return first;
  const msg = String(first.error.message ?? "");
  if (msg.includes("skill_definitions") || msg.includes("run_log") || msg.includes("column")) {
    const { skill_definitions: _drop1, run_log: _drop2, ...legacy } = row;
    void _drop1;
    void _drop2;
    return supabase.from("sub_agents").insert([legacy]).select("id").single();
  }
  return first;
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

  // Always start as awaiting_approval — runSubAgent atomically claims
  // (awaiting_approval → running) so duplicate triggers can't double-run.
  const { data: agent, error } = await insertAgent(supabase, {
    user_id: input.userId,
    event_id: input.eventId ?? null,
    kind: classification.kind,
    title: classification.title,
    system_prompt: systemPrompt,
    skills: skills.map((s) => s.name),
    skill_definitions: skills,
    status: "awaiting_approval",
    trace_id: traceId,
  });
  if (error || !agent) throw new Error(`sub_agents insert failed: ${error?.message}`);
  const agentId = (agent as { id: string }).id;

  if (input.eventId) {
    await supabase
      .from("github_events")
      .update({ status: "proposed" })
      .eq("id", input.eventId);
  }

  await memoryRemember(
    input.userId,
    [
      `Orbit spawned a ${classification.kind} sub-agent titled "${classification.title}" for repository ${classification.repo}.`,
      `Execution plan: ${classification.plan}`,
      `Assigned skills: ${skills.map((s) => s.name).join(", ") || "none"}.`,
      `Risk level: ${classification.risk}. Source: ${input.source}.`,
    ].join(" "),
    { agent_id: agentId }
  );

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
