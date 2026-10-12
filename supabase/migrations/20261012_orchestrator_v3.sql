-- Orbit orchestrator v3: mid-run steering for sub-agents.
-- Run this in Supabase SQL editor (or hand to the Supabase agent).

alter table public.sub_agents
  add column if not exists steering text not null default '';
