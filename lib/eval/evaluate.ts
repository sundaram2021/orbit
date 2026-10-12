import type { SupabaseClient } from "@supabase/supabase-js";
import { haikuComplete } from "../ai";
import { getUserSettings } from "../orchestrator/spawn";
import { memoryRemember } from "../memory";
import type { SubAgent, SubAgentSkill } from "@/types/orbit-types";

interface EvalJson {
  score: number;
  correctness: number;
  quality: number;
  scope: number;
  summary: string;
  mistakes: string;
  prompt_patch: string;
  skills_patch: string[];
}

/**
 * Evaluator agent. Receives exactly three things about the sub-agent run:
 * its custom system prompt, its skills, and its output. Scores the work,
 * proposes prompt/skill improvements, and writes lessons-learned into
 * global memory so future spawns avoid the same mistakes.
 */
export async function evaluateAgent(
  supabase: SupabaseClient,
  userId: string,
  agentId: string,
  summary: string,
  _runLog = "",
  _ctx: { testsPassed?: boolean; repo?: string; branch?: string; base?: string; token?: string | null } = {}
): Promise<void> {
  void _runLog;
  void _ctx;
  const { data } = await supabase.from("sub_agents").select("*").eq("id", agentId).single();
  const agent = data as SubAgent | null;
  if (!agent) return;

  const skillDefs = ((agent.skill_definitions ?? []) as SubAgentSkill[])
    .map((s) => `- ${s.name}: ${s.definition}`)
    .join("\n");
  const skillsBlock =
    skillDefs || (agent.skills.length > 0 ? agent.skills.join(", ") : "(no skills assigned)");

  let parsed: EvalJson;
  try {
    const raw = await haikuComplete({
      system:
        "You are Orbit's evaluator agent. You judge sub-agent work from three things: the custom prompt it was given, the skills it had, and its output. Output ONLY valid JSON (no markdown fences) with keys: score (0-100), correctness (0-35), quality (0-35), scope (0-30), summary (2-3 sentences on what happened), mistakes (concrete mistakes future agents must avoid, or empty string), prompt_patch (improved system-prompt guidance to add, or empty string), skills_patch (array of skill names to add, empty if none).",
      messages: [
        {
          role: "user",
          content: [
            `## Task\n${agent.title} (kind: ${agent.kind})`,
            `## Custom system prompt given to the agent\n${agent.system_prompt.slice(0, 3000)}`,
            `## Skills the agent had\n${skillsBlock.slice(0, 2000)}`,
            `## Agent's output\n${summary.slice(0, 5000)}`,
            `Score this work.`,
          ].join("\n\n"),
        },
      ],
      maxTokens: 1024,
    });
    parsed = JSON.parse(raw) as EvalJson;
  } catch (err) {
    console.warn("evaluator fallback:", err);
    parsed = {
      score: 70,
      correctness: 25,
      quality: 24,
      scope: 21,
      summary: "Automatic scoring unavailable; default score applied.",
      mistakes: "",
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
          quality: parsed.quality ?? 0,
          scope: parsed.scope ?? 0,
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

  // Global memory update: result + mistakes so future spawns avoid repeats.
  const lesson = parsed.mistakes
    ? ` Mistakes to avoid next time: ${parsed.mistakes}`
    : "";
  await memoryRemember(
    userId,
    `Evaluation of "${agent.title}" (${agent.kind}): scored ${score}/100. ${parsed.summary}.${lesson}`,
    { agent_id: agentId, kind: "evaluation" }
  );

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
