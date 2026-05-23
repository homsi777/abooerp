insert into permissions(code, name, module, action, is_active)
values
  ('settings.currencies.read', 'Read currencies settings', 'settings_currencies', 'read', true),
  ('settings.currencies.write', 'Write currencies settings', 'settings_currencies', 'write', true),
  ('settings.exchangeRates.read', 'Read exchange rates settings', 'settings_exchange_rates', 'read', true),
  ('settings.exchangeRates.write', 'Write exchange rates settings', 'settings_exchange_rates', 'write', true)
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
  'settings.currencies.read',
  'settings.currencies.write',
  'settings.exchangeRates.read',
  'settings.exchangeRates.write'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
