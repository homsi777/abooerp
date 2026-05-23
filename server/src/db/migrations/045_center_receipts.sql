create table if not exists center_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  shipment_id uuid not null references shipments(id) on delete cascade,
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  center_name text not null,
  status text not null default 'received' check (status in ('received', 'cancelled')),
  received_by_user_id uuid references users(id),
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ux_center_receipts_active_shipment
  on center_receipts(shipment_id)
  where deleted_at is null;

create index if not exists idx_center_receipts_company_center
  on center_receipts(company_id, center_name)
  where deleted_at is null;

create index if not exists idx_center_receipts_branch
  on center_receipts(branch_id)
  where deleted_at is null;
