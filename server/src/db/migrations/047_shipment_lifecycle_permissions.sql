-- Phase 1: Shipment lifecycle action permissions

insert into permissions(code, name, module, action, is_active)
values
  ('shipments.confirm', 'Confirm shipment', 'shipments', 'write', true),
  ('shipments.mark_ready', 'Mark shipment ready', 'shipments', 'write', true),
  ('shipments.handover_driver', 'Handover shipment to driver', 'shipments', 'write', true),
  ('shipments.handover_agent', 'Handover shipment to agent', 'shipments', 'write', true),
  ('shipments.agent_received', 'Confirm agent received shipment', 'shipments', 'write', true),
  ('shipments.mark_in_transit', 'Mark shipment in transit', 'shipments', 'write', true),
  ('shipments.mark_arrived', 'Mark shipment arrived', 'shipments', 'write', true),
  ('shipments.out_for_delivery', 'Mark shipment out for delivery', 'shipments', 'write', true),
  ('shipments.deliver', 'Mark shipment delivered', 'shipments', 'write', true),
  ('shipments.return', 'Mark shipment return flow', 'shipments', 'write', true),
  ('shipments.cancel', 'Cancel shipment', 'shipments', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'shipments.confirm','shipments.mark_ready','shipments.handover_driver','shipments.handover_agent',
  'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived','shipments.out_for_delivery',
  'shipments.deliver','shipments.return','shipments.cancel'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

