create extension if not exists "pgcrypto";

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  module text not null,
  action text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  city text,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  governorate text,
  phone text,
  branch_id uuid references branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  full_name text not null,
  email text unique,
  phone text unique,
  password_hash text not null,
  role_id uuid not null references roles(id),
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  status text not null default 'active' check (status in ('active', 'inactive', 'locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phone text,
  city text,
  address text,
  branch_id uuid references branches(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists senders_receivers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  phone text,
  city text,
  address text,
  type text not null check (type in ('sender', 'receiver', 'both')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  phone text,
  license_number text,
  branch_id uuid references branches(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plate_number text not null unique,
  model text,
  capacity_kg numeric(12, 2),
  branch_id uuid references branches(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists currencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('USD', 'SYP', 'TRY')),
  name text not null,
  symbol text not null,
  decimal_places integer not null default 2 check (decimal_places between 0 and 6),
  is_base boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null references currencies(code),
  quote_currency text not null references currencies(code),
  rate numeric(18, 8) not null check (rate > 0),
  source text,
  effective_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (base_currency, quote_currency, effective_at)
);

create table if not exists system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value_json jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text not null unique,
  reference_no text,
  customer_id uuid references customers(id),
  sender_id uuid not null references senders_receivers(id),
  receiver_id uuid not null references senders_receivers(id),
  branch_id uuid not null references branches(id),
  agent_id uuid references agents(id),
  origin_city text,
  destination_city text not null,
  description text,
  pieces_count integer not null default 1 check (pieces_count > 0),
  weight_kg numeric(12, 2),
  status text not null default 'created' check (
    status in ('created', 'in_transit', 'manifested', 'delivered', 'cancelled')
  ),
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipment_status_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  status text not null check (
    status in ('created', 'in_transit', 'manifested', 'delivered', 'cancelled')
  ),
  note text,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create table if not exists manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_no text not null unique,
  branch_id uuid not null references branches(id),
  vehicle_id uuid references vehicles(id),
  driver_id uuid references drivers(id),
  status text not null default 'created' check (status in ('created', 'dispatched', 'closed', 'cancelled')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manifest_shipments (
  manifest_id uuid not null references manifests(id) on delete cascade,
  shipment_id uuid not null references shipments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (manifest_id, shipment_id)
);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_no text not null unique,
  shipment_id uuid not null unique references shipments(id) on delete cascade,
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  operator_user_id uuid references users(id),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'returned')),
  recipient_name text,
  received_at timestamptz,
  notes text,
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shipments_branch on shipments(branch_id);
create index if not exists idx_shipments_agent on shipments(agent_id);
create index if not exists idx_shipments_status on shipments(status);
create index if not exists idx_manifests_branch on manifests(branch_id);
create index if not exists idx_deliveries_branch on deliveries(branch_id);
create index if not exists idx_deliveries_status on deliveries(status);
