-- 113: أساس إلغاء حفظ إرساليات الدفتر — سجل عملية + استعادة المواضع + صلاحية الإلغاء

create table if not exists daily_ledger_dispatch_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid not null references branches(id),
  dispatch_id uuid references daily_ledger_dispatch_definitions(id) on delete set null,
  save_log_id uuid references daily_ledger_dispatch_save_logs(id) on delete set null,
  operation_type text not null default 'SAVE'
    check (operation_type in ('SAVE', 'UNDO')),
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'UNDONE')),
  idempotency_key text,
  undo_of_operation_id uuid references daily_ledger_dispatch_operations(id) on delete set null,
  ledger_date date not null,
  line_label text not null default '',
  origin_label text,
  driver_id uuid references drivers(id),
  vehicle_id uuid references vehicles(id),
  driver_label text,
  vehicle_label text,
  trip_no text,
  save_mode text check (save_mode in ('all', 'custom')),
  request_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_dl_dispatch_ops_idempotency
  on daily_ledger_dispatch_operations(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_dl_dispatch_ops_company_date
  on daily_ledger_dispatch_operations(company_id, ledger_date desc, created_at desc);

create index if not exists idx_dl_dispatch_ops_save_log
  on daily_ledger_dispatch_operations(save_log_id)
  where save_log_id is not null;

create table if not exists daily_ledger_dispatch_operation_rows (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references daily_ledger_dispatch_operations(id) on delete cascade,
  row_id uuid not null references daily_ledger_rows(id) on delete cascade,
  row_existed_before boolean not null default true,
  before_session_id uuid,
  before_row_no integer,
  before_dispatch_id uuid,
  before_branch_id uuid,
  before_ledger_date date,
  before_line_label text,
  before_driver_id uuid,
  before_vehicle_id uuid,
  before_driver_label text,
  before_vehicle_label text,
  before_trip_no text,
  before_posted_shipment_id uuid,
  before_updated_at timestamptz,
  after_session_id uuid,
  after_row_no integer,
  after_dispatch_id uuid,
  after_branch_id uuid,
  after_ledger_date date,
  after_line_label text,
  after_driver_id uuid,
  after_vehicle_id uuid,
  after_driver_label text,
  after_vehicle_label text,
  after_trip_no text,
  after_posted_shipment_id uuid,
  after_updated_at timestamptz,
  shipment_id uuid,
  shipment_disposition text
    check (shipment_disposition is null or shipment_disposition in ('CREATED', 'REUSED', 'EXISTING_POSTED')),
  financial_posted_by_operation boolean not null default false,
  linked_transfer_id uuid,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id, row_id)
);

create index if not exists idx_dl_dispatch_op_rows_row
  on daily_ledger_dispatch_operation_rows(row_id);

create index if not exists idx_dl_dispatch_op_rows_shipment
  on daily_ledger_dispatch_operation_rows(shipment_id)
  where shipment_id is not null;

alter table daily_ledger_dispatch_save_logs
  add column if not exists operation_id uuid references daily_ledger_dispatch_operations(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references users(id),
  add column if not exists cancellation_reason text,
  add column if not exists undo_status text
    check (undo_status is null or undo_status in ('undoable', 'not_undoable', 'undone'));

create index if not exists idx_dl_dispatch_save_logs_operation
  on daily_ledger_dispatch_save_logs(operation_id)
  where operation_id is not null;

alter table party_financial_movements
  add column if not exists source_operation_id uuid references daily_ledger_dispatch_operations(id) on delete set null;

create index if not exists idx_pfm_source_operation
  on party_financial_movements(source_operation_id)
  where source_operation_id is not null;

alter table shipments
  add column if not exists source_operation_id uuid references daily_ledger_dispatch_operations(id) on delete set null;

create index if not exists idx_shipments_source_operation
  on shipments(source_operation_id)
  where source_operation_id is not null;

alter table transfers
  add column if not exists source_operation_id uuid references daily_ledger_dispatch_operations(id) on delete set null;

insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.dispatch_undo.execute', 'إلغاء حفظ إرسالية الدفتر', 'shipments', 'ledger_dispatch_undo', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'daily_ledger.dispatch_undo.execute'
where r.code in ('admin', 'general_manager', 'branch_manager', 'accountant', 'manager')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
