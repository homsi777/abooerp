-- 111: سجل حفظ إرساليات دفتر الشحن — مرجع للمدير والمحاسبة (تدقيق، وجهات، مبالغ، أوزان، طباعة)

create table if not exists daily_ledger_dispatch_save_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  dispatch_id uuid references daily_ledger_dispatch_definitions(id) on delete set null,
  dispatch_no integer,
  ledger_date date not null,
  line_label text not null default '',
  origin_label text,
  driver_id uuid references drivers(id),
  vehicle_id uuid references vehicles(id),
  driver_label text,
  vehicle_label text,
  trip_no text,
  destination_label text,
  save_mode text not null default 'all' check (save_mode in ('all', 'custom')),
  row_count integer not null default 0,
  pieces_count integer not null default 0,
  weight_kg numeric(14, 2) not null default 0,
  collect_total_usd numeric(14, 2) not null default 0,
  prepaid_total_usd numeric(14, 2) not null default 0,
  hawala_total_usd numeric(14, 2) not null default 0,
  transfer_fee_total_usd numeric(14, 2) not null default 0,
  posted_count integer not null default 0,
  error_count integer not null default 0,
  skipped_count integer not null default 0,
  receipt_nos text[] not null default '{}',
  row_ids uuid[] not null default '{}',
  rows_snapshot jsonb not null default '[]'::jsonb,
  outcome text check (outcome in ('success', 'partial', 'failed')),
  summary text,
  saved_by uuid references users(id),
  saved_at timestamptz not null default now(),
  printed_at timestamptz,
  print_document_id uuid references daily_ledger_print_documents(id) on delete set null,
  print_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_dispatch_save_logs_company_date
  on daily_ledger_dispatch_save_logs(company_id, ledger_date desc, saved_at desc);

create index if not exists idx_dl_dispatch_save_logs_dispatch
  on daily_ledger_dispatch_save_logs(company_id, dispatch_id, saved_at desc)
  where dispatch_id is not null;

create index if not exists idx_dl_dispatch_save_logs_driver
  on daily_ledger_dispatch_save_logs(company_id, driver_id, ledger_date desc);

insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.dispatch_save.read', 'عرض سجل حفظ إرساليات الدفتر', 'shipments', 'ledger_dispatch_save_read', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.dispatch_save.read'
where r.code in ('admin', 'general_manager', 'branch_manager', 'accountant', 'data_entry', 'manager')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
