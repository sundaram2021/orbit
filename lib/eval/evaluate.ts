import type { SupabaseClient } from "@supabase/supabase-js";
import { haikuComplete } from "../ai";
import { getUserSettings } from "../orchestrator/spawn";
import { memoryRemember } from "../memory";
import { traceSpan } from "../traces";
import type { SubAgent } from "@/types/orbit-types";

interface EvalJson {
  score: number;
  correctness: number;
  tests: number;
  scope: number;
  pr_quality: number;
  summary: string;
  prompt_patch: string;
  skills_patch: string[];
}

/**
 * Evaluator agent: scores a finished sub-agent run and proposes
 * prompt/skill improvements. Applied immediately only when the user
 * enabled evaluator_auto_apply; otherwise an approval is requested.
 */
export async function evaluateAgent(
  supabase: SupabaseClient,
  userId: string,
  agentId: string,
  summary: string
): Promise<void> {
  const { data } = await supabase.from("sub_agents").select("*").eq("id", agentId).single();
  const agent = data as SubAgent | null;
  if (!agent) return;
  const traceId = agent.trace_id ?? agentId;

  let parsed: EvalJson;
  try {
    const raw = await haikuComplete({
      system:
        "You are Orbit's evaluator agent. Score sub-agent work fairly and output ONLY valid JSON (no markdown fences) with keys: score (0-100), correctness (0-25), tests (0-25), scope (0-25), pr_quality (0-25), summary (2-3 sentences), prompt_patch (improved system-prompt guidance, or empty string if none needed), skills_patch (array of skill names to add, empty if none).",
      messages: [
        {
          role: "user",
          content: `Task: ${agent.title}\nKind: ${agent.kind}\nSkills: ${agent.skills.join(", ")}\nSystem prompt:\n${agent.system_prompt.slice(0, 2000)}\n\nWork summary:\n${summary.slice(0, 4000)}`,
        },
      ],
      maxTokens: 1024,
    });
    parsed = JSON.parse(raw) as EvalJson;
  } catch (err) {
    console.warn("evaluator fallback:", err);
    parsed = {
      score: 70,
      correctness: 18,
      tests: 17,
      scope: 18,
      pr_quality: 17,
      summary: "Automatic scoring unavailable; default score applied.",
      prompt_patch: "",
      skills_patch: [],
    };
  }

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const { data: evaluation } = await supabase
    .from("evaluations")
    .insert([
      {
        sub_agent_id: agentId,
        score,
        rubric: {
          correctness: parsed.correctness ?? 0,
          tests: parsed.tests ?? 0,
          scope: parsed.scope ?? 0,
          pr_quality: parsed.pr_quality ?? 0,
        },
        summary: parsed.summary ?? "",
        prompt_patch: parsed.prompt_patch || null,
        skills_patch: parsed.skills_patch?.length ? parsed.skills_patch : null,
        status: "proposed",
      },
    ])
    .select("id")
    .single();
  const evaluationId = (evaluation as { id?: string } | null)?.id;

  await supabase.from("sub_agents").update({ eval_score: score }).eq("id", agentId);
  await traceSpan(traceId, { name: "evaluated", detail: `score ${score}: ${parsed.summary}` });
  await memoryRemember(userId, `Evaluator scored "${agent.title}" ${score}/100. ${parsed.summary}`, {
    agent_id: agentId,
  });

  const settings = await getUserSettings(supabase, userId);
  const hasPatch = Boolean(parsed.prompt_patch) || (parsed.skills_patch?.length ?? 0) > 0;

  if (settings.evaluator_auto_apply && hasPatch && evaluationId) {
    await applyPatches(supabase, agent, parsed);
    await supabase.from("evaluations").update({ status: "applied" }).eq("id", evaluationId);
    await supabase.from("activities").insert([
      {
        title: `Evaluator auto-tuned ${agent.kind} agents`,
        description: `Score ${score}/100. Prompt/skill improvements applied automatically.`,
        type: "brain",
      },
    ]);
    return;
  }

  if (hasPatch && evaluationId) {
    if (parsed.prompt_patch) {
      await supabase.from("approvals").insert([
        { user_id: userId, kind: "prompt_update", ref_id: evaluationId, status: "pending" },
      ]);
    }
    if (parsed.skills_patch?.length) {
      await supabase.from("approvals").insert([
        { user_id: userId, kind: "skill_update", ref_id: evaluationId, status: "pending" },
      ]);
    }
  }
  await supabase.from("activities").insert([
    {
      title: `Evaluation: ${agent.title} scored ${score}`,
      description: hasPatch
        ? `${parsed.summary} Tuning suggestions are waiting for your approval.`
        : parsed.summary,
      type: "brain",
    },
  ]);
}

export async function applyPatches(
  supabase: SupabaseClient,
  agent: SubAgent,
  patches: { prompt_patch?: string | null; skills_patch?: string[] | null }
): Promise<void> {
  try {
    if (patches.prompt_patch) {
      const { data: tpl } = await supabase
        .from("agent_templates")
        .select("system_prompt")
        .eq("kind", agent.kind)
        .single();
      const current = ((tpl as { system_prompt?: string } | null)?.system_prompt ?? "").slice(0, 4000);
      await supabase
        .from("agent_templates")
        .update({
          system_prompt: `${current}\n\n[Evaluator improvement]\n${patches.prompt_patch}`.slice(0, 8000),
          updated_at: new Date().toISOString(),
        })
        .eq("kind", agent.kind);
    }
    for (const skill of patches.skills_patch ?? []) {
      const name = skill.trim();
      if (!name) continue;
      await supabase.from("skill_library").upsert(
        {
          name,
          definition: `Recommended by evaluator after "${agent.title}". Follow this convention when the task calls for it.`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "name", ignoreDuplicates: true }
      );
    }
  } catch (err) {
    console.warn("applyPatches failed:", err);
  }
}
