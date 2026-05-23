alter table currencies
  add column if not exists company_id uuid;

update currencies
set company_id = (
  select id
  from companies
  where code = 'COMP-DEFAULT'
)
where company_id is null;

alter table currencies
  alter column company_id set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'currencies'
      and constraint_name = 'currencies_company_id_fkey'
  ) then
    alter table currencies
      add constraint currencies_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

alter table currencies
  alter column symbol drop not null;

alter table currencies
  drop constraint if exists currencies_code_check;

create unique index if not exists uq_currencies_single_base_per_company on currencies(company_id) where is_base = true;
create index if not exists idx_currencies_company_active on currencies(company_id, is_active);
