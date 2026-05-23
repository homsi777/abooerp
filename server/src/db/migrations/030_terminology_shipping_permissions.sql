insert into permissions(code, name, module, action, is_active)
values
  ('settings.terminology.read', 'Read terminology settings', 'settings_terminology', 'read', true),
  ('settings.terminology.write', 'Write terminology settings', 'settings_terminology', 'write', true),
  ('settings.shippingLabel.read', 'Read shipping label settings', 'settings_shipping_label', 'read', true),
  ('settings.shippingLabel.write', 'Write shipping label settings', 'settings_shipping_label', 'write', true)
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
  'settings.terminology.read',
  'settings.terminology.write',
  'settings.shippingLabel.read',
  'settings.shippingLabel.write'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
