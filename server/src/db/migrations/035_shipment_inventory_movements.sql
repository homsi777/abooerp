-- Phase S.2: Inventory Foundation + Shipment ↔ Inventory Integration
-- Creates: warehouses, items, item_stock, shipment_inventory_movements

-- ─── warehouses ───────────────────────────────────────────────────────────────

create table if not exists warehouses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  branch_id   uuid references branches(id) on delete set null,
  code        text not null,
  name        text not null,
  address     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_warehouses_company   on warehouses(company_id);
create index if not exists idx_warehouses_branch    on warehouses(company_id, branch_id);

-- ─── items (inventory master) ─────────────────────────────────────────────────

create table if not exists items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  code         text not null,
  name         text not null,
  description  text,
  unit         text not null default 'piece',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_items_company on items(company_id);

-- ─── item_stock (ledger per company / warehouse / item) ───────────────────────

create table if not exists item_stock (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  warehouse_id       uuid not null references warehouses(id),
  item_id            uuid not null references items(id),
  quantity_on_hand   numeric(14,4) not null default 0
                        check (quantity_on_hand >= 0),
  quantity_reserved  numeric(14,4) not null default 0
                        check (quantity_reserved >= 0),
  updated_at         timestamptz not null default now(),
  unique (company_id, warehouse_id, item_id)
);

-- Computed available stock = on_hand - reserved (enforced via check)
alter table item_stock
  add constraint item_stock_reserved_lte_on_hand
  check (quantity_reserved <= quantity_on_hand);

create index if not exists idx_item_stock_company_warehouse on item_stock(company_id, warehouse_id);
create index if not exists idx_item_stock_company_item      on item_stock(company_id, item_id);

-- ─── shipment_inventory_movements ─────────────────────────────────────────────

create table if not exists shipment_inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  shipment_id   uuid not null references shipments(id) on delete cascade,
  item_id       uuid not null references items(id),
  warehouse_id  uuid not null references warehouses(id),
  quantity      numeric(14,4) not null check (quantity > 0),
  movement_type text not null
                  check (movement_type in ('reserved', 'released', 'deducted')),
  notes         text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_sim_company_shipment   on shipment_inventory_movements(company_id, shipment_id);
create index if not exists idx_sim_company_warehouse  on shipment_inventory_movements(company_id, warehouse_id);
create index if not exists idx_sim_company_item       on shipment_inventory_movements(company_id, item_id);
create index if not exists idx_sim_movement_type      on shipment_inventory_movements(movement_type);

-- Prevent double-deduction: only one deducted movement per (shipment, item, warehouse)
create unique index if not exists uq_sim_deducted_per_shipment_item_wh
  on shipment_inventory_movements(shipment_id, item_id, warehouse_id)
  where movement_type = 'deducted';

-- ─── permissions ──────────────────────────────────────────────────────────────

insert into permissions(code, name, module, action, is_active) values
  ('inventory.read',        'Read inventory',         'inventory', 'read',   true),
  ('inventory.write',       'Write inventory',        'inventory', 'write',  true),
  ('inventory.stock.read',  'Read stock levels',      'inventory', 'read',   true),
  ('inventory.stock.write', 'Adjust stock',           'inventory', 'write',  true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'inventory.read', 'inventory.write',
  'inventory.stock.read', 'inventory.stock.write'
)
where r.code in ('admin', 'accountant')
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'inventory.read', 'inventory.stock.read'
)
where r.code = 'operator'
on conflict do nothing;
