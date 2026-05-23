-- 040_license_activations.sql
-- Backend-enforced license activation table.

create table if not exists license_activations (
  id             uuid        primary key default gen_random_uuid(),
  company_id     uuid        not null references companies(id) on delete cascade,
  license_code   text        not null,
  license_type   text        not null, -- TEST1..TEST5, LOCAL_1..LOCAL_3
  machine_id     text,
  is_active      boolean     not null default true,
  cloud_enabled  boolean     not null default false,
  shipment_limit integer,              -- null = unlimited
  delivery_limit integer,
  receipt_limit  integer,
  activated_at   timestamptz not null default now(),
  metadata       jsonb       not null default '{}'::jsonb,
  unique(company_id, license_code)
);

create index if not exists idx_license_activations_company
  on license_activations(company_id, is_active);

-- Permissions
insert into permissions (code, name, module, action, is_active) values
  ('settings.license.read',  'قراءة حالة الترخيص',  'settings', 'read',  true),
  ('settings.license.write', 'تفعيل مفتاح الترخيص', 'settings', 'write', true)
on conflict (code) do nothing;

-- Grant to admin role
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.code = 'admin'
  and p.code in ('settings.license.read', 'settings.license.write')
on conflict do nothing;
