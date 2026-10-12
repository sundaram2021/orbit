-- ============================================================
-- ORBIT FINAL MIGRATION (ALL) — run this ONE file via Supabase MCP.
-- Fully idempotent — safe even if earlier files were applied.
--
-- Includes:
--   base additions: run_log, skill_definitions, steering, result (JSONB)
--     on sub_agents; github_comment approval kind; user_settings table
--   chat history: title + updated_at on chat_threads, multiple threads
--     per user (drops the one-thread-per-kind constraint)
-- ============================================================

-- sub_agents additions
alter table public.sub_agents
  add column if not exists run_log text not null default '';
alter table public.sub_agents
  add column if not exists skill_definitions jsonb not null default '[]'::jsonb;
alter table public.sub_agents
  add column if not exists steering text not null default '';
alter table public.sub_agents
  add column if not exists result jsonb not null default '{}'::jsonb;

-- approvals: allow github_comment
alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals
  add constraint approvals_kind_check
  check (kind in ('run_agent','publish_pr','merge','prompt_update','skill_update','github_comment'));

-- user_settings: ensure table + owner policy
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

-- chat history: titles + multiple threads per user+kind
alter table public.chat_threads
  add column if not exists title text not null default 'New conversation';
alter table public.chat_threads
  add column if not exists updated_at timestamptz not null default now();
alter table public.chat_threads
  drop constraint if exists chat_threads_user_id_kind_key;
