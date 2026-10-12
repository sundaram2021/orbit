-- Allow close_issue / close_pr approval kinds (destructive GitHub actions stay gated).
alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals
  add constraint approvals_kind_check
  check (kind in ('run_agent','publish_pr','merge','prompt_update','skill_update','github_comment','close_issue','close_pr'));

-- Persist orchestrator behind-the-scenes steps so chat history keeps the timeline.
alter table public.chat_messages
  add column if not exists steps jsonb not null default '[]'::jsonb;
