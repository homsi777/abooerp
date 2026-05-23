alter table role_permissions
  add column if not exists id uuid default gen_random_uuid();

update role_permissions
set id = gen_random_uuid()
where id is null;

alter table role_permissions
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'role_permissions'
      and constraint_name = 'role_permissions_id_unique'
  ) then
    alter table role_permissions
      add constraint role_permissions_id_unique unique(id);
  end if;
end $$;

alter table role_permissions
  add column if not exists permission_code text;

update role_permissions rp
set permission_code = p.code
from permissions p
where rp.permission_id = p.id
  and rp.permission_code is null;

create index if not exists idx_role_permissions_role on role_permissions(role_id);
create index if not exists idx_role_permissions_code on role_permissions(permission_code);

insert into permissions(code, name, module, action, is_active)
values
  ('settings.users.read', 'Read users settings', 'settings_users', 'read', true),
  ('settings.users.write', 'Write users settings', 'settings_users', 'write', true),
  ('settings.roles.read', 'Read roles settings', 'settings_roles', 'read', true),
  ('settings.roles.write', 'Write roles settings', 'settings_roles', 'write', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'settings.users.read',
  'settings.users.write',
  'settings.roles.read',
  'settings.roles.write'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
