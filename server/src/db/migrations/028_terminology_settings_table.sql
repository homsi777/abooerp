create table if not exists terminology_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies(id),
  terms jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
