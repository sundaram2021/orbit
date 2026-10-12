import { Octokit } from "@octokit/rest";
import type { SubAgentKind } from "@/types/orbit-types";

/** Per-kind rubrics: implementation vs review vs testing are judged differently. */
export const EVAL_RUBRICS: Record<SubAgentKind, { dimensions: string[]; guidance: string }> = {
  implementation: {
    dimensions: ["correctness", "tests", "scope", "pr_quality"],
    guidance:
      "Judge implementation work on: does the change solve the task (correctness), did tests run green (tests), is the change minimal without scope creep (scope), and would the PR be mergeable (pr_quality).",
  },
  review: {
    dimensions: ["thoroughness", "actionability", "accuracy", "tone"],
    guidance:
      "Judge review work on: coverage of the diff incl. edge cases (thoroughness), specific file/line suggestions vs vagueness (actionability), no false positives (accuracy), constructive tone (tone).",
  },
  testing: {
    dimensions: ["coverage", "quality", "scope", "report"],
    guidance:
      "Judge testing work on: meaningful coverage of the change (coverage), assertions test behavior not tautologies (quality), no unrelated churn (scope), clear pass/fail report (report).",
  },
  custom: {
    dimensions: ["correctness", "tests", "scope", "pr_quality"],
    guidance:
      "Judge general task work on: did it achieve the stated goal (correctness), is there evidence it works (tests), minimal footprint (scope), clear handoff (pr_quality).",
  },
};

export function rubricFor(kind: string): { dimensions: string[]; guidance: string } {
  const k = kind as SubAgentKind;
  return EVAL_RUBRICS[k] ?? EVAL_RUBRICS.custom;
}

/** Fetch the real diff of the agent's branch for the judge (never judge blind). */
export async function fetchAgentDiff(opts: {
  token: string;
  repo: string;
  branch: string;
  base: string;
}): Promise<{ diffStat: string; diff: string }> {
  const [o, r] = opts.repo.split("/");
  const octokit = new Octokit({ auth: opts.token });
  try {
    const cmp = await octokit.repos.compareCommits({
      owner: o,
      repo: r,
      base: opts.base,
      head: opts.branch,
    });
    const files = cmp.data.files ?? [];
    const stat = `${files.length} files changed, +${files.reduce((s, f) => s + (f.additions ?? 0), 0)}/-${files.reduce((s, f) => s + (f.deletions ?? 0), 0)}: ${files.map((f) => f.filename).join(", ").slice(0, 500)}`;
    const patches = files
      .slice(0, 10)
      .map((f) => `--- ${f.filename}\n${(f.patch ?? "").slice(0, 1500)}`)
      .join("\n");
    return { diffStat: stat, diff: patches.slice(0, 8000) };
  } catch (err) {
    return { diffStat: "", diff: `(diff unavailable: ${(err as Error).message.slice(0, 200)})` };
  }
}
