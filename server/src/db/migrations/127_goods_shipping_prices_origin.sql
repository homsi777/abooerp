-- 127_goods_shipping_prices_origin.sql
-- Price depends on the full route (origin -> destination), not destination
-- alone. Additive: new nullable columns, no backfill of existing rows.

alter table goods_shipping_prices
  add column if not exists origin             text,
  add column if not exists origin_normalized  text;
