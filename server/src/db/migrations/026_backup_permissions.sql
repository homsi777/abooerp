insert into permissions(code, name, module, action, is_active)
values
  ('settings.backup.read', 'Read backup settings', 'settings_backup', 'read', true),
  ('settings.backup.write', 'Write backup settings', 'settings_backup', 'write', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'settings.backup.read',
  'settings.backup.write'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
