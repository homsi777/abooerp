-- 109: أرشيف توثيق طباعة دفتر الشحن — مرجع للمحاسب والمدير (سائق، جهة، تاريخ، تفاصيل الأسطر)

create table if not exists daily_ledger_print_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  ledger_date date not null,
  ledger_date_to date,
  line_label text,
  origin_label text,
  driver_id uuid references drivers(id),
  driver_label text,
  destination_label text,
  search_query text,
  print_type text not null default 'shipments',
  print_scope text,
  title text,
  row_count integer not null default 0,
  pieces_count integer not null default 0,
  weight_kg numeric(14, 2) not null default 0,
  collect_total_usd numeric(14, 2) not null default 0,
  prepaid_total_usd numeric(14, 2) not null default 0,
  hawala_total_usd numeric(14, 2) not null default 0,
  transfer_fee_total_usd numeric(14, 2) not null default 0,
  rows_snapshot jsonb not null default '[]'::jsonb,
  printed_by uuid references users(id),
  printed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_print_docs_company_date
  on daily_ledger_print_documents(company_id, ledger_date desc, printed_at desc);

create index if not exists idx_dl_print_docs_driver
  on daily_ledger_print_documents(company_id, driver_id, ledger_date desc);

create index if not exists idx_dl_print_docs_destination
  on daily_ledger_print_documents(company_id, destination_label, ledger_date desc);

insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.documentation.read', 'عرض توثيق طباعة دفتر الشحن', 'shipments', 'ledger_documentation_read', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.documentation.read'
where r.code in ('admin', 'general_manager', 'branch_manager', 'accountant', 'data_entry', 'manager')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
