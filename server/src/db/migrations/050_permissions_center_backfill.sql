insert into permissions(code, name, module, action, is_active)
values
  ('permissions.view', 'View permissions center', 'permissions', 'read', true),
  ('permissions.manage', 'Manage permissions center', 'permissions', 'write', true),
  ('users.manage', 'Manage users', 'users', 'write', true),
  ('agent_portal.view', 'View agent portal', 'agent_portal', 'read', true),
  ('agent_portal.status_action', 'Agent portal status action', 'agent_portal', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active,
  updated_at = now();

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join permissions p
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'agent_portal.view',
  'agent_portal.status_action',
  'shipments.read',
  'shipments.agent_received',
  'shipments.mark_in_transit',
  'shipments.mark_arrived',
  'shipments.out_for_delivery',
  'shipments.deliver'
)
where r.code in ('agent_user', 'AgentUser')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
