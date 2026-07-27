alter table daily_ledger_sessions
  add column if not exists driver_id uuid references drivers(id),
  add column if not exists vehicle_id uuid references vehicles(id);

drop index if exists uq_daily_ledger_sessions_unique;

create unique index if not exists uq_daily_ledger_sessions_unique
  on daily_ledger_sessions (
    company_id,
    branch_id,
    ledger_date,
    line_label,
    coalesce(driver_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where deleted_at is null;

create index if not exists idx_daily_ledger_sessions_driver
  on daily_ledger_sessions(driver_id, ledger_date)
  where deleted_at is null and driver_id is not null;
