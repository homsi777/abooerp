-- دور جديد "مدير — تطبيق أندرويد" (manager_mobile): حساب مدير يدخل من تطبيق
-- الأندرويد ليرى سجلات كل موظفي إدخال البيانات في فرعه ويصدّرها PDF.
-- قراءة فقط: لا كتابة شحنات ولا مالية. رؤية كل الإدخالات تأتي من الصلاحية
-- daily_ledger.view_all_entries (لا يُضاف هذا الدور لقائمة أدوار المدير في
-- الكود حتى لا يرث صلاحيات الحذف/الترحيل). يُحصر باستخدام تطبيق الأندرويد
-- في authRoutes مثل data_entry_mobile.

insert into roles (code, name, description, is_system, is_active)
values (
  'manager_mobile',
  'مدير — تطبيق أندرويد',
  'عرض سجلات دفتر الشحن لكل موظفي إدخال البيانات في الفرع وتصديرها PDF من تطبيق الأندرويد — قراءة فقط.',
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

insert into role_permissions (role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'shipments.read',
  'daily_ledger.view_all_entries',
  'daily_ledger.view_loaded'
)
where r.code = 'manager_mobile'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
