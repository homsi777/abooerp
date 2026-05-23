create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  company_id uuid references companies(id),
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table roles
  add column if not exists company_id uuid;

alter table roles
  add column if not exists is_system boolean not null default false;

update roles
set is_system = true
where code in ('admin', 'accountant', 'operator', 'viewer', 'manager', 'cashier');

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'roles'
      and constraint_name = 'roles_company_id_fkey'
  ) then
    alter table roles
      add constraint roles_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

create index if not exists idx_roles_company on roles(company_id);
