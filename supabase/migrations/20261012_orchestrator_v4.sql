-- Orbit orchestrator v4: allow github_comment approvals.
-- Run this in Supabase SQL editor (or hand to the Supabase agent).

alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals
  add constraint approvals_kind_check
  check (kind in ('run_agent','publish_pr','merge','prompt_update','skill_update','github_comment'));
