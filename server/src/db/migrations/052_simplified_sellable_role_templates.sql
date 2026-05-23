insert into roles(code, name, description, company_id, is_system, is_active)
values
  ('agent_user', 'الوكيل', 'قالب الوكيل العملي ويشمل الفرع/المنطقة/الوكيل', null, true, true),
  ('data_entry', 'مدخل البيانات', 'قالب إدخال الشحنات', null, true, true),
  ('accountant', 'المحاسب', 'قالب المحاسب للمكتب أو الميدان', null, true, true),
  ('viewer', 'مشاهدة فقط', 'قالب مشاهدة فقط بدون تعديل', null, true, true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  is_active = true,
  updated_at = now();

update roles
set
  description = case code
    when 'general_manager' then 'Legacy/internal: مدمج عملياً مع Admin'
    when 'branch_manager' then 'Legacy/internal: مدمج عملياً مع الوكيل'
    when 'field_accountant' then 'Legacy/internal: مدمج عملياً مع المحاسب'
    else description
  end,
  updated_at = now()
where code in ('general_manager', 'branch_manager', 'field_accountant');

insert into permissions(code, name, module, action, is_active)
values
  ('shipments.view', 'عرض الشحنات', 'shipments', 'read', true),
  ('shipments.create', 'إنشاء شحنة', 'shipments', 'write', true),
  ('shipments.update', 'تعديل شحنة', 'shipments', 'write', true),
  ('finance.view', 'عرض المالية', 'finance', 'read', true),
  ('finance.vouchers.manage', 'إدارة السندات', 'finance', 'write', true),
  ('finance.debit_credit.view', 'عرض الدائن والمدين', 'finance', 'read', true),
  ('finance.account_statement.view', 'عرض كشف الحساب', 'finance', 'read', true),
  ('reports.view', 'عرض التقارير', 'reports', 'read', true),
  ('settings.view', 'عرض الإعدادات', 'settings', 'read', true),
  ('settings.manage', 'إدارة الإعدادات', 'settings', 'write', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = true,
  updated_at = now();

with template(role_code, permission_codes) as (
  values
    ('agent_user', array[
      'agent_portal.view','agent_portal.status_action',
      'shipments.view','shipments.read',
      'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived',
      'shipments.out_for_delivery','shipments.deliver'
    ]::text[]),
    ('accountant', array[
      'finance.view','finance.read',
      'finance.vouchers.manage','finance.vouchers.read','finance.vouchers.write',
      'finance.debit_credit.view','finance.account_statement.view',
      'finance.cashbox.read','reports.view',
      'shipments.view','shipments.read'
    ]::text[]),
    ('data_entry', array[
      'shipments.view','shipments.read','shipments.create','shipments.update','shipments.write'
    ]::text[]),
    ('viewer', array['shipments.view','shipments.read']::text[])
),
expanded as (
  select r.id role_id, p.id permission_id, p.code permission_code
  from template t
  join roles r on r.code = t.role_code
  join permissions p on p.code = any(t.permission_codes)
)
insert into role_permissions(role_id, permission_id, permission_code)
select role_id, permission_id, permission_code
from expanded
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join permissions p
where r.code = 'admin'
  and p.is_active = true
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
