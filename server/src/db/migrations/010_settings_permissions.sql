insert into permissions(code, name, module, action, is_active)
values
  ('settings.branches.read', 'Read branch settings', 'settings_branches', 'read', true),
  ('settings.branches.write', 'Write branch settings', 'settings_branches', 'write', true),
  ('settings.agents.read', 'Read agent settings', 'settings_agents', 'read', true),
  ('settings.agents.write', 'Write agent settings', 'settings_agents', 'write', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'settings.branches.read',
  'settings.branches.write',
  'settings.agents.read',
  'settings.agents.write'
)
where r.code = 'admin'
on conflict do nothing;
