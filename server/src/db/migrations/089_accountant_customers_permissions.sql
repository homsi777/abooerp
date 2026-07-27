-- 089: المحاسب — عرض وإدارة قسم العملاء (أُزيلت عن طريق الخطأ في 067)

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'customers.view',
  'customers.manage',
  'customers.account.view',
  'customers.account.manage'
)
where r.code = 'accountant'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

update roles
set
  description = 'المالية والحوالات والرواتب والتقارير وإدارة العملاء الحسابيين.',
  updated_at = now()
where code = 'accountant';
