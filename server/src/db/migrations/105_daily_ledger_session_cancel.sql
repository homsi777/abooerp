insert into permissions (code, name, module, action, is_active)
values
  ('daily_ledger.session.cancel', 'إلغاء إرسالية', 'shipments', 'ledger_session_cancel', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions (role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.session.cancel'
where r.code in ('admin', 'general_manager', 'branch_manager', 'manager', 'shipment_auditor', 'data_entry')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
