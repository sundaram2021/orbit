import type { SupabaseClient } from "@supabase/supabase-js";
import type { Classification } from "./classify";
import { buildSubAgentSystemPrompt, type TaskAttachmentContext } from "./subagent-prompt";

export type { TaskAttachmentContext };

/**
 * Orchestrator step 2: build the custom system prompt for a sub-agent.
 * Starts from the stored template (which the evaluator improves over time),
 * then composes the detailed autonomous-executor prompt around it.
 *
 * Every task gets a detailed customized prompt carrying all task context.
 * There are no skills — the customized prompt IS the customization.
 */
export async function buildSystemPrompt(
  supabase: SupabaseClient,
  classification: Classification,
  opts: {
    memoryDigest?: string;
    eventContext?: string;
    /** User's direct instruction typed in the new-task composer. */
    userInstruction?: string;
    /** Attached issue/PR/file bodies (already fetched server-side). */
    attachmentContexts?: TaskAttachmentContext[];
    /** Attached issue number, if any (for branch naming / trace). */
    issueNumber?: number | null;
    /** Attached PR number, if any. */
    prNumber?: number | null;
  }
): Promise<string> {
  let template = "";
  try {
    const { data } = await supabase
      .from("agent_templates")
      .select("system_prompt")
      .eq("kind", classification.kind)
      .single();
    template = (data as { system_prompt?: string } | null)?.system_prompt ?? "";
  } catch {
    template = "";
  }
  if (!template) {
    template =
      "You are a sub-agent in the Orbit factory. Complete the assigned GitHub task carefully with minimal, tested changes.";
  }

  return buildSubAgentSystemPrompt({
    template,
    classification,
    memoryDigest: opts.memoryDigest,
    eventContext: opts.eventContext,
    userInstruction: opts.userInstruction,
    attachmentContexts: opts.attachmentContexts,
    issueNumber: opts.issueNumber,
    prNumber: opts.prNumber,
  });
}
