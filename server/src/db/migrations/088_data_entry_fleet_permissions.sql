-- 088: تأكيد صلاحيات السائقين والمركبات لدور مدخل البيانات (دفتر الشحن اليومي)

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in ('drivers.view', 'vehicles.view', 'parties.manage')
where r.code = 'data_entry'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
