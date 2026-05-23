alter table exchange_rates
  add column if not exists currency_id uuid;

alter table exchange_rates
  add column if not exists company_id uuid;

alter table exchange_rates
  add column if not exists effective_date date;

update exchange_rates er
set currency_id = c.id
from currencies c
where er.currency_id is null
  and c.code = er.quote_currency;

update exchange_rates er
set company_id = c.company_id
from currencies c
where er.company_id is null
  and c.id = er.currency_id;

update exchange_rates
set effective_date = coalesce(effective_at::date, current_date)
where effective_date is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by currency_id, effective_date, company_id
      order by effective_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from exchange_rates
)
delete from exchange_rates er
using ranked r
where er.id = r.id
  and r.rn > 1;

alter table exchange_rates
  alter column currency_id set not null;

alter table exchange_rates
  alter column company_id set not null;

alter table exchange_rates
  alter column effective_date set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'exchange_rates'
      and constraint_name = 'exchange_rates_currency_id_fkey'
  ) then
    alter table exchange_rates
      add constraint exchange_rates_currency_id_fkey
      foreign key (currency_id) references currencies(id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'exchange_rates'
      and constraint_name = 'exchange_rates_company_id_fkey'
  ) then
    alter table exchange_rates
      add constraint exchange_rates_company_id_fkey
      foreign key (company_id) references companies(id);
  end if;
end $$;

create unique index if not exists uq_exchange_rates_currency_effective_company
  on exchange_rates(currency_id, effective_date, company_id);

create index if not exists idx_exchange_rates_company_currency_effective
  on exchange_rates(company_id, currency_id, effective_date desc);
