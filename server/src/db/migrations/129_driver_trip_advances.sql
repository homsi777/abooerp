-- 129_driver_trip_advances.sql
-- Tracks cash a driver collects directly from an agent during a trip,
-- against his fixed trip_wage_usd (drivers.trip_wage_usd). Each entry also
-- creates a real, confirmed payment_voucher out of that agent's cashbox
-- (see driverAdvancesRoutes.ts), so the agent's real balance reflects the
-- cash they already paid out and is never double-charged later.
--
-- settled_at marks when a trip's advances were "closed out" (driver wage
-- reconciled) — a new trip starts fresh once the previous one is settled.
-- Additive only.

create table if not exists driver_trip_advances (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references drivers(id),
  agent_id           uuid references agents(id),
  amount_usd         numeric(14, 2) not null check (amount_usd >= 0),
  notes              text,
  payment_voucher_id uuid references payment_vouchers(id),
  settled_at         timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now()
);

create index if not exists ix_driver_trip_advances_driver
  on driver_trip_advances (driver_id, settled_at);
