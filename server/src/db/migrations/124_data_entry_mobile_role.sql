-- دور جديد ومنفصل تماماً "مدخل بيانات — تطبيق أندرويد" (data_entry_mobile)،
-- بصلاحيات ضيّقة جداً تقتصر على ما يحتاجه تطبيق التابلت فعلياً (دفتر
-- الشحن اليومي + العهد)، بدل مشاركة الدور الحالي "مدخل بيانات"
-- (data_entry) الواسع المستخدم على الكمبيوتر — والذي يملك 54 صلاحية لا
-- تحتاجها شاشة التابلت إطلاقاً. لو سُرِّب حساب تابلت، أقصى ما يستطيع
-- فاعله فعله محدود بهذه الصلاحيات الأربع فقط.
--
-- الدور القديم (data_entry) يبقى كما هو تماماً بلا أي تغيير — الحسابات
-- الموجودة حالياً (مثل nabil) تستمر بالعمل دون أي أثر لهذا الملف عليها.

insert into roles (code, name, description, is_system, is_active)
values (
  'data_entry_mobile',
  'مدخل بيانات — تطبيق أندرويد',
  'صلاحيات ضيّقة تقتصر على تطبيق التابلت فقط: دفتر الشحن اليومي والعهد — لا تشمل أي شاشة من شاشات الكمبيوتر.',
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('shipments.read', 'shipments.write', 'finance.read', 'finance.write')
where r.code = 'data_entry_mobile'
on conflict do nothing;
