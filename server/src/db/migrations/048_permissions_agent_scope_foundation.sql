alter table users
  add column if not exists user_type text not null default 'employee'
  check (user_type in ('admin', 'employee', 'agent', 'accountant', 'branch_supervisor', 'delivery'));

alter table users
  add column if not exists last_login_at timestamptz;

alter table agents
  add column if not exists city text;

alter table agents
  add column if not exists area text;

alter table agents
  add column if not exists address text;

alter table agents
  add column if not exists notes text;

insert into roles(code, name, description, is_system, is_active)
values
  ('admin', 'Admin', 'Full system administration', true, true),
  ('manager', 'Manager', 'Company and branch operational management', true, true),
  ('accountant', 'Accountant', 'Finance, vouchers, statements, and reports', true, true),
  ('branch_user', 'BranchUser', 'Branch-scoped shipment operations', true, true),
  ('agent_user', 'AgentUser', 'Agent-scoped shipment portal account', true, true),
  ('delivery_user', 'DeliveryUser', 'Delivery-scoped operations', true, true),
  ('viewer', 'Viewer', 'Read-only operational visibility', true, true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  is_active = excluded.is_active,
  updated_at = now();

insert into permissions(code, name, module, action, is_active)
values
  ('agents.view', 'View agents module', 'agents', 'read', true),
  ('agents.manage', 'Manage agents', 'agents', 'write', true),
  ('branches.view', 'View branches module', 'branches', 'read', true),
  ('branches.manage', 'Manage branches', 'branches', 'write', true),
  ('permissions.view', 'View permissions center', 'permissions', 'read', true),
  ('permissions.manage', 'Manage permissions center', 'permissions', 'write', true),
  ('finance.debit_credit.view', 'View debit/credit center', 'finance', 'read', true),
  ('finance.account_statement.view', 'View account statement', 'finance', 'read', true),
  ('agent_portal.view', 'View agent portal', 'agent_portal', 'read', true),
  ('agent_portal.status_action', 'Agent portal status action', 'agent_portal', 'write', true),
  ('reports.view', 'View reports', 'reports', 'read', true),
  ('users.manage', 'Manage users', 'users', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'agents.view','agents.manage','branches.view','branches.manage',
  'permissions.view','permissions.manage',
  'finance.debit_credit.view','finance.account_statement.view',
  'agent_portal.view','agent_portal.status_action'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'shipments.read','shipments.write','shipments.confirm','shipments.handover_agent',
  'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived',
  'shipments.out_for_delivery','shipments.deliver',
  'manifests.read','manifests.write','deliveries.read','deliveries.write',
  'branches.view','agents.view','reports.view'
)
where r.code in ('manager','branch_user')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'agent_portal.view','agent_portal.status_action',
  'shipments.read','shipments.agent_received','shipments.mark_in_transit',
  'shipments.mark_arrived','shipments.out_for_delivery','shipments.deliver'
)
where r.code = 'agent_user'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'shipments.read','deliveries.read','deliveries.write','shipments.mark_in_transit',
  'shipments.mark_arrived','shipments.out_for_delivery','shipments.deliver'
)
where r.code = 'delivery_user'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'finance.read','finance.write','finance.vouchers.read','finance.vouchers.write',
  'finance.cashbox.read','finance.cashbox.write','finance.debit_credit.view',
  'finance.account_statement.view','reports.view'
)
where r.code = 'accountant'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in ('shipments.read','manifests.read','deliveries.read','reports.view')
where r.code = 'viewer'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
