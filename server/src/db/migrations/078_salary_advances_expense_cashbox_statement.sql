-- 078: Salary advance deductions and salary payment accounting links.

alter table salary_records
  add column if not exists manual_deductions numeric(14,2) not null default 0 check (manual_deductions >= 0),
  add column if not exists advance_deductions numeric(14,2) not null default 0 check (advance_deductions >= 0),
  add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  add column if not exists salary_payment_voucher_id uuid references payment_vouchers(id) on delete set null,
  add column if not exists salary_cashbox_id uuid references cashboxes(id) on delete set null;

update salary_records
set manual_deductions = deductions
where manual_deductions = 0
  and advance_deductions = 0
  and deductions > 0;

create table if not exists salary_advance_deductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  salary_record_id uuid not null references salary_records(id) on delete cascade,
  employee_advance_id uuid not null references employee_advances(id),
  deducted_amount numeric(14,2) not null check (deducted_amount > 0),
  currency text not null,
  deducted_salary_amount numeric(14,2) not null check (deducted_salary_amount > 0),
  salary_currency text not null,
  exchange_rate_to_usd numeric(20,10) not null default 1,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (salary_record_id, employee_advance_id)
);

create index if not exists idx_salary_advance_deductions_salary
  on salary_advance_deductions(salary_record_id);

create index if not exists idx_salary_advance_deductions_advance
  on salary_advance_deductions(employee_advance_id);
