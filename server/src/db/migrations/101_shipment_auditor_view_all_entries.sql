-- 101: مدقق الشحنات يرى كل إدخالات دفتر الشحن (مثل المدير) وليس إدخالاته فقط.

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.view_all_entries'
where r.code = 'shipment_auditor'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
