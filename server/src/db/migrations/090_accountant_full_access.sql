-- 090: تأكيد صلاحيات المحاسب — المالية كاملة، الحوالات، HR (موظفين/رواتب/سلف)، العملاء

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.is_active = true
where r.code = 'accountant'
  and (
    p.code like 'finance.%'
    or p.code like 'transfers.%'
    or p.code like 'hr.%'
    or p.code in (
      'customers.view',
      'customers.manage',
      'customers.account.view',
      'customers.account.manage',
      'reports.view',
      'shipments.read',
      'shipments.view',
      'settings.currencies.read',
      'settings.exchangeRates.read'
    )
  )
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

update roles
set
  description = 'المالية والحوالات والرواتب والسلف والتقارير وإدارة العملاء الحسابيين.',
  updated_at = now()
where code = 'accountant';
