-- 126_goods_shipping_prices.sql
-- Flat shipping-price reference list: one row per recorded price scenario
-- (goods name + destination + weight/parcel-count reference + price +
-- optional customer name). Replaces the earlier "pricing groups" design,
-- which the owner rejected as overcomplicated. Additive only.

create table if not exists goods_shipping_prices (
  id                    uuid primary key default gen_random_uuid(),
  goods_name            text not null,
  goods_name_normalized text not null,
  destination           text not null,
  destination_normalized text not null,
  weight_kg             numeric(12, 2),
  parcel_count          integer,
  unit_price_usd        numeric(14, 2) not null check (unit_price_usd >= 0),
  customer_name         text,
  created_by            uuid references users(id),
  created_at            timestamptz not null default now()
);

create index if not exists ix_goods_shipping_prices_lookup
  on goods_shipping_prices (goods_name_normalized, destination_normalized);

create index if not exists ix_goods_shipping_prices_created_at
  on goods_shipping_prices (created_at desc);
