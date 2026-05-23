alter table system_settings
  add column if not exists company_id uuid;

update system_settings
set company_id = (
  select id
  from companies
  where code = 'COMP-DEFAULT'
)
where company_id is null;

alter table system_settings
  add column if not exists value jsonb;

update system_settings
set value = coalesce(value, value_json, '{}'::jsonb)
where value is null;

alter table system_settings
  add column if not exists is_encrypted boolean not null default false;

alter table system_settings
  alter column company_id set not null;

alter table system_settings
  alter column value set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'system_settings'
      and constraint_name = 'system_settings_company_id_fkey'
  ) then
    alter table system_settings
      add constraint system_settings_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

alter table system_settings
  drop constraint if exists system_settings_key_key;

create unique index if not exists uq_system_settings_company_key on system_settings(company_id, key);
