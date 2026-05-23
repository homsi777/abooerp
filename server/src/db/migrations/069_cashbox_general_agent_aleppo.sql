-- صناديق: الصندوق العام + صندوق لكل وكيل + صندوق فرع حلب فقط؛ باقي صناديق الفروع تُعطّل.
-- parent_cashbox_id: ربط الصناديق الفرعية بالصندوق العام للتجميع والتقارير.

alter table cashboxes
  add column if not exists parent_cashbox_id uuid references cashboxes(id) on delete set null;

create index if not exists idx_cashboxes_parent_id
  on cashboxes(parent_cashbox_id)
  where parent_cashbox_id is not null;

comment on column cashboxes.parent_cashbox_id is 'الصندوق العام أو الأب الذي تُجمّع تحته حركات هذا الصندوق (تقارير)';

-- 1) ضمان وجود صندوق شركة USD واحد على الأقل لكل شركة (الصندوق العام)
insert into cashboxes (
  company_id, branch_id, agent_id,
  code, name, type,
  currency_code, opening_balance, current_balance,
  is_active, notes, created_at, updated_at
)
select
  c.id,
  null,
  null,
  'CASH-GENERAL-USD',
  'الصندوق العام',
  'COMPANY',
  'USD',
  0,
  0,
  true,
  'صندوق مركزي؛ صناديق الوكلاء وفرع حلب مرتبطة به للتجميع',
  now(),
  now()
from companies c
where not exists (
  select 1
  from cashboxes cb
  where cb.company_id = c.id
    and cb.type = 'COMPANY'
    and cb.currency_code = 'USD'
)
on conflict (company_id, code) do nothing;

-- 2) تعطيل صناديق الفروع غير حلب
update cashboxes cb
set
  is_active = false,
  updated_at = now()
where cb.type = 'BRANCH'
  and cb.branch_id is not null
  and exists (
    select 1 from branches b
    where b.id = cb.branch_id
      and b.code is distinct from 'BR-ALEPPO'
  );

-- 3) ربط parent_cashbox_id للوكلاء وفرع حلب → أول صندوق COMPANY USD للشركة (يفضّل CASH-GENERAL-USD)
with general as (
  select distinct on (company_id)
    company_id,
    id as general_id
  from cashboxes
  where type = 'COMPANY'
    and currency_code = 'USD'
    and is_active = true
  order by
    company_id,
    case when code = 'CASH-GENERAL-USD' then 0 else 1 end,
    created_at
)
update cashboxes cb
set
  parent_cashbox_id = g.general_id,
  updated_at = now()
from general g
where cb.company_id = g.company_id
  and cb.parent_cashbox_id is null
  and (
    cb.type = 'AGENT'
    or (
      cb.type = 'BRANCH'
      and exists (select 1 from branches b where b.id = cb.branch_id and b.code = 'BR-ALEPPO')
    )
  );

-- 4) إنشاء صندوق وكيل لأي وكيل نشط بلا صندوق AGENT
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
  'أُنشئ تلقائياً (ترحيل 069)',
  gen.general_id,
  now(),
  now()
from agents a
join branches b on b.id = a.branch_id
cross join lateral (
  select c.id as general_id
  from cashboxes c
  where c.company_id = b.company_id
    and c.type = 'COMPANY'
    and c.currency_code = 'USD'
    and c.is_active = true
  order by
    case when c.code = 'CASH-GENERAL-USD' then 0 else 1 end,
    c.created_at
  limit 1
) gen
where a.is_active = true
  and not exists (
    select 1 from cashboxes x
    where x.agent_id = a.id and x.type = 'AGENT'
  )
on conflict (company_id, code) do nothing;
