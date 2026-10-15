-- 128_driver_trip_wage.sql
-- Fixed per-trip wage for a driver (e.g. 800 USD), used to track cash
-- advances the driver collects directly from agents along his route
-- against this amount. Additive only.

alter table drivers
  add column if not exists trip_wage_usd numeric(14, 2);
