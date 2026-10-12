-- ============================================================
-- ORBIT FINAL MIGRATION — run this ONE file via Supabase MCP.
-- It consolidates everything after the base schema (v1):
--   v2: run_log + skill_definitions on sub_agents
--   v3: steering on sub_agents (mid-run orchestrator steering)
--   v4: github_comment approval kind
--   v5: result JSONB on sub_agents (PR/branch/issue links for the UI)
--   settings: ensure user_settings table + owner policy
-- Every statement is idempotent — safe to run even if some parts
-- were applied before.
-- ============================================================

-- v2: execution log + skill snapshot per agent
alter table public.sub_agents
  add column if not exists run_log text not null default '';
alter table public.sub_agents
  add column if not exists skill_definitions jsonb not null default '[]'::jsonb;

-- v3: mid-run steering inbox per agent
alter table public.sub_agents
  add column if not exists steering text not null default '';

-- v5: machine-readable outcome per agent (used by Agents page cards)
-- {pr_number, pr_url, branch, issue_number, issue_url}
alter table public.sub_agents
  add column if not exists result jsonb not null default '{}'::jsonb;

-- v4: allow github_comment approvals
alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals
  add constraint approvals_kind_check
  check (kind in ('run_agent','publish_pr','merge','prompt_update','skill_update','github_comment'));

-- settings: ensure table + owner-only policy
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  orchestrator_auto_approve boolean not null default false,
  evaluator_auto_apply boolean not null default false
);
alter table public.user_settings enable row level security;
drop policy if exists owner_all on public.user_settings;
create policy owner_all on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
