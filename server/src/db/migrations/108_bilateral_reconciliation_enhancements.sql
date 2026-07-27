alter table agent_account_reconciliations
  add column if not exists bilateral_reconciliation_id uuid references bilateral_reconciliations(id) on delete set null;

create index if not exists idx_agent_account_reconciliations_bilateral
  on agent_account_reconciliations(bilateral_reconciliation_id);

alter table bilateral_reconciliation_items
  alter column agent_amount drop not null;

alter table bilateral_reconciliations
  add column if not exists period_movement numeric(14, 2) not null default 0,
  add column if not exists force_approve_note text,
  add column if not exists dispute_note text;

create table if not exists generated_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_type text not null,
  reconciliation_id uuid references bilateral_reconciliations(id) on delete set null,
  generated_at timestamptz not null default now(),
  html_content text not null,
  created_by_user_id uuid references users(id) on delete set null,
  metadata jsonb
);

create index if not exists idx_generated_documents_reconciliation
  on generated_documents(reconciliation_id, generated_at desc);

create index if not exists idx_generated_documents_company_type
  on generated_documents(company_id, document_type, generated_at desc);
