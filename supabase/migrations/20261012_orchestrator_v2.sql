-- Orbit orchestrator v2: run logs + skill definitions on sub-agents.
-- Run this in Supabase SQL editor (or hand to the Supabase agent).
-- Safe to run multiple times (all statements are idempotent).

-- Full step-by-step execution log per agent (fed to the evaluator).
alter table public.sub_agents
  add column if not exists run_log text not null default '';

-- Resolved skill definitions snapshot ({name, definition, custom}[]).
-- Lets the evaluator see exactly what guidance the agent had.
alter table public.sub_agents
  add column if not exists skill_definitions jsonb not null default '[]'::jsonb;
