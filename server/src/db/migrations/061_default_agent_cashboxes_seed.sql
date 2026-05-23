-- Migration 061: Default agent and branch cashboxes for Syrian seed destinations
--
-- IMPORTANT: This migration only creates a schema-level marker.
-- The actual cashbox seed records are inserted in server/src/db/seed.ts
-- (sections 9d and 9e) because seed.ts TRUNCATE ... CASCADE on first-run
-- wipes cashboxes before migration-inserted rows can survive.
--
-- seed.ts sections added:
--   9d. SYRIAN DEFAULT AGENT CASHBOXES  — CASH-AG-{DEST}-USD per agent
--   9e. SYRIAN DEFAULT BRANCH CASHBOXES — CASH-BR-{DEST}-USD per branch
--
-- Cashbox constraints (from migration 055):
--   unique (company_id, code)
--   check: AGENT type  → agent_id is not null
--   check: BRANCH type → branch_id is not null, agent_id is null
--   check: COMPANY type → both null
--
-- No schema changes needed in this migration — only seed data concern.

do $$
begin
  raise notice 'Migration 061: Syrian default cashboxes — actual data in seed.ts sections 9d/9e';
end $$;
