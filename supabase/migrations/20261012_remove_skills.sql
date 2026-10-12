-- Skills → customized prompts. The skill system is retired: every task now
-- gets a detailed customized prompt instead. The evaluator judges from the
-- kind template, the whole customized prompt, the run log, and the output —
-- and applies prompt improvements directly (no tuning approvals).
--
-- This migration:
--   1. drops evaluations.skills_patch,
--   2. narrows approvals.kind checks to live kinds (drops prompt_update/skill_update),
--   3. drops the skill_library table.

alter table public.evaluations
  drop column if exists skills_patch;

-- Retire pending tuning approvals: the evaluator now applies improvements
-- directly, so these rows can never execute. Mark them rejected (history kept).
update public.approvals
  set status = 'rejected'
  where kind in ('prompt_update', 'skill_update') and status = 'pending';

-- Approvals kind checks were declared inline (unnamed) in several migrations;
-- recreate the table-level check by dropping legacy constraints if present.
-- NOTE: Postgres auto-names inline checks; find them via:
--   select conname from pg_constraint where conrelid = 'public.approvals'::regclass;
-- The statements below are safe no-ops when the names don't match.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.approvals'::regclass
      and pg_get_constraintdef(oid) ilike '%prompt_update%'
  loop
    execute format('alter table public.approvals drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.approvals
  add constraint approvals_kind_check
  check (kind in ('run_agent','publish_pr','merge','github_comment'));

drop policy if exists readable on public.skill_library;
drop table if exists public.skill_library;
