-- 125_goods_pricing.rollback.sql
-- Rollback for 125_goods_pricing.sql. Lives OUTSIDE server/src/db/migrations/
-- on purpose: the migration runner executes every *.sql file in that folder
-- automatically, and this file must never run as part of a normal migrate.
-- Drops ONLY the objects created by 125_goods_pricing.sql. Run manually,
-- against a target the owner has explicitly approved, after a pg_dump backup.

alter table daily_ledger_rows
  drop column if exists suggested_unit_price_usd,
  drop column if exists price_source,
  drop column if exists line_total_usd,
  drop column if exists unit_price_usd,
  drop column if exists pricing_unit,
  drop column if exists pricing_party_id,
  drop column if exists pricing_group_id;

drop table if exists goods_price_history;
drop table if exists party_goods_prices;
drop table if exists goods_group_prices;
drop table if exists goods_pricing_group_members;
drop table if exists goods_pricing_groups;
