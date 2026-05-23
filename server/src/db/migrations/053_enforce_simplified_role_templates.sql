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
      'finance.cashbox.read','finance.cashbox.write',
      'reports.view','shipments.view','shipments.read'
    ]::text[]),
    ('data_entry', array[
      'shipments.view','shipments.read','shipments.create','shipments.update','shipments.write'
    ]::text[]),
    ('viewer', array['shipments.view','shipments.read']::text[])
),
target_roles as (
  select r.id, r.code, t.permission_codes
  from roles r
  join template t on t.role_code = r.code
),
removed as (
  delete from role_permissions rp
  using target_roles tr
  where rp.role_id = tr.id
    and coalesce(rp.permission_code, (select p.code from permissions p where p.id = rp.permission_id)) <> all(tr.permission_codes)
  returning rp.role_id
),
expanded as (
  select tr.id role_id, p.id permission_id, p.code permission_code
  from target_roles tr
  join permissions p on p.code = any(tr.permission_codes)
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
