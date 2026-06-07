-- 091: مدخل البيانات — تاريخ دفتر سابق + إدارة السائقين والمركبات

insert into permissions(code, name, module, action, is_active)
values
  ('shipments.ledger.past_dates', 'تعديل تاريخ دفتر الشحن', 'shipments', 'ledger_past_dates', true),
  ('drivers.manage', 'إدارة السائقين', 'fleet', 'manage', true),
  ('vehicles.manage', 'إدارة المركبات', 'fleet', 'manage', true)
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
  'shipments.ledger.past_dates',
  'drivers.view',
  'drivers.manage',
  'vehicles.view',
  'vehicles.manage',
  'parties.manage'
)
where r.code = 'data_entry'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
