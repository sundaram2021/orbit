-- Orbit settings hardening: ensure table + owner policy exist.
-- Run this in Supabase SQL editor (or hand to the Supabase agent).
-- Idempotent; safe to run even if the v1 migration was applied.

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
