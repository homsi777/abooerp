-- تعريف إرساليات اليوم (نظام جديد — يعمل بجانب daily_ledger_sessions)
create table if not exists daily_ledger_dispatch_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  ledger_date date not null,
  line_label text not null default '',
  dispatch_no integer not null check (dispatch_no > 0),
  driver_id uuid references drivers(id),
  vehicle_id uuid references vehicles(id),
  driver_label text,
  vehicle_label text,
  trip_no text,
  notes text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_daily_ledger_dispatch_no
  on daily_ledger_dispatch_definitions(company_id, branch_id, ledger_date, line_label, dispatch_no)
  where deleted_at is null;

create index if not exists idx_daily_ledger_dispatch_scope
  on daily_ledger_dispatch_definitions(branch_id, ledger_date, line_label)
  where deleted_at is null;

alter table daily_ledger_rows
  add column if not exists dispatch_id uuid references daily_ledger_dispatch_definitions(id) on delete set null;

create index if not exists idx_daily_ledger_rows_dispatch
  on daily_ledger_rows(dispatch_id)
  where deleted_at is null and dispatch_id is not null;
