-- 097: تاريخ مستقبلي لدفتر الشحن (تحميل اليوم وسفر الغد — دوريات الجمارك)

insert into permissions(code, name, module, action, is_active)
values
  ('shipments.ledger.future_dates', 'تاريخ مستقبلي لدفتر الشحن', 'shipments', 'ledger_future_dates', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'shipments.ledger.future_dates'
where r.code in ('admin', 'general_manager', 'branch_manager', 'manager', 'data_entry', 'accountant')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
