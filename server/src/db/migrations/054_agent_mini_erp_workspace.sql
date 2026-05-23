-- Phase 2A.10: Agent mini-ERP — reference scoping columns + permissions + agent_user template

-- ─── Reference tables: optional agent / branch / creator for safe agent scoping ───

alter table senders_receivers
  add column if not exists branch_id uuid references branches(id) on delete set null,
  add column if not exists agent_id uuid references agents(id) on delete set null,
  add column if not exists created_by_user_id uuid references users(id) on delete set null;

create index if not exists idx_senders_receivers_agent on senders_receivers(agent_id) where agent_id is not null;
create index if not exists idx_senders_receivers_branch on senders_receivers(branch_id) where branch_id is not null;

alter table drivers
  add column if not exists agent_id uuid references agents(id) on delete set null;

create index if not exists idx_drivers_agent on drivers(agent_id) where agent_id is not null;

alter table vehicles
  add column if not exists agent_id uuid references agents(id) on delete set null;

create index if not exists idx_vehicles_agent on vehicles(agent_id) where agent_id is not null;

-- ─── New permission codes ───────────────────────────────────────────────────────

insert into permissions(code, name, module, action, is_active)
values
  ('agent_workspace.view', 'عرض لوحة الوكيل', 'agent_workspace', 'read', true),
  ('parties.view', 'عرض أطراف الوكيل', 'parties', 'read', true),
  ('parties.manage', 'إدارة أطراف الوكيل', 'parties', 'write', true),
  ('drivers.view', 'عرض سائقي الوكيل', 'fleet', 'read', true),
  ('vehicles.view', 'عرض مركبات الوكيل', 'fleet', 'read', true),
  ('deliveries.read', 'قراءة التسليمات', 'deliveries', 'read', true),
  ('deliveries.write', 'كتابة التسليمات', 'deliveries', 'write', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = true,
  updated_at = now();

-- ─── Agent template: scoped operational mini-ERP (no reports/settings/global finance) ───

with template(role_code, permission_codes) as (
  values
    ('agent_user', array[
      'agent_workspace.view',
      'agent_portal.view','agent_portal.status_action',
      'shipments.view','shipments.read','shipments.write','shipments.create','shipments.update',
      'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived',
      'shipments.out_for_delivery','shipments.deliver',
      'deliveries.read',
      'parties.view','parties.manage',
      'drivers.view','vehicles.view',
      'finance.read','finance.view',
      'finance.vouchers.read','finance.vouchers.write','finance.vouchers.manage',
      'finance.cashbox.read','finance.cashbox.write'
    ]::text[])
),
target_roles as (
  select r.id, r.code, t.permission_codes
  from roles r
  join template t on t.role_code = r.code
),
removed as (
  delete from role_permissions rp
  using target_roles tr
  where rp.role_id = tr.id
    and coalesce(rp.permission_code, (select p.code from permissions p where p.id = rp.permission_id)) <> all(tr.permission_codes)
  returning rp.role_id
),
expanded as (
  select tr.id role_id, p.id permission_id, p.code permission_code
  from target_roles tr
  join permissions p on p.code = any(tr.permission_codes)
)
insert into role_permissions(role_id, permission_id, permission_code)
select role_id, permission_id, permission_code
from expanded
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'agent_workspace.view', 'parties.view', 'parties.manage', 'drivers.view', 'vehicles.view'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- Operational roles (non-agent) need reference reads for existing workflows
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in ('parties.view', 'drivers.view', 'vehicles.view')
where r.code in ('data_entry', 'branch_manager', 'general_manager', 'manager', 'viewer', 'accountant', 'field_accountant', 'branch_user')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
