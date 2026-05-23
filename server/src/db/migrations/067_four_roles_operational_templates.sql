-- 067: أدوار تشغيلية واضحة (مدير عام / مدخل بيانات / محاسب / وكيل) وإصلاح قالب مدخل البيانات
-- ليشمل مسار الشحن الكامل (أطراف، تسليم، دفاتر، دورة حياة، تعريف أسعار للقراءة/الكتابة، إلخ).

update roles
set
  name = case code
    when 'general_manager' then 'المدير العام'
    when 'data_entry' then 'مدخل بيانات'
    when 'accountant' then 'محاسب'
    when 'agent_user' then 'وكيل'
    else name
  end,
  description = case code
    when 'general_manager' then 'كل الصلاحيات التشغيلية والمالية والإدارية.'
    when 'data_entry' then 'الشحنات والتسليم والمرافق التشغيلية (بدون مركز الصلاحيات والإعدادات العامة).'
    when 'accountant' then 'المالية والحوالات والرواتب والتقارير المرتبطة بالمالية.'
    when 'agent_user' then 'بوابة الوكيل والعمليات المرتبطة بشحنات الوكيل وصناديقه.'
    else description
  end,
  updated_at = now()
where code in ('general_manager', 'data_entry', 'accountant', 'agent_user');

-- إعادة بناء صلاحيات الأدوار القالبية الأربعة فقط (لا تغيّر admin/operator/… يدوياً هنا)
delete from role_permissions
where role_id in (
  select id from roles where code in ('general_manager', 'data_entry', 'accountant', 'agent_user')
);

-- المدير العام = كل الأذونات النشطة (مماثل لـ admin من ناحية الصلاحيات)
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join permissions p
where r.code = 'general_manager'
  and p.is_active = true
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- مدخل بيانات: مسار الشحن الكامل + مراجع التشغيل + حد أدنى من المالية للأسعار وسندات الإنشاء المرتبطة بالشحنة
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join lateral (
  values
    ('shipments.view'),
    ('shipments.read'),
    ('shipments.write'),
    ('shipments.create'),
    ('shipments.update'),
    ('shipments.confirm'),
    ('shipments.mark_ready'),
    ('shipments.handover_driver'),
    ('shipments.handover_agent'),
    ('shipments.agent_received'),
    ('shipments.mark_in_transit'),
    ('shipments.mark_arrived'),
    ('shipments.out_for_delivery'),
    ('shipments.deliver'),
    ('shipments.return'),
    ('shipments.cancel'),
    ('manifests.read'),
    ('manifests.write'),
    ('deliveries.read'),
    ('deliveries.write'),
    ('parties.view'),
    ('parties.manage'),
    ('drivers.view'),
    ('vehicles.view'),
    ('customers.view'),
    ('customers.manage'),
    ('settings.agents.read'),
    ('settings.branches.read'),
    ('settings.system.read'),
    ('settings.currencies.read'),
    ('settings.exchangeRates.read'),
    ('shipping.label.read'),
    ('shipping.label.write'),
    ('settings.shippingLabel.read'),
    ('settings.shippingLabel.write'),
    ('finance.read'),
    ('finance.view'),
    ('finance.write'),
    ('finance.vouchers.create'),
    ('reports.view')
) as t(code)
join permissions p on p.code = t.code
where r.code = 'data_entry'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- محاسب: كل ما يبدأ بـ finance. أو hr. أو transfers. + قراءة شحنات للكشوفات المالية + التقارير + أسعار الصرف للقراءة
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
      'reports.view',
      'shipments.read',
      'shipments.view',
      'settings.currencies.read',
      'settings.exchangeRates.read'
    )
  )
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- وكيل: قالب بوابة الوكيل/الـ mini-ERP (كما في 055 قبل ضيق 053)
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join lateral (
  values
    ('agent_workspace.view'),
    ('agent_portal.view'),
    ('agent_portal.status_action'),
    ('shipments.view'),
    ('shipments.read'),
    ('shipments.write'),
    ('shipments.create'),
    ('shipments.update'),
    ('shipments.agent_received'),
    ('shipments.mark_in_transit'),
    ('shipments.mark_arrived'),
    ('shipments.out_for_delivery'),
    ('shipments.deliver'),
    ('deliveries.read'),
    ('parties.view'),
    ('parties.manage'),
    ('drivers.view'),
    ('vehicles.view'),
    ('finance.read'),
    ('finance.view'),
    ('finance.vouchers.view'),
    ('finance.vouchers.create'),
    ('finance.cashboxes.view'),
    ('finance.cashboxes.movements.view')
) as t(code)
join permissions p on p.code = t.code
where r.code = 'agent_user'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- تأكيد أن admin ما زال يملك كل الأذونات النشطة (مثل 053)
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
cross join permissions p
where r.code = 'admin'
  and p.is_active = true
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
