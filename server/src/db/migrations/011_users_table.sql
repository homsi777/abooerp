create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  full_name text not null default '',
  email text unique,
  phone text unique,
  password_hash text not null,
  role_id uuid references roles(id),
  role text not null default 'viewer',
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  status text not null default 'active' check (status in ('active', 'inactive', 'locked')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
  add column if not exists role text;

alter table users
  add column if not exists company_id uuid;

alter table users
  add column if not exists is_active boolean not null default true;

update users u
set role = r.code
from roles r
where u.role_id = r.id
  and (u.role is null or btrim(u.role) = '');

update users
set role = 'viewer'
where role is null or btrim(role) = '';

update users u
set company_id = b.company_id
from branches b
where u.branch_id = b.id
  and u.company_id is null;

update users
set company_id = (
  select c.id
  from companies c
  where c.code = 'COMP-DEFAULT'
)
where company_id is null;

alter table users
  alter column role set not null;

alter table users
  alter column company_id set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'users'
      and constraint_name = 'users_company_id_fkey'
  ) then
    alter table users
      add constraint users_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

update users
set is_active = case when status = 'active' then true else false end;

create index if not exists idx_users_company on users(company_id);
