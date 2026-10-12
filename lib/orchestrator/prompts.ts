import type { SupabaseClient } from "@supabase/supabase-js";
import type { Classification } from "./classify";

/**
 * Orchestrator step 2: build the custom system prompt for a sub-agent.
 * Starts from the stored template (which the evaluator improves over time),
 * then injects the task, plan, memory digest, and skills.
 */
export async function buildSystemPrompt(
  supabase: SupabaseClient,
  classification: Classification,
  opts: {
    memoryDigest?: string;
    skillDefinitions?: string[];
    eventContext?: string;
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

  const skills =
    opts.skillDefinitions && opts.skillDefinitions.length > 0
      ? opts.skillDefinitions.map((s) => `- ${s}`).join("\n")
      : "- (no special skills assigned — follow repo conventions and the rules below.)";

  return `${template}

## Assigned task
Title: ${classification.title}
Repo: ${classification.repo}
Plan: ${classification.plan}
Risk: ${classification.risk}
${opts.eventContext ? `\n## GitHub context\n${opts.eventContext.slice(0, 4000)}` : ""}
${opts.memoryDigest ? `\n## Shared memory (from past work)\n${opts.memoryDigest.slice(0, 3000)}` : ""}

## Skills for this task
${skills}

## Rules
- Work inside the provided sandbox checkout only.
- Create a feature branch named orbit/<short-task-slug>; never commit to the default branch.
- Run relevant tests before finishing and report results.
- End by summarizing: files changed, tests run, and the PR or comment to publish.`;
}
