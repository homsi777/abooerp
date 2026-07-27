-- 100: تصحيح — أزرار دفتر الشحن لمدقق الشحنات والمدير فقط، وليس لمدخل البيانات.

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

-- ضمان أن مدقق الشحنات يملك قاعدة صلاحيات مدخل البيانات
insert into role_permissions(role_id, permission_id, permission_code)
select sa.id, rp.permission_id, rp.permission_code
from roles de
join roles sa on sa.code = 'shipment_auditor'
join role_permissions rp on rp.role_id = de.id
where de.code = 'data_entry'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
