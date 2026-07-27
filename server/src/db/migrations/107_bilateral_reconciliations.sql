create table if not exists bilateral_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  period_from timestamptz not null,
  period_to timestamptz not null,
  currency_code text not null default 'USD',
  status text not null default 'draft',
  previous_balance numeric(14, 2) not null default 0,
  current_balance numeric(14, 2) not null default 0,
  notes text,
  agent_notes text,
  approved_at timestamptz,
  approved_by_user_id uuid references users(id) on delete set null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bilateral_reconciliations_status_check
    check (status in ('draft', 'pending', 'approved', 'disputed'))
);

create index if not exists idx_bilateral_reconciliations_agent
  on bilateral_reconciliations(company_id, agent_id, period_to desc);

create table if not exists bilateral_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references bilateral_reconciliations(id) on delete cascade,
  item_type text not null,
  description text not null,
  company_amount numeric(14, 2) not null default 0,
  agent_amount numeric(14, 2) not null default 0,
  difference numeric(14, 2) not null default 0,
  status text not null default 'unmatched',
  notes text,
  sort_order int not null default 0,
  constraint bilateral_reconciliation_items_status_check
    check (status in ('matched', 'unmatched', 'disputed'))
);

create index if not exists idx_bilateral_reconciliation_items_parent
  on bilateral_reconciliation_items(reconciliation_id, sort_order);
