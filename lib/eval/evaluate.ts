import type { SupabaseClient } from "@supabase/supabase-js";
import { haikuComplete } from "../ai";
import { memoryRemember } from "../memory";
import { runGates } from "./gates";
import { fetchAgentDiff } from "./rubrics";
import { buildEvaluatorJudgePrompt } from "./evaluator-prompt";
import type { SubAgent, SubAgentKind } from "@/types/orbit-types";

interface EvalJson {
  score: number;
  dims: Record<string, number>;
  summary: string;
  mistakes: string;
  prompt_patch: string;
}

/**
 * Evaluator agent. Judges a sub-agent run from FOUR evidence sources
 * (no skills anywhere in this pipeline):
 *   1. the kind template (base craft from agent_templates),
 *   2. the whole customized prompt the orchestrator gave the sub-agent,
 *   3. the run log,
 *   4. the output (finish summary + result + test evidence + real diff).
 * Scores the work, proposes a prompt-template improvement, and writes
 * lessons-learned into global memory so future runs avoid the same mistakes.
 */
export async function evaluateAgent(
  supabase: SupabaseClient,
  userId: string,
  agentId: string,
  summary: string,
  runLog = "",
  ctx: { testsPassed?: boolean; repo?: string; branch?: string; base?: string; token?: string | null } = {}
): Promise<void> {
  const { data } = await supabase.from("sub_agents").select("*").eq("id", agentId).single();
  const agent = data as SubAgent | null;
  if (!agent) return;
  const kind = agent.kind as SubAgentKind;

  // Evidence 1 + Evidence 4 in parallel (Supabase template vs GitHub diff).
  const testsPassed = ctx.testsPassed === true;
  const templatePromise = supabase
    .from("agent_templates")
    .select("system_prompt")
    .eq("kind", kind)
    .single();
  const diffPromise =
    ctx.token && ctx.repo && ctx.branch && ctx.base
      ? fetchAgentDiff({
          token: ctx.token,
          repo: ctx.repo,
          branch: ctx.branch,
          base: ctx.base,
        }).then(
          (d) => d.diffStat,
          () => ""
        )
      : Promise.resolve("");
  const [tplRes, diffStat] = await Promise.all([templatePromise, diffPromise]);
  let template = "";
  try {
    template = (((tplRes as { data?: unknown }).data as { system_prompt?: string } | null)?.system_prompt ?? "").slice(0, 2000);
  } catch {
    template = "";
  }
  const result = (agent.result ?? {}) as {
    repo?: string;
    branch?: string;
    pr_number?: number;
    pr_url?: string;
    issue_number?: number;
    issue_url?: string;
    merged?: boolean;
  };
  const resultSummary = [
    result.repo ? `repo ${result.repo}` : "",
    result.branch ? `branch ${result.branch}` : "",
    result.pr_number ? `PR #${result.pr_number} ${result.pr_url ?? ""}${result.merged ? " (merged)" : ""}` : "no PR",
    result.issue_number ? `issue #${result.issue_number}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // Stage-1 deterministic gates run BEFORE the LLM judge.
  const gates = runGates({
    summary,
    runLog,
    testsPassed,
    diffStat,
    prOpened: result.pr_number != null,
  });

  const { system, userContent, dimensions } = buildEvaluatorJudgePrompt({
    kind,
    title: agent.title,
    template,
    customizedPrompt: agent.system_prompt,
    runLog,
    output: summary,
    resultSummary: resultSummary || "(no result recorded)",
    testsPassed,
    diffStat,
    gates,
  });

  let parsed: EvalJson;
  try {
    const raw = await haikuComplete({ system, messages: [{ role: "user", content: userContent }], maxTokens: 1536 });
    parsed = JSON.parse(raw) as EvalJson;
  } catch (err) {
    console.warn("evaluator fallback:", err);
    parsed = {
      score: 70,
      dims: Object.fromEntries(dimensions.map((d) => [d, 17])),
      summary: "Automatic scoring unavailable; default score applied.",
      mistakes: "",
      prompt_patch: "",
    };
  }

  // Fatal gate failure caps the score no matter what the judge says.
  let score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  let mistakes = parsed.mistakes ?? "";
  if (!gates.passed) {
    score = Math.min(score, 30);
    const failed = gates.checks
      .filter((c) => !c.passed)
      .map((c) => `${c.name}: ${c.detail}`)
      .join("; ");
    mistakes = [`FATAL GATE FAILURE — ${failed}`, mistakes].filter(Boolean).join(" ");
  }
  const rubric: Record<string, number> = {};
  for (const d of dimensions) {
    const v = Number((parsed.dims ?? {})[d]);
    rubric[d] = Number.isFinite(v) ? Math.max(0, Math.min(25, Math.round(v))) : 0;
  }

  const { data: evaluation, error: evalInsertError } = await supabase
    .from("evaluations")
    .insert([
      {
        sub_agent_id: agentId,
        score,
        rubric,
        summary: parsed.summary ?? "",
        prompt_patch: parsed.prompt_patch || null,
        status: "proposed",
      },
    ])
    .select("id")
    .single();
  if (evalInsertError) {
    console.warn("evaluation insert failed:", evalInsertError.message);
  }
  const evaluationId = (evaluation as { id?: string } | null)?.id;

  const { error: scoreError } = await supabase.from("sub_agents").update({ eval_score: score }).eq("id", agentId);
  if (scoreError) {
    console.warn("eval_score update failed:", scoreError.message);
  }

  // Global memory update: result + mistakes so future runs avoid repeats.
  const lesson = mistakes ? ` Mistakes to avoid next time: ${mistakes}` : "";
  await memoryRemember(
    userId,
    `Evaluation of "${agent.title}" (${kind}): scored ${score}/100. ${parsed.summary ?? ""}.${lesson}`,
    { agent_id: agentId, kind: "evaluation" }
  );

  // The evaluator needs no approval or permission: improvements apply
  // directly, and the tuning is recorded on the evaluation + activity feed.
  const hasPatch = Boolean(parsed.prompt_patch);

  if (hasPatch && evaluationId) {
    await applyPatches(supabase, agent, { prompt_patch: parsed.prompt_patch });
    await supabase.from("evaluations").update({ status: "applied" }).eq("id", evaluationId);
  }
  await supabase.from("activities").insert([
    {
      user_id: userId,
      title: `Evaluation: ${agent.title} scored ${score}`,
      description: hasPatch
        ? `${parsed.summary ?? ""} A prompt improvement was applied directly.`
        : (parsed.summary ?? ""),
      type: "brain",
    },
  ]);
}

export async function applyPatches(
  supabase: SupabaseClient,
  agent: SubAgent,
  patches: { prompt_patch?: string | null }
): Promise<void> {
  try {
    if (patches.prompt_patch) {
      const { data: tpl } = await supabase.from("agent_templates").select("system_prompt").eq("kind", agent.kind).single();
      const current = ((tpl as { system_prompt?: string } | null)?.system_prompt ?? "").slice(0, 4000);
      await supabase
        .from("agent_templates")
        .update({
          system_prompt: `${current}\n\n[Evaluator improvement]\n${patches.prompt_patch}`.slice(0, 8000),
          updated_at: new Date().toISOString(),
        })
        .eq("kind", agent.kind);
    }
  } catch (err) {
    console.warn("applyPatches failed:", err);
  }
}
