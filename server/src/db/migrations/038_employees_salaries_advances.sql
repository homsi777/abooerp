-- Phase: Salaries & Advances Module
-- Creates: employees, salary_records, employee_advances + permissions

-- ─── employees ────────────────────────────────────────────────────────────────

create table if not exists employees (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  branch_id       uuid references branches(id) on delete set null,
  code            text not null,
  name            text not null,
  position        text,
  basic_salary    numeric(14,2) not null default 0
                    check (basic_salary >= 0),
  currency        text not null default 'USD',
  hire_date       date,
  phone           text,
  notes           text,
  is_active       boolean not null default true,
  deleted_at      timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_employees_company        on employees(company_id);
create index if not exists idx_employees_company_branch on employees(company_id, branch_id);
create index if not exists idx_employees_active
  on employees(company_id, is_active)
  where deleted_at is null;

-- ─── salary_records ───────────────────────────────────────────────────────────

create table if not exists salary_records (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  branch_id       uuid references branches(id) on delete set null,
  employee_id     uuid not null references employees(id) on delete cascade,
  period_year     integer not null check (period_year between 2000 and 2100),
  period_month    integer not null check (period_month between 1 and 12),
  basic_amount    numeric(14,2) not null check (basic_amount >= 0),
  bonuses         numeric(14,2) not null default 0 check (bonuses >= 0),
  deductions      numeric(14,2) not null default 0 check (deductions >= 0),
  net_amount      numeric(14,2) generated always as (basic_amount + bonuses - deductions) stored,
  currency        text not null default 'USD',
  payment_status  text not null default 'pending'
                    check (payment_status in ('pending', 'paid', 'cancelled')),
  paid_at         timestamptz null,
  notes           text,
  created_by      uuid references users(id),
  deleted_at      timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, period_year, period_month)
);

create index if not exists idx_salary_records_company      on salary_records(company_id);
create index if not exists idx_salary_records_employee     on salary_records(employee_id);
create index if not exists idx_salary_records_period
  on salary_records(company_id, period_year, period_month)
  where deleted_at is null;
create index if not exists idx_salary_records_status
  on salary_records(company_id, payment_status)
  where deleted_at is null;

-- ─── employee_advances ────────────────────────────────────────────────────────

create table if not exists employee_advances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  branch_id       uuid references branches(id) on delete set null,
  employee_id     uuid not null references employees(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  repaid_amount   numeric(14,2) not null default 0
                    check (repaid_amount >= 0),
  currency        text not null default 'USD',
  advance_date    date not null default current_date,
  expected_repay  date null,
  status          text not null default 'pending'
                    check (status in ('pending', 'partially_repaid', 'repaid', 'cancelled')),
  notes           text,
  created_by      uuid references users(id),
  deleted_at      timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- repaid_amount can never exceed advance amount
  constraint advance_repaid_lte_amount check (repaid_amount <= amount)
);

create index if not exists idx_advances_company      on employee_advances(company_id);
create index if not exists idx_advances_employee     on employee_advances(employee_id);
create index if not exists idx_advances_status
  on employee_advances(company_id, status)
  where deleted_at is null;

-- ─── permissions ──────────────────────────────────────────────────────────────

insert into permissions(code, name, module, action, is_active) values
  ('hr.employees.read',   'Read employees',        'hr', 'read',   true),
  ('hr.employees.write',  'Write employees',       'hr', 'write',  true),
  ('hr.salaries.read',    'Read salary records',   'hr', 'read',   true),
  ('hr.salaries.write',   'Write salary records',  'hr', 'write',  true),
  ('hr.advances.read',    'Read advances',         'hr', 'read',   true),
  ('hr.advances.write',   'Write advances',        'hr', 'write',  true)
on conflict (code) do update set
  name      = excluded.name,
  module    = excluded.module,
  action    = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'hr.employees.read', 'hr.employees.write',
  'hr.salaries.read',  'hr.salaries.write',
  'hr.advances.read',  'hr.advances.write'
)
where r.code in ('admin', 'accountant')
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'hr.employees.read', 'hr.salaries.read', 'hr.advances.read'
)
where r.code = 'operator'
on conflict do nothing;
