-- Central, auditable maintenance-run history.  This migration changes no
-- business or sync data; retention execution is explicit and dry-run by default.
create table if not exists maintenance_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  dry_run boolean not null,
  status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  policy jsonb not null,
  result jsonb,
  error_message text
);

create index if not exists idx_maintenance_cleanup_runs_started_at
  on maintenance_cleanup_runs(started_at desc);
