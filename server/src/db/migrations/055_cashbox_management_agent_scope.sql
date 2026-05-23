-- Phase 2A.11: Cashbox master table, voucher linkage, granular finance permissions, agent-safe template

-- ─── cashboxes master ─────────────────────────────────────────────────────────

create table if not exists cashboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  code text not null,
  name text not null,
  type text not null check (type in ('COMPANY', 'BRANCH', 'AGENT')),
  currency_code text not null references currencies(code),
  opening_balance numeric(14, 2) not null default 0,
  current_balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_cashboxes_company_id on cashboxes(company_id);
create index if not exists idx_cashboxes_branch_id on cashboxes(branch_id) where branch_id is not null;
create index if not exists idx_cashboxes_agent_id on cashboxes(agent_id) where agent_id is not null;
create index if not exists idx_cashboxes_type on cashboxes(type);
create index if not exists idx_cashboxes_is_active on cashboxes(is_active);

alter table cashboxes
  add constraint chk_cashboxes_type_branch_agent check (
    (type = 'COMPANY' and branch_id is null and agent_id is null)
    or (type = 'BRANCH' and branch_id is not null and agent_id is null)
    or (type = 'AGENT' and agent_id is not null)
  );

-- ─── Link vouchers and movements to cashboxes ─────────────────────────────────

alter table receipt_vouchers
  add column if not exists cashbox_id uuid references cashboxes(id) on delete set null;

alter table payment_vouchers
  add column if not exists cashbox_id uuid references cashboxes(id) on delete set null;

alter table cashbox_transactions
  add column if not exists cashbox_id uuid references cashboxes(id) on delete set null;

create index if not exists idx_receipt_vouchers_cashbox_id on receipt_vouchers(cashbox_id) where cashbox_id is not null;
create index if not exists idx_payment_vouchers_cashbox_id on payment_vouchers(cashbox_id) where cashbox_id is not null;
create index if not exists idx_cashbox_transactions_cashbox_id on cashbox_transactions(cashbox_id) where cashbox_id is not null;

-- ─── Ensure base currencies exist before inserting cashbox ───────────────────
-- (currencies are normally seeded after migrations, so we must ensure USD exists here)
insert into currencies(code, name, symbol, decimal_places, is_base, is_active, company_id)
select v.code, v.name, v.symbol, v.decimal_places, v.is_base, v.is_active, comp.id
from (
  values
    ('USD', 'دولار أمريكي', '$',   2, true,  true),
    ('SYP', 'ليرة سورية',   'ل.س', 2, false, true),
    ('TRY', 'ليرة تركية',   '₺',   2, false, true)
) as v(code, name, symbol, decimal_places, is_base, is_active)
cross join (select id from companies where code = 'COMP-DEFAULT' limit 1) as comp
on conflict (code) do nothing;

-- ─── Default company HQ cashbox per active company (for legacy auto-vouchers) ─

insert into cashboxes (company_id, code, name, type, currency_code, opening_balance, current_balance, is_active, created_at, updated_at)
select c.id, 'HQ-USD', 'صندوق الشركة (افتراضي)', 'COMPANY', 'USD', 0, 0, true, now(), now()
from companies c
where c.is_active = true
on conflict (company_id, code) do nothing;

-- ─── New permission codes ─────────────────────────────────────────────────────

insert into permissions(code, name, module, action, is_active)
values
  ('finance.cashboxes.view', 'عرض تعريف الصناديق', 'finance_cashboxes', 'read', true),
  ('finance.cashboxes.manage', 'إدارة الصناديق', 'finance_cashboxes', 'write', true),
  ('finance.cashboxes.movements.view', 'عرض حركات الصندوق', 'finance_cashboxes', 'read', true),
  ('finance.vouchers.create', 'إنشاء السندات المالية', 'finance_vouchers', 'create', true),
  ('finance.vouchers.view', 'عرض السندات المالية', 'finance_vouchers', 'read', true),
  ('finance.vouchers.update', 'تعديل السندات المالية', 'finance_vouchers', 'update', true),
  ('finance.vouchers.delete', 'حذف السندات المالية', 'finance_vouchers', 'delete', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = true,
  updated_at = now();

-- Mirror legacy cashbox.read → view + movements.view
insert into role_permissions(role_id, permission_id, permission_code)
select distinct rp.role_id, p_new.id, p_new.code
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id
join permissions p_new on p_new.code in ('finance.cashboxes.view', 'finance.cashboxes.movements.view')
where p_old.code = 'finance.cashbox.read'
on conflict (role_id, permission_id) do update set permission_code = excluded.permission_code;

-- Mirror legacy cashbox.write → manage
insert into role_permissions(role_id, permission_id, permission_code)
select distinct rp.role_id, p_new.id, p_new.code
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id
join permissions p_new on p_new.code = 'finance.cashboxes.manage'
where p_old.code = 'finance.cashbox.write'
on conflict (role_id, permission_id) do update set permission_code = excluded.permission_code;

-- Mirror vouchers.read → vouchers.view (additive; keeps read on roles that still have it)
insert into role_permissions(role_id, permission_id, permission_code)
select distinct rp.role_id, p_new.id, p_new.code
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id
join permissions p_new on p_new.code = 'finance.vouchers.view'
where p_old.code = 'finance.vouchers.read'
on conflict (role_id, permission_id) do update set permission_code = excluded.permission_code;

-- Mirror vouchers.write → create + update
insert into role_permissions(role_id, permission_id, permission_code)
select distinct rp.role_id, p_new.id, p_new.code
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id
cross join lateral (values ('finance.vouchers.create'), ('finance.vouchers.update')) as x(code)
join permissions p_new on p_new.code = x.code
where p_old.code = 'finance.vouchers.write'
on conflict (role_id, permission_id) do update set permission_code = excluded.permission_code;

-- ─── Agent mini-ERP template: scoped cashbox + vouchers, no manage/update/delete globals ───

with template(role_code, permission_codes) as (
  values
    ('agent_user', array[
      'agent_workspace.view',
      'agent_portal.view','agent_portal.status_action',
      'shipments.view','shipments.read','shipments.write','shipments.create','shipments.update',
      'shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived',
      'shipments.out_for_delivery','shipments.deliver',
      'deliveries.read',
      'parties.view','parties.manage',
      'drivers.view','vehicles.view',
      'finance.read','finance.view',
      'finance.vouchers.view','finance.vouchers.create',
      'finance.cashboxes.view','finance.cashboxes.movements.view'
    ]::text[])
),
target_roles as (
  select r.id, r.code, t.permission_codes
  from roles r
  join template t on t.role_code = r.code
),
removed as (
  delete from role_permissions rp
  using target_roles tr
  where rp.role_id = tr.id
    and coalesce(rp.permission_code, (select p.code from permissions p where p.id = rp.permission_id)) <> all(tr.permission_codes)
  returning rp.role_id
),
expanded as (
  select tr.id role_id, p.id permission_id, p.code permission_code
  from target_roles tr
  join permissions p on p.code = any(tr.permission_codes)
)
insert into role_permissions(role_id, permission_id, permission_code)
select role_id, permission_id, permission_code
from expanded
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;

-- Ensure admin retains full cashbox + voucher ACL on new codes
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'finance.cashboxes.view',
  'finance.cashboxes.manage',
  'finance.cashboxes.movements.view',
  'finance.vouchers.view',
  'finance.vouchers.create',
  'finance.vouchers.update',
  'finance.vouchers.delete'
)
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
