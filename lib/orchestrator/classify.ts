import { haikuComplete } from "../ai";
import type { SubAgentKind } from "@/types/orbit-types";

export interface Classification {
  kind: SubAgentKind;
  title: string;
  repo: string;
  risk: "low" | "medium" | "high";
  plan: string;
}

/**
 * Orchestrator step 1: turn a GitHub event (or user message) into a
 * structured work order for a sub-agent.
 */
export async function classifyWork(input: {
  source: string;
  repo: string;
  number?: number | null;
  title?: string | null;
  body?: string | null;
}): Promise<Classification> {
  const prompt = `You are the classifier for Orbit, a GitHub orchestration system.
Given a GitHub event or user request, output ONLY valid JSON (no markdown fences) with keys:
kind ("implementation" | "review" | "testing" | "custom"), title (short task title),
repo (owner/name),
risk ("low" | "medium" | "high"), plan (2-4 sentence execution plan).

Event source: ${input.source}
Repo: ${input.repo}
Number: ${input.number ?? "n/a"}
Title: ${input.title ?? "n/a"}
Body:
${(input.body ?? "").slice(0, 4000)}`;

  try {
    const raw = await haikuComplete({
      system: "You output only valid JSON.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1024,
    });
    const parsed = JSON.parse(raw) as Partial<Classification>;
    const defaultKind: SubAgentKind =
      input.source.includes("review") || input.source.includes("pr")
        ? "review"
        : input.source.includes("issue")
          ? "implementation"
          : "custom";

    const kind: SubAgentKind =
      parsed.kind === "implementation" ||
      parsed.kind === "review" ||
      parsed.kind === "testing"
        ? parsed.kind
        : defaultKind;
    return {
      kind,
      title: parsed.title || input.title || `${input.source} in ${input.repo}`,
      repo: input.repo,
      risk: parsed.risk === "high" || parsed.risk === "medium" ? parsed.risk : "low",
      plan:
        parsed.plan ||
        (kind === "review"
          ? "Inspect PR changes, check edge cases and conventions, and submit code review."
          : "Investigate, implement, test, open PR."),
    };
  } catch (err) {
    console.warn("Classifier fallback:", err);
    const kind: SubAgentKind = input.source.includes("review") ? "review" : "implementation";
    return {
      kind,
      title: input.title || `${input.source} in ${input.repo}`,
      repo: input.repo,
      risk: "low",
      plan:
        kind === "review"
          ? "Inspect PR changes, check edge cases and conventions, and submit code review."
          : "Investigate, implement, test, open PR.",
    };
  }
}
