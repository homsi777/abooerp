-- يسمح للمحاسب ومشرف/مدير الفرع بإنشاء وتعديل حسابات "مدخل بيانات" فقط
-- (تطبيق الأندرويد)، ضمن فروعهم المخوّلة فقط — دون منحهم صلاحية إدارة
-- المستخدمين الكاملة (settings.users.write) التي تسمح بإنشاء/تعديل أي
-- حساب بما فيها حسابات المدراء. التقييد الفعلي (الدور + الفرع) مفروض في
-- server/src/routes/userRoutes.ts، هذا الملف يضيف فقط الصلاحية والمنح.

insert into permissions (code, name, module, action, is_active)
values (
  'settings.users.manage_data_entry',
  'إنشاء/تعديل حسابات مدخل بيانات فقط',
  'settings_users',
  'manage_data_entry',
  true
)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'settings.users.manage_data_entry',
  'permissions.view',
  'settings.users.read'
)
where r.code in ('accountant', 'branch_manager')
on conflict do nothing;
