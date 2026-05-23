create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  region text,
  has_branch boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists goods_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tariffs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  from_city_id uuid not null references cities(id),
  to_city_id uuid not null references cities(id),
  goods_type_id uuid not null references goods_types(id),
  price_per_kg numeric(14, 2) not null default 0,
  minimum_charge numeric(14, 2) not null default 0,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tariffs_from_city on tariffs(from_city_id);
create index if not exists idx_tariffs_to_city on tariffs(to_city_id);
create index if not exists idx_tariffs_goods_type on tariffs(goods_type_id);
