-- 099: دور «مدقق شحنات» — نفس أقسام مدخل البيانات + كل أزرار دفتر الشحن اليومي.
-- مدخل البيانات: إدخال أسطر فقط (بدون تصدير PDF، نقل، حذف، حفظ الشحنات، …).

insert into roles(code, name, description, company_id, is_system, is_active)
values (
  'shipment_auditor',
  'مدقق شحنات',
  'مراجعة وإدخال الشحنات ضمن الفرع مع كل أزرار دفتر الشحن اليومي (حفظ، نقل، حذف، PDF، …)',
  null,
  true,
  true
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  is_active = true,
  updated_at = now();

insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.export_pdf', 'تصدير PDF لدفتر الشحن', 'shipments', 'ledger_export_pdf', true),
  ('daily_ledger.close_section', 'إغلاق قسم دفتر الشحن', 'shipments', 'ledger_close_section', true),
  ('daily_ledger.save_log', 'سجل حفظ دفتر الشحن', 'shipments', 'ledger_save_log', true),
  ('daily_ledger.view_loaded', 'إظهار المحمّلة في دفتر الشحن', 'shipments', 'ledger_view_loaded', true),
  ('daily_ledger.delete_rows', 'حذف أسطر دفتر الشحن', 'shipments', 'ledger_delete_rows', true),
  ('daily_ledger.post_shipments', 'حفظ الشحنات من دفتر الشحن', 'shipments', 'ledger_post_shipments', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

-- أزرار الدفتر: المدير ومدقق الشحنات فقط (ليس مدخل البيانات)
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'daily_ledger.export_pdf',
  'daily_ledger.close_section',
  'daily_ledger.save_log',
  'daily_ledger.view_loaded',
  'daily_ledger.delete_rows',
  'daily_ledger.post_shipments',
  'daily_ledger.transfer.create',
  'daily_ledger.transfer.confirm'
)
where r.code in ('admin', 'general_manager', 'branch_manager', 'manager', 'shipment_auditor')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- مدقق شحنات: نسخ كل صلاحيات مدخل البيانات + أزرار الدفتر أعلاه
insert into role_permissions(role_id, permission_id, permission_code)
select sa.id, rp.permission_id, rp.permission_code
from roles de
join roles sa on sa.code = 'shipment_auditor'
join role_permissions rp on rp.role_id = de.id
where de.code = 'data_entry'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- إزالة أزرار الدفتر من مدخل البيانات (إن وُجدت من ترحيلات سابقة)
delete from role_permissions rp
using roles r, permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'data_entry'
  and p.code in (
    'daily_ledger.export_pdf',
    'daily_ledger.close_section',
    'daily_ledger.save_log',
    'daily_ledger.view_loaded',
    'daily_ledger.delete_rows',
    'daily_ledger.post_shipments',
    'daily_ledger.transfer.create',
    'daily_ledger.transfer.confirm'
  );
