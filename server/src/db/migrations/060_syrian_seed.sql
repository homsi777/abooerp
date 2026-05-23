-- Migration 060: Seed Syrian governorates/destinations, default branches, and default agents
-- Idempotent — safe to run multiple times. Uses ON CONFLICT DO NOTHING throughout.
-- "القامشلي" is treated as an independent operational destination (not grouped under الحسكة).

-- ============================================================
-- STEP 1: Seed Syrian cities/destinations
-- ============================================================
insert into cities (code, name, region, has_branch, is_active)
values
  ('DAMASCUS',   'دمشق',       'جنوب سوريا', true, true),
  ('RIF_DIMASHQ','ريف دمشق',   'جنوب سوريا', true, true),
  ('ALEPPO',     'حلب',        'شمال سوريا', true, true),
  ('HOMS',       'حمص',        'وسط سوريا',  true, true),
  ('HAMA',       'حماة',       'وسط سوريا',  true, true),
  ('LATAKIA',    'اللاذقية',   'الساحل',     true, true),
  ('TARTUS',     'طرطوس',      'الساحل',     true, true),
  ('IDLIB',      'إدلب',       'شمال سوريا', true, true),
  ('RAQQA',      'الرقة',      'شمال شرق',   true, true),
  ('DEIR_EZZOR', 'دير الزور',  'شمال شرق',   true, true),
  ('HASAKAH',    'الحسكة',     'شمال شرق',   true, true),
  ('QAMISHLI',   'القامشلي',   'شمال شرق',   true, true),
  ('DARAA',      'درعا',       'جنوب سوريا', true, true),
  ('SUWAYDA',    'السويداء',   'جنوب سوريا', true, true),
  ('QUNEITRA',   'القنيطرة',   'جنوب سوريا', true, true)
on conflict (code) do update set
  name       = excluded.name,
  region     = excluded.region,
  has_branch = excluded.has_branch,
  is_active  = excluded.is_active;

-- NOTE: Default branches and agents (BR-* and AGT-*) for Syrian destinations
-- are seeded in server/src/db/seed.ts (sections 9b and 9c) because the seed
-- truncates branches/agents on first-run, which would wipe migration-inserted rows.
-- The cities above (STEP 1) are safe in this migration since cities are NOT truncated.

-- ============================================================
-- STEP 2 (legacy placeholder — actual seeding is in seed.ts)
-- ============================================================

-- ============================================================
-- STEP 3 (legacy placeholder — actual seeding is in seed.ts)
-- ============================================================

-- ============================================================
-- STEP 4: Report summary (visible in migration log)
-- ============================================================
do $$
declare
  v_city_count   int;
  v_branch_count int;
  v_agent_count  int;
begin
  select count(*) into v_city_count   from cities  where code in ('DAMASCUS','RIF_DIMASHQ','ALEPPO','HOMS','HAMA','LATAKIA','TARTUS','IDLIB','RAQQA','DEIR_EZZOR','HASAKAH','QAMISHLI','DARAA','SUWAYDA','QUNEITRA');
  select count(*) into v_branch_count from branches where code like 'BR-%';
  select count(*) into v_agent_count  from agents  where code like 'AGT-%';
  raise notice 'Syrian seed: % cities, % branches (BR-*), % agents (AGT-*)', v_city_count, v_branch_count, v_agent_count;
end $$;
