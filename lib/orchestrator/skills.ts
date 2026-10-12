import type { SupabaseClient } from "@supabase/supabase-js";
import { haikuComplete } from "../ai";

/**
 * Orchestrator step 3: resolve skills for a task.
 * Known skills come from skill_library; anything missing is authored
 * on the spot by Haiku as a custom skill definition.
 */
export async function resolveSkills(
  supabase: SupabaseClient,
  skillsNeeded: string[]
): Promise<{ name: string; definition: string; custom: boolean }[]> {
  const names = [...new Set(skillsNeeded.map((s) => s.trim()).filter(Boolean))];
  if (names.length === 0) names.push("gh-pr-workflow");

  const known = new Map<string, string>();
  try {
    const { data } = await supabase
      .from("skill_library")
      .select("name, definition")
      .in("name", names);
    for (const row of (data ?? []) as { name: string; definition: string }[]) {
      known.set(row.name, row.definition);
    }
  } catch (err) {
    console.warn("skill_library lookup failed:", err);
  }

  const missing = names.filter((n) => !known.has(n));
  const generated = new Map<string, string>();
  for (const name of missing) {
    try {
      const definition = await haikuComplete({
        system: "You write concise, actionable agent skill definitions.",
        messages: [
          {
            role: "user",
            content: `Write a 3-6 sentence skill definition named "${name}" for an autonomous coding sub-agent working on GitHub repos. Concrete conventions and commands only, no fluff.`,
          },
        ],
        maxTokens: 512,
      });
      generated.set(name, definition.trim() || `${name}: follow repo conventions.`);
    } catch {
      generated.set(name, `${name}: follow repo conventions and best practices.`);
    }
  }

  return names.map((name) => ({
    name,
    definition: known.get(name) ?? generated.get(name) ?? name,
    custom: !known.has(name),
  }));
}
