-- Phase S.1 Part 1: Add company_id isolation to shipping core tables
-- Phase S.1 Part 5: Add soft-delete to shipping core tables
-- Both applied in a single migration to minimize ALTER TABLE passes.

-- ─── shipments ────────────────────────────────────────────────────────────────

alter table shipments
  add column if not exists company_id uuid references companies(id),
  add column if not exists deleted_at timestamptz;

-- Backfill: assign the earliest active company to all unowned rows
update shipments
set company_id = (
  select id from companies where is_active = true order by created_at asc limit 1
)
where company_id is null;

-- Enforce NOT NULL now that backfill is complete
alter table shipments
  alter column company_id set not null;

create index if not exists idx_shipments_company on shipments(company_id);
create index if not exists idx_shipments_company_id on shipments(company_id, id);
create index if not exists idx_shipments_deleted_at on shipments(deleted_at) where deleted_at is not null;

-- ─── manifests ────────────────────────────────────────────────────────────────

alter table manifests
  add column if not exists company_id uuid references companies(id),
  add column if not exists deleted_at timestamptz;

update manifests
set company_id = (
  select id from companies where is_active = true order by created_at asc limit 1
)
where company_id is null;

alter table manifests
  alter column company_id set not null;

create index if not exists idx_manifests_company on manifests(company_id);
create index if not exists idx_manifests_company_id on manifests(company_id, id);
create index if not exists idx_manifests_deleted_at on manifests(deleted_at) where deleted_at is not null;

-- ─── deliveries ───────────────────────────────────────────────────────────────

alter table deliveries
  add column if not exists company_id uuid references companies(id),
  add column if not exists deleted_at timestamptz;

update deliveries
set company_id = (
  select id from companies where is_active = true order by created_at asc limit 1
)
where company_id is null;

alter table deliveries
  alter column company_id set not null;

create index if not exists idx_deliveries_company on deliveries(company_id);
create index if not exists idx_deliveries_company_id on deliveries(company_id, id);
create index if not exists idx_deliveries_deleted_at on deliveries(deleted_at) where deleted_at is not null;

-- ─── receipt_vouchers ─────────────────────────────────────────────────────────
-- Finance dependency: add company_id for cross-module isolation

alter table receipt_vouchers
  add column if not exists company_id uuid references companies(id);

update receipt_vouchers
set company_id = (
  select id from companies where is_active = true order by created_at asc limit 1
)
where company_id is null;

alter table receipt_vouchers
  alter column company_id set not null;

create index if not exists idx_receipt_vouchers_company on receipt_vouchers(company_id);

-- ─── Partial performance indexes ──────────────────────────────────────────────
-- Optimise hot-path: open (non-terminal) shipments and pending deliveries

create index if not exists idx_shipments_open
  on shipments(company_id, branch_id, status)
  where status not in ('delivered', 'cancelled') and deleted_at is null;

create index if not exists idx_deliveries_pending
  on deliveries(company_id, branch_id, status)
  where status = 'pending' and deleted_at is null;
