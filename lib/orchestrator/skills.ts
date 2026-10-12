import type { SupabaseClient } from "@supabase/supabase-js";
import { haikuComplete } from "../ai";

export interface ResolvedSkill {
  name: string;
  definition: string;
  custom: boolean;
}

/**
 * Orchestrator skills: reuse first, generate only what's missing, and
 * persist every generated skill into skill_library so the next agent
 * reuses it instead of reinventing it. Skills are optional — a task
 * with no special needs gets an empty list, not a forced default.
 */
export async function resolveSkills(
  supabase: SupabaseClient,
  skillsNeeded: string[]
): Promise<ResolvedSkill[]> {
  const names = [...new Set(skillsNeeded.map((s) => s.trim()).filter(Boolean))];
  if (names.length === 0) return [];

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

  // Persist generated customs for reuse (first definition wins; the
  // evaluator refines them later through the tuning approval flow).
  if (generated.size > 0) {
    try {
      await supabase.from("skill_library").upsert(
        [...generated.entries()].map(([name, definition]) => ({
          name,
          definition,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "name", ignoreDuplicates: true }
      );
    } catch (err) {
      console.warn("skill_library persist failed:", err);
    }
  }

  return names.map((name) => ({
    name,
    definition: known.get(name) ?? generated.get(name) ?? name,
    custom: !known.has(name),
  }));
}
