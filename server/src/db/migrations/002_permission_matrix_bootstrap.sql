insert into permissions(code, name, module, action, is_active)
values
('shipments.read', 'Read shipments', 'shipments', 'read', true),
('shipments.write', 'Write shipments', 'shipments', 'write', true),
('manifests.read', 'Read manifests', 'manifests', 'read', true),
('manifests.write', 'Write manifests', 'manifests', 'write', true),
('deliveries.read', 'Read deliveries', 'deliveries', 'read', true),
('deliveries.write', 'Write deliveries', 'deliveries', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'shipments.read',
  'shipments.write',
  'manifests.read',
  'manifests.write',
  'deliveries.read',
  'deliveries.write'
)
where r.code = 'admin'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'shipments.read',
  'shipments.write',
  'manifests.read',
  'manifests.write',
  'deliveries.read',
  'deliveries.write'
)
where r.code = 'operator'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'shipments.read',
  'manifests.read',
  'deliveries.read'
)
where r.code in ('viewer', 'accountant')
on conflict do nothing;
