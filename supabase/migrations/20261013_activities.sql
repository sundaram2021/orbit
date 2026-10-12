-- Orbit activities feed: powers the notifications bell, toasts, and Activity view.
-- Missing table was the root cause of "no notifications on GitHub events".
-- Idempotent — safe to run multiple times.

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  type text not null default 'event'
    check (type in ('pr','sparkles','brain','issue','event')),
  created_at timestamptz not null default now()
);
create index if not exists activities_user_created_idx
  on public.activities (user_id, created_at desc);

alter table public.activities enable row level security;
drop policy if exists owner_all on public.activities;
create policy owner_all on public.activities for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
