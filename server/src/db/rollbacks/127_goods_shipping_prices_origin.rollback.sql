-- Rollback for 127_goods_shipping_prices_origin.sql — lives outside migrations/ on purpose.
alter table goods_shipping_prices
  drop column if exists origin_normalized,
  drop column if exists origin;
