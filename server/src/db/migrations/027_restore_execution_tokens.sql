create table if not exists restore_execution_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  backup_id uuid not null references backup_records(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_restore_tokens_company_backup on restore_execution_tokens(company_id, backup_id, expires_at);
