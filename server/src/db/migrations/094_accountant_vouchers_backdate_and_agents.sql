-- 094: المحاسب — سندات بتاريخ سابق + عرض الوكلاء (ذمم الوكلاء)

insert into permissions(code, name, module, action, is_active)
values
  ('finance.vouchers.backdate', 'إنشاء وتعديل سندات بتاريخ سابق', 'finance', 'vouchers_backdate', true)
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
  'finance.vouchers.backdate',
  'settings.agents.read',
  'agents.view'
)
where r.code = 'accountant'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'finance.vouchers.backdate'
where r.code in ('admin', 'general_manager', 'branch_manager')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

update roles
set
  description = 'المالية والسندات (بما فيها التاريخ السابق) والحوالات والوكلاء (عرض) والتقارير وإدارة العملاء الحسابيين.',
  updated_at = now()
where code = 'accountant';
