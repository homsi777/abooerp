create table if not exists dashboard_cache_metrics_state (
  id boolean primary key default true check (id = true),
  ttl_ms integer not null,
  reset_enabled boolean not null default true,
  reset_require_confirm boolean not null default false,
  cache_entries integer not null default 0,
  in_flight_entries integer not null default 0,
  hits bigint not null default 0,
  misses bigint not null default 0,
  in_flight_hits bigint not null default 0,
  sets bigint not null default 0,
  invalidations bigint not null default 0,
  evictions bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists dashboard_cache_reset_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid,
  branch_id uuid,
  agent_id uuid,
  reset_cache boolean not null,
  reset_metrics boolean not null,
  confirm boolean not null,
  outcome text not null check (outcome in ('success', 'blocked')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dashboard_cache_reset_audit_created_at
  on dashboard_cache_reset_audit(created_at desc);
