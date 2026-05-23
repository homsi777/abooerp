create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phone text,
  branch_id uuid references branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agents
  add column if not exists phone text;

alter table agents
  add column if not exists is_active boolean not null default true;

alter table agents
  add column if not exists created_at timestamptz not null default now();

alter table agents
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_agents_branch on agents(branch_id);
