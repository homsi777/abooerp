create table if not exists daily_ledger_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  ledger_date date not null,
  line_label text not null default '',
  origin_label text not null default '',
  trip_no text,
  vehicle_label text,
  driver_label text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_daily_ledger_sessions_unique
  on daily_ledger_sessions(company_id, branch_id, ledger_date, line_label)
  where deleted_at is null;

create index if not exists idx_daily_ledger_sessions_company
  on daily_ledger_sessions(company_id);

create index if not exists idx_daily_ledger_sessions_branch_date
  on daily_ledger_sessions(branch_id, ledger_date)
  where deleted_at is null;

create table if not exists daily_ledger_rows (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references daily_ledger_sessions(id) on delete cascade,
  row_no integer not null check (row_no > 0),
  receipt_no text,
  destination text not null default '',
  parcel_type text not null default '',
  parcel_count integer,
  weight_kg numeric(12, 2),
  sender_name text not null default '',
  receiver_name text not null default '',
  collect_amount_usd numeric(14, 2) not null default 0,
  prepaid_amount_usd numeric(14, 2) not null default 0,
  hawala_amount_usd numeric(14, 2) not null default 0,
  fees_amount_usd numeric(14, 2) not null default 0,
  notes text,
  posted_shipment_id uuid references shipments(id),
  posted_at timestamptz,
  loaded_manifest_id uuid references manifests(id),
  loaded_at timestamptz,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_daily_ledger_rows_row_no
  on daily_ledger_rows(session_id, row_no)
  where deleted_at is null;

create index if not exists idx_daily_ledger_rows_session
  on daily_ledger_rows(session_id)
  where deleted_at is null;

create index if not exists idx_daily_ledger_rows_posted_shipment
  on daily_ledger_rows(posted_shipment_id)
  where deleted_at is null;

create index if not exists idx_daily_ledger_rows_loaded
  on daily_ledger_rows(loaded_at)
  where deleted_at is null;

