insert into roles(code, name, description, company_id, is_system, is_active)
values
  ('general_manager', 'المدير العام', 'قالب المدير العام التشغيلي', null, true, true),
  ('branch_manager', 'مدير الفرع', 'قالب مدير الفرع محدود بنطاق الفروع المسموحة', null, true, true),
  ('agent_user', 'الوكيل', 'قالب مستخدم الوكيل وبوابة شحناته', null, true, true),
  ('data_entry', 'مدخل بيانات', 'قالب إدخال الشحنات والعمليات الأساسية', null, true, true),
  ('field_accountant', 'المحاسب الميداني', 'قالب محاسب ميداني محدود', null, true, true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  is_active = true,
  updated_at = now();

insert into permissions(code, name, module, action, is_active)
values
  ('shipments.view', 'عرض الشحنات', 'shipments', 'read', true),
  ('shipments.create', 'إنشاء شحنة', 'shipments', 'write', true),
  ('shipments.update', 'تعديل شحنة', 'shipments', 'write', true),
  ('finance.view', 'عرض المالية', 'finance', 'read', true),
  ('finance.vouchers.manage', 'إدارة السندات', 'finance', 'write', true),
  ('settings.view', 'عرض الإعدادات', 'settings', 'read', true),
  ('settings.manage', 'إدارة الإعدادات', 'settings', 'write', true),
  ('reports.view', 'عرض التقارير', 'reports', 'read', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = true,
  updated_at = now();

with role_template(role_code, permission_codes) as (
  values
    ('general_manager', array[
      'shipments.read','shipments.write','shipments.view','shipments.create','shipments.update',
      'shipments.confirm','shipments.handover_agent','shipments.agent_received','shipments.deliver','shipments.cancel',
      'deliveries.read','deliveries.write','manifests.read','manifests.write',
      'agents.view','agents.manage','settings.agents.read','settings.agents.write',
      'branches.view','branches.manage','settings.branches.read','settings.branches.write',
      'finance.read','finance.write','finance.view','finance.vouchers.read','finance.vouchers.write','finance.vouchers.manage',
      'finance.debit_credit.view','finance.account_statement.view','finance.cashbox.read','finance.cashbox.write',
      'reports.view','permissions.view','permissions.manage','users.manage',
      'settings.view','settings.manage','settings.users.read','settings.users.write','settings.roles.read','settings.roles.write',
      'settings.system.read','settings.system.write'
    ]::text[]),
    ('branch_manager', array[
      'shipments.read','shipments.write','shipments.view','shipments.create','shipments.update',
      'shipments.confirm','shipments.handover_agent','shipments.agent_received','shipments.deliver',
      'deliveries.read','deliveries.write','manifests.read','manifests.write',
      'agents.view','settings.agents.read','branches.view','settings.branches.read','reports.view'
    ]::text[]),
    ('agent_user', array[
      'agent_portal.view','agent_portal.status_action','shipments.read','shipments.view',
      'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived','shipments.out_for_delivery','shipments.deliver'
    ]::text[]),
    ('data_entry', array[
      'shipments.read','shipments.write','shipments.view','shipments.create','shipments.update',
      'manifests.read','deliveries.read'
    ]::text[]),
    ('accountant', array[
      'finance.read','finance.write','finance.view',
      'finance.vouchers.read','finance.vouchers.write','finance.vouchers.manage',
      'finance.debit_credit.view','finance.account_statement.view','finance.cashbox.read','finance.cashbox.write',
      'reports.view','shipments.read','shipments.view'
    ]::text[]),
    ('field_accountant', array[
      'shipments.read','shipments.view','finance.read','finance.view',
      'finance.vouchers.read','finance.vouchers.write','finance.vouchers.manage',
      'finance.account_statement.view','finance.cashbox.read'
    ]::text[]),
    ('viewer', array['shipments.read','shipments.view']::text[])
),
expanded as (
  select r.id as role_id, p.id as permission_id, p.code as permission_code
  from role_template t
  join roles r on r.code = t.role_code
  join permissions p on p.code = any(t.permission_codes)
)
insert into role_permissions(role_id, permission_id, permission_code)
select role_id, permission_id, permission_code
from expanded
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
