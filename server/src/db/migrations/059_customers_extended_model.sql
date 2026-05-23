-- Migration 059: Extend customers table with full customer model fields
-- Adds: company_id, agent_id, customer_type, is_account_customer, credit_limit,
--        default_currency_code, second_phone, company_name, area, tax_number, notes,
--        created_by_user_id

-- Add company_id for multi-tenancy
alter table customers
  add column if not exists company_id uuid references companies(id);

-- Backfill company_id from default company
update customers
set company_id = (select id from companies where code = 'COMP-DEFAULT' limit 1)
where company_id is null;

-- Add agent_id scope
alter table customers
  add column if not exists agent_id uuid references agents(id) on delete set null;

-- Add customer_type (INDIVIDUAL | COMPANY)
alter table customers
  add column if not exists customer_type text not null default 'INDIVIDUAL'
  check (customer_type in ('INDIVIDUAL', 'COMPANY'));

-- Account customer flag: allows ledger/Debit-Credit usage
alter table customers
  add column if not exists is_account_customer boolean not null default false;

-- Credit limit for account customers
alter table customers
  add column if not exists credit_limit numeric(14,2) not null default 0;

-- Default currency for account customer invoicing
alter table customers
  add column if not exists default_currency_code text not null default 'SYP';

-- Additional contact and address fields
alter table customers
  add column if not exists second_phone text;

alter table customers
  add column if not exists company_name text;

alter table customers
  add column if not exists area text;

alter table customers
  add column if not exists tax_number text;

alter table customers
  add column if not exists notes text;

-- Audit: who created this customer
alter table customers
  add column if not exists created_by_user_id uuid references users(id) on delete set null;

-- Indexes
create index if not exists idx_customers_company on customers(company_id);
create index if not exists idx_customers_agent on customers(agent_id);
create index if not exists idx_customers_is_account on customers(is_account_customer);
create index if not exists idx_customers_code on customers(code);
create index if not exists idx_customers_name on customers using gin(to_tsvector('simple', name));

-- Comments
comment on column customers.is_account_customer is
  'When true, customer may appear in Debit/Credit Center and Account Statement when used as financial responsibility party';
comment on column customers.customer_type is
  'INDIVIDUAL = natural person, COMPANY = legal entity/company';
comment on column customers.credit_limit is
  'Maximum outstanding balance allowed for account customers (0 = unlimited)';

-- ============================================================
-- Permissions for customers module
-- ============================================================
insert into permissions(code, name, module, action, is_active)
values
  ('customers.view',           'View customers',                    'customers', 'read',   true),
  ('customers.manage',         'Create/edit customers',             'customers', 'write',  true),
  ('customers.account.view',   'View account customer balances',    'customers', 'read',   true),
  ('customers.account.manage', 'Manage account customer settings',  'customers', 'write',  true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

-- Grant all customer permissions to admin role
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'customers.view',
  'customers.manage',
  'customers.account.view',
  'customers.account.manage'
)
where r.code = 'admin'
on conflict do nothing;

-- Grant view + manage to operator (data-entry)
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'customers.view',
  'customers.manage'
)
where r.code = 'operator'
on conflict do nothing;

-- Grant view to agent (scoped in backend)
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'customers.view',
  'customers.manage'
)
where r.code = 'agent'
on conflict do nothing;

-- Grant account-related to accountant
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'customers.view',
  'customers.account.view',
  'customers.account.manage'
)
where r.code = 'accountant'
on conflict do nothing;

-- Grant view to viewer
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'customers.view'
)
where r.code = 'viewer'
on conflict do nothing;
