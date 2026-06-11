-- مزامنة صناديق الوكلاء: إنشاء الناقص، ربط بالصندوق العام، وإعادة حساب الأرصدة من الحركات النقدية.

with ranked as (
  select
    a.id,
    row_number() over (
      partition by coalesce(a.governorate, a.name)
      order by
        (select count(*) from shipments s where s.agent_id = a.id and s.deleted_at is null) desc,
        case when a.code like 'AGT-%' then 1 else 0 end,
        a.created_at asc
    ) as rn
  from agents a
  join branches b on b.id = a.branch_id
  where a.is_active = true
)
insert into cashboxes (
  company_id, branch_id, agent_id,
  code, name, type,
  currency_code, opening_balance, current_balance,
  is_active, notes, parent_cashbox_id, created_at, updated_at
)
select
  b.company_id,
  a.branch_id,
  a.id,
  'CASH-AG-' || upper(replace(replace(a.code, '-', ''), ' ', '')) || '-USD',
  'صندوق ' || a.name,
  'AGENT',
  'USD',
  0,
  0,
  true,
  'أُنشئ تلقائياً (ترحيل 103)',
  gen.general_id,
  now(),
  now()
from agents a
join branches b on b.id = a.branch_id
join ranked r on r.id = a.id and r.rn = 1
cross join lateral (
  select c.id as general_id
  from cashboxes c
  where c.company_id = b.company_id
    and c.type = 'COMPANY'
    and c.currency_code = 'USD'
    and c.is_active = true
  order by case when c.code = 'CASH-GENERAL-USD' then 0 else 1 end, c.created_at
  limit 1
) gen
where a.is_active = true
  and a.branch_id is not null
  and not exists (
    select 1 from cashboxes x where x.agent_id = a.id and x.type = 'AGENT'
  )
on conflict (company_id, code) do nothing;

with ranked as (
  select
    a.id,
    coalesce(a.governorate, a.name) as gov_key,
    row_number() over (
      partition by coalesce(a.governorate, a.name)
      order by
        (select count(*) from shipments s where s.agent_id = a.id and s.deleted_at is null) desc,
        case when a.code like 'AGT-%' then 1 else 0 end,
        a.created_at asc
    ) as rn
  from agents a
  join branches b on b.id = a.branch_id
  where a.is_active = true
),
canonical as (
  select id, gov_key from ranked where rn = 1
)
update cashboxes cb
set agent_id = c.id, updated_at = now()
from agents a
join branches b on b.id = a.branch_id
join canonical c on c.gov_key = coalesce(a.governorate, a.name)
where cb.type = 'AGENT'
  and cb.agent_id = a.id
  and a.id <> c.id
  and not exists (
    select 1 from cashboxes x
    where x.agent_id = c.id and x.type = 'AGENT' and x.id <> cb.id
  );

with general as (
  select distinct on (company_id)
    company_id,
    id as general_id
  from cashboxes
  where type = 'COMPANY'
    and currency_code = 'USD'
    and is_active = true
  order by company_id, case when code = 'CASH-GENERAL-USD' then 0 else 1 end, created_at
)
update cashboxes cb
set parent_cashbox_id = g.general_id, updated_at = now()
from general g
where cb.company_id = g.company_id
  and cb.parent_cashbox_id is null
  and (
    cb.type = 'AGENT'
    or (
      cb.type = 'BRANCH'
      and exists (select 1 from branches br where br.id = cb.branch_id and br.code = 'BR-ALEPPO')
    )
  );

update cashboxes cb
set current_balance = cb.opening_balance, updated_at = now()
where not exists (select 1 from cashbox_transactions ct where ct.cashbox_id = cb.id);

update cashboxes cb
set
  current_balance = cb.opening_balance + coalesce(n.net, 0),
  updated_at = now()
from (
  select
    ct.cashbox_id,
    sum(case when ct.transaction_type = 'inflow' then ct.original_amount else -ct.original_amount end)::numeric as net
  from cashbox_transactions ct
  group by ct.cashbox_id
) n
where cb.id = n.cashbox_id;
