create table if not exists agent_account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  reconciled_at timestamptz not null default now(),
  balance_amount numeric(14, 2) not null default 0,
  currency_code text not null default 'USD',
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_account_reconciliations_agent_date
  on agent_account_reconciliations(company_id, agent_id, reconciled_at desc);
