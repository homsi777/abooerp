create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into companies(code, name, is_active)
values ('COMP-DEFAULT', 'مؤسسة شحن — حلب', true)
on conflict (code) do nothing;

alter table branches
  add column if not exists company_id uuid;

update branches
set company_id = (
  select c.id
  from companies c
  where c.code = 'COMP-DEFAULT'
)
where company_id is null;

alter table branches
  alter column company_id set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'branches'
      and constraint_name = 'branches_company_id_fkey'
  ) then
    alter table branches
      add constraint branches_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

create index if not exists idx_branches_company on branches(company_id);
