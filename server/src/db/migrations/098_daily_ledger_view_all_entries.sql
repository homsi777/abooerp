-- 098: المدير يرى كل إدخالات موظفي مدخل البيانات — مدخل البيانات يرى إدخالاته فقط

insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.view_all_entries', 'عرض كل إدخالات دفتر الشحن', 'shipments', 'ledger_view_all', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.view_all_entries'
where r.code in ('admin', 'general_manager', 'branch_manager', 'manager')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
