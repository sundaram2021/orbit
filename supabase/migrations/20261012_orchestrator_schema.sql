-- Orbit orchestrator schema: GitHub connections, events, sub-agents,
-- chat threads/messages, approvals, evaluations, settings, templates, skills.
-- Run this in Supabase SQL editor (or hand to the Supabase agent).

-- 1) GitHub OAuth token per user (server-side actions on user's behalf)
create table if not exists public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider_token text not null,
  github_username text,
  scopes text not null default 'repo workflow read:org user:email',
  updated_at timestamptz not null default now()
);

-- 2) Polled GitHub events (deduped intake queue)
create table if not exists public.github_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_id text not null,
  type text not null,
  repo text not null default '',
  number int,
  title text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received','proposed','running','done','ignored')),
  created_at timestamptz not null default now(),
  unique (user_id, delivery_id)
);
create index if not exists github_events_user_status_idx
  on public.github_events (user_id, status, created_at desc);

-- 3) Sub-agents spawned by the orchestrator
create table if not exists public.sub_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.github_events(id) on delete set null,
  kind text not null default 'custom'
    check (kind in ('implementation','review','testing','custom')),
  title text not null default '',
  system_prompt text not null default '',
  skills text[] not null default '{}',
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval','running','completed','failed')),
  sandbox_id text,
  trace_id text,
  eval_score numeric,
  created_at timestamptz not null default now()
);
create index if not exists sub_agents_user_status_idx
  on public.sub_agents (user_id, status, created_at desc);

-- Link manual tasks to runs (nullable; tasks table already exists)
alter table public.tasks
  add column if not exists sub_agent_id uuid references public.sub_agents(id) on delete set null;

-- 4) Chat threads (exactly two per user: orchestrator + evaluator)
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('orchestrator','evaluator')),
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at asc);

-- 5) Approval gates (agent runs, publishing, tuning)
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('run_agent','publish_pr','merge','prompt_update','skill_update')),
  ref_id text not null default '',
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists approvals_user_status_idx
  on public.approvals (user_id, status, created_at desc);

-- 6) Evaluator output per sub-agent
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  sub_agent_id uuid not null references public.sub_agents(id) on delete cascade,
  score numeric not null default 0,
  rubric jsonb not null default '{}'::jsonb,
  summary text not null default '',
  prompt_patch text,
  skills_patch text[],
  status text not null default 'proposed'
    check (status in ('proposed','applied','dismissed')),
  created_at timestamptz not null default now()
);

-- 7) Per-user automation settings (both OFF by default)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  orchestrator_auto_approve boolean not null default false,
  evaluator_auto_apply boolean not null default false
);

-- 8) Prompt templates + skill library (rewritten by evaluator over time)
create table if not exists public.agent_templates (
  kind text primary key
    check (kind in ('implementation','review','testing','custom','orchestrator','evaluator')),
  system_prompt text not null default '',
  skills text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.skill_library (
  name text primary key,
  definition text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.agent_templates (kind, system_prompt, skills) values
  ('implementation', 'You are an implementation sub-agent in the Orbit factory. Fix the assigned GitHub issue with minimal, tested changes.', array['gh-pr-workflow']),
  ('review', 'You are a code-review sub-agent in the Orbit factory. Review the assigned pull request thoroughly and leave actionable feedback.', array['gh-pr-workflow']),
  ('testing', 'You are a testing sub-agent in the Orbit factory. Add or fix tests covering the assigned change and report results.', array['gh-pr-workflow']),
  ('custom', 'You are a general sub-agent in the Orbit factory. Complete the assigned GitHub task carefully.', array['gh-pr-workflow']),
  ('orchestrator', 'You are Orbit, the user''s GitHub orchestrator. You spawn specialized sub-agents for GitHub work and keep the user informed.', array[]::text[]),
  ('evaluator', 'You are Orbit''s evaluator agent. You score sub-agent work fairly and propose prompt/skill improvements.', array[]::text[])
on conflict (kind) do nothing;

insert into public.skill_library (name, definition) values
  ('gh-pr-workflow', 'Open pull requests against the repo default branch with a clear title, summary, and test plan. Never push directly to the default branch.'),
  ('nextjs-16', 'Next.js 16 App Router conventions: async Server Components, Route Handlers under app/api, middleware.ts at root.'),
  ('supabase-rls', 'Always scope queries by auth.uid() = user_id and keep Row Level Security policies in every migration.')
on conflict (name) do nothing;

-- 9) Row Level Security: users see only their own rows
alter table public.github_connections enable row level security;
alter table public.github_events enable row level security;
alter table public.sub_agents enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.approvals enable row level security;
alter table public.evaluations enable row level security;
alter table public.user_settings enable row level security;
alter table public.agent_templates enable row level security;
alter table public.skill_library enable row level security;

-- Helper: owner-only policy per table
do $$
declare t text;
begin
  foreach t in array array[
    'github_connections','github_events','sub_agents','chat_threads',
    'approvals','user_settings'
  ] loop
    execute format(
      'drop policy if exists owner_all on public.%I; create policy owner_all on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t);
  end loop;
end $$;

-- chat_messages: access via owning thread
drop policy if exists via_thread on public.chat_messages;
create policy via_thread on public.chat_messages for all
  using (exists (
    select 1 from public.chat_threads th
    where th.id = chat_messages.thread_id and th.user_id = auth.uid()))
  with check (exists (
    select 1 from public.chat_threads th
    where th.id = chat_messages.thread_id and th.user_id = auth.uid()));

-- evaluations: access via owning sub-agent
drop policy if exists via_agent on public.evaluations;
create policy via_agent on public.evaluations for all
  using (exists (
    select 1 from public.sub_agents sa
    where sa.id = evaluations.sub_agent_id and sa.user_id = auth.uid()))
  with check (exists (
    select 1 from public.sub_agents sa
    where sa.id = evaluations.sub_agent_id and sa.user_id = auth.uid()));

-- templates + skills readable by all authed users, writable by service role only
drop policy if exists readable on public.agent_templates;
create policy readable on public.agent_templates for select
  using (auth.role() = 'authenticated');
drop policy if exists readable on public.skill_library;
create policy readable on public.skill_library for select
  using (auth.role() = 'authenticated');
