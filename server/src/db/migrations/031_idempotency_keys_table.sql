create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  route_key text not null,
  idempotency_key text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_idempotency_created_at on idempotency_keys(created_at);
create unique index if not exists uq_idempotency_scope_key
  on idempotency_keys(
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    route_key,
    idempotency_key
  );
