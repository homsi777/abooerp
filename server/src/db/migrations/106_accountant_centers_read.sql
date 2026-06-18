-- 106: المحاسب — عرض ومتابعة شحن المراكز (بيانات مالية تفصيلية)

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'deliveries.read'
where r.code = 'accountant'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

update roles
set
  description = 'المالية والسندات والحوالات والوكلاء (عرض) والتقارير والعملاء وشحن المراكز (عرض ومتابعة).',
  updated_at = now()
where code = 'accountant';
