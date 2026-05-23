-- Phase S.3 Part 1 & Part 6 support:
-- 1. Add company_id to payment_vouchers and cashbox_transactions
-- 2. Allow NULL shipment_id in shipment_inventory_movements (for stock adjustments)
-- 3. Extend movement_type constraint to include 'adjustment'
-- 4. Add soft-delete (deleted_at) to warehouses and items

-- ─── payment_vouchers: add company_id ────────────────────────────────────────

alter table payment_vouchers
  add column if not exists company_id uuid references companies(id);

-- Backfill from linked shipment → company, or fallback to first active company
update payment_vouchers pv
set company_id = coalesce(
  (select s.company_id from shipments s where s.id = pv.shipment_id limit 1),
  (select c.id from companies c where c.is_active = true order by c.created_at limit 1)
)
where pv.company_id is null;

alter table payment_vouchers
  alter column company_id set not null;

create index if not exists idx_payment_vouchers_company_id
  on payment_vouchers(company_id, id);

-- ─── cashbox_transactions: add company_id ────────────────────────────────────

alter table cashbox_transactions
  add column if not exists company_id uuid references companies(id);

-- Backfill via source_voucher_id (receipt or payment)
update cashbox_transactions ct
set company_id = coalesce(
  (
    select rv.company_id
    from receipt_vouchers rv
    where rv.id = ct.source_voucher_id and ct.source_voucher_type = 'receipt'
    limit 1
  ),
  (
    select pv.company_id
    from payment_vouchers pv
    where pv.id = ct.source_voucher_id and ct.source_voucher_type = 'payment'
    limit 1
  ),
  (select c.id from companies c where c.is_active = true order by c.created_at limit 1)
)
where ct.company_id is null;

alter table cashbox_transactions
  alter column company_id set not null;

create index if not exists idx_cashbox_company_id
  on cashbox_transactions(company_id, id);

-- ─── shipment_inventory_movements: support standalone adjustments ─────────────

-- Make shipment_id nullable (adjustments are not tied to a specific shipment)
alter table shipment_inventory_movements
  alter column shipment_id drop not null;

-- Drop and recreate movement_type constraint to include 'adjustment'
alter table shipment_inventory_movements
  drop constraint if exists shipment_inventory_movements_movement_type_check;

alter table shipment_inventory_movements
  add constraint shipment_inventory_movements_movement_type_check
  check (movement_type in ('reserved', 'released', 'deducted', 'adjustment'));

-- ─── warehouses: add soft-delete support ─────────────────────────────────────

alter table warehouses
  add column if not exists deleted_at timestamptz null;

create index if not exists idx_warehouses_deleted
  on warehouses(company_id, deleted_at)
  where deleted_at is null;

-- ─── items: add soft-delete support ──────────────────────────────────────────

alter table items
  add column if not exists deleted_at timestamptz null;

create index if not exists idx_items_deleted
  on items(company_id, deleted_at)
  where deleted_at is null;

-- ─── permissions: warehouse/item management ──────────────────────────────────

insert into permissions(code, name, module, action, is_active) values
  ('inventory.warehouse.read',  'Read warehouses',  'inventory', 'read',   true),
  ('inventory.warehouse.write', 'Write warehouses', 'inventory', 'write',  true),
  ('inventory.item.read',       'Read items',       'inventory', 'read',   true),
  ('inventory.item.write',      'Write items',      'inventory', 'write',  true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'inventory.warehouse.read', 'inventory.warehouse.write',
  'inventory.item.read', 'inventory.item.write'
)
where r.code in ('admin', 'accountant')
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'inventory.warehouse.read', 'inventory.item.read'
)
where r.code = 'operator'
on conflict do nothing;
