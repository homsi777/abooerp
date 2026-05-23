-- Phase NET.2 — LAN Device Authorization
-- Creates: linked_devices table + permissions

create table if not exists linked_devices (
  id              uuid primary key default gen_random_uuid(),
  machine_id      text not null unique,
  device_name     text not null default 'جهاز غير معرّف',
  ip_address      text,
  os_type         text,
  company_id      uuid not null references companies(id),
  branch_id       uuid references branches(id) on delete set null,
  is_approved     boolean not null default false,
  is_blocked      boolean not null default false,
  approved_by     uuid references users(id) on delete set null,
  approved_at     timestamptz null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- a device cannot be both approved and blocked simultaneously
  constraint device_state_exclusive check (not (is_approved and is_blocked))
);

create index if not exists idx_linked_devices_company    on linked_devices(company_id);
create index if not exists idx_linked_devices_machine_id on linked_devices(machine_id);
create index if not exists idx_linked_devices_approved
  on linked_devices(company_id, is_approved)
  where not is_blocked;

-- ─── permissions ──────────────────────────────────────────────────────────────

insert into permissions(code, name, module, action, is_active)
values
  ('settings.devices.read',  'Read linked devices',   'settings_devices', 'read',  true),
  ('settings.devices.write', 'Manage linked devices', 'settings_devices', 'write', true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('settings.devices.read', 'settings.devices.write')
where r.code = 'admin'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'settings.devices.read'
where r.code = 'manager'
on conflict do nothing;
