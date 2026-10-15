-- 125_goods_pricing.sql
-- Goods pricing (Finance) + instant pricing in the Daily Shipment Ledger.
-- ADDITIVE ONLY: new tables + new NULLABLE columns on daily_ledger_rows.
-- Never drops/renames/retypes anything existing. No backfill.

-- A curated pricing group ("ألبسة", "قطع تبديل"...), distinct from the raw
-- free-text goods_types rows (which are one-per-ever-typed-string, not a
-- real taxonomy — see Phase 0/1 findings).
create table if not exists goods_pricing_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  name_normalized text not null,
  is_active       boolean not null default true,
  notes           text,
  created_by      uuid references users(id),
  updated_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists ux_goods_pricing_groups_name
  on goods_pricing_groups (name_normalized) where is_active;

-- Maps one raw goods_types variant to exactly one pricing group.
create table if not exists goods_pricing_group_members (
  goods_type_id   uuid primary key references goods_types(id),
  group_id        uuid not null references goods_pricing_groups(id),
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);

create index if not exists ix_goods_pricing_group_members_group
  on goods_pricing_group_members (group_id);

-- General (default) price per group.
create table if not exists goods_group_prices (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references goods_pricing_groups(id),
  pricing_unit    varchar(6) not null default 'parcel' check (pricing_unit in ('parcel', 'kg')),
  unit_price_usd  numeric(14, 2) not null check (unit_price_usd >= 0),
  is_active       boolean not null default true,
  notes           text,
  created_by      uuid references users(id),
  updated_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists ux_goods_group_prices_active
  on goods_group_prices (group_id) where is_active;

-- VIP price for a specific party (senders_receivers.id) + group.
create table if not exists party_goods_prices (
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid not null references senders_receivers(id),
  group_id        uuid not null references goods_pricing_groups(id),
  pricing_unit    varchar(6) not null default 'parcel' check (pricing_unit in ('parcel', 'kg')),
  unit_price_usd  numeric(14, 2) not null check (unit_price_usd >= 0),
  is_active       boolean not null default true,
  notes           text,
  created_by      uuid references users(id),
  updated_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists ux_party_goods_prices_active
  on party_goods_prices (party_id, group_id) where is_active;
create index if not exists ix_party_goods_prices_party
  on party_goods_prices (party_id);

-- Audit trail of every price change (general and VIP).
create table if not exists goods_price_history (
  id                  bigserial primary key,
  scope               varchar(7) not null check (scope in ('general', 'party')),
  group_id            uuid not null,
  party_id            uuid,
  old_unit_price_usd  numeric(14, 2),
  new_unit_price_usd  numeric(14, 2),
  old_pricing_unit    varchar(6),
  new_pricing_unit    varchar(6),
  action              varchar(10) not null check (action in ('create', 'update', 'deactivate')),
  changed_by          uuid references users(id),
  changed_at          timestamptz not null default now()
);

create index if not exists ix_goods_price_history_changed_at
  on goods_price_history (changed_at desc);

-- New NULLABLE columns on the ledger. Old rows stay NULL — no backfill,
-- no NOT NULL, no default that would imply a value for existing rows.
alter table daily_ledger_rows
  add column if not exists pricing_group_id         uuid references goods_pricing_groups(id),
  add column if not exists pricing_party_id         uuid references senders_receivers(id),
  add column if not exists pricing_unit             varchar(6) check (pricing_unit in ('parcel', 'kg')),
  add column if not exists unit_price_usd            numeric(14, 2) check (unit_price_usd >= 0),
  add column if not exists line_total_usd            numeric(14, 2),
  add column if not exists price_source              varchar(7) check (price_source in ('party', 'general', 'manual')),
  add column if not exists suggested_unit_price_usd  numeric(14, 2);
