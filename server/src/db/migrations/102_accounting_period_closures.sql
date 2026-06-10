-- إقفال فترات محاسبية — يمنع التعديل على الفترات المغلقة عند التفعيل.

create table if not exists accounting_period_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  period_start date not null,
  period_end date not null,
  currency_code varchar(3) not null default 'USD',
  closed_at timestamptz not null default now(),
  closed_by_user_id uuid references users(id) on delete set null,
  notes text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint accounting_period_closures_range_chk check (period_end >= period_start)
);

create unique index if not exists accounting_period_closures_company_branch_range_uidx
  on accounting_period_closures (company_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, upper(currency_code));

create index if not exists accounting_period_closures_company_closed_at_idx
  on accounting_period_closures (company_id, closed_at desc);

comment on table accounting_period_closures is 'إقفال فترات محاسبية — مرجع للمحاسب والتدقيق';
