-- Approval execution state machine: pending → executing → approved/failed.
-- Allows the UI to distinguish "approved, running the side effect" from
-- terminal states, and to surface execution failures with a retry path.
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals
  add constraint approvals_status_check
  check (status in ('pending','approved','rejected','executing','failed'));
