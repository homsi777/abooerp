-- Phase S.3 Part 2: Shipment Labels Persistence Table
-- Records each print-plan resolution / label print event per shipment

create table if not exists shipment_labels (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid references shipments(id) on delete cascade,
  printer_id   uuid,
  template_id  uuid,
  copies       integer not null default 1
                 check (copies > 0),
  print_status text not null default 'queued'
                 check (print_status in ('queued', 'printed', 'failed')),
  printed_at   timestamptz null,
  company_id   uuid not null references companies(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_shipment_labels_company_shipment
  on shipment_labels(company_id, shipment_id);

create index if not exists idx_shipment_labels_company_status
  on shipment_labels(company_id, print_status);

-- permissions for label persistence
insert into permissions(code, name, module, action, is_active) values
  ('shipping.label.read',  'Read shipment labels',  'shipping', 'read',  true),
  ('shipping.label.write', 'Write shipment labels', 'shipping', 'write', true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('shipping.label.read', 'shipping.label.write')
where r.code in ('admin', 'accountant', 'operator')
on conflict do nothing;
