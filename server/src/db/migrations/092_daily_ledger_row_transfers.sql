-- 092: نقل إرسالية — جداول تتبع نقل أسطر دفتر الشحن بين الجلسات/السائقين/المركبات
-- يحافظ على هوية السطر والشحنة (لا ينشئ أثراً مالياً جديداً)، ويسجل عملية النقل للتدقيق.

create table if not exists daily_ledger_row_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  transfer_no text not null,
  source_session_id uuid references daily_ledger_sessions(id),
  target_session_id uuid not null references daily_ledger_sessions(id),
  old_driver_id uuid references drivers(id),
  new_driver_id uuid references drivers(id),
  old_vehicle_id uuid references vehicles(id),
  new_vehicle_id uuid references vehicles(id),
  old_ledger_date date,
  new_ledger_date date,
  reason text,
  rows_count integer not null default 0,
  pieces_count integer not null default 0,
  weight_kg numeric(14, 2) not null default 0,
  status text not null default 'completed',
  transferred_by uuid references users(id),
  transferred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_row_transfers_company
  on daily_ledger_row_transfers(company_id, transferred_at desc);

create index if not exists idx_dl_row_transfers_target_session
  on daily_ledger_row_transfers(target_session_id);

create index if not exists idx_dl_row_transfers_source_session
  on daily_ledger_row_transfers(source_session_id);

create table if not exists daily_ledger_row_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references daily_ledger_row_transfers(id) on delete cascade,
  row_id uuid not null references daily_ledger_rows(id),
  shipment_id uuid references shipments(id),
  receipt_no text,
  source_session_id uuid references daily_ledger_sessions(id),
  target_session_id uuid references daily_ledger_sessions(id),
  weight_kg numeric(14, 2),
  pieces_count integer,
  financial_posted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_row_transfer_items_transfer
  on daily_ledger_row_transfer_items(transfer_id);

create index if not exists idx_dl_row_transfer_items_row
  on daily_ledger_row_transfer_items(row_id);

-- أعمدة تتبع على السطر — تحافظ على الجلسة الأصلية وآخر عملية نقل
alter table daily_ledger_rows
  add column if not exists original_session_id uuid references daily_ledger_sessions(id),
  add column if not exists last_transfer_id uuid references daily_ledger_row_transfers(id),
  add column if not exists transfer_status text;

-- صلاحيات نقل الإرسالية
insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.transfer.create', 'إنشاء نقل إرسالية', 'shipments', 'ledger_transfer_create', true),
  ('daily_ledger.transfer.confirm', 'تأكيد نقل إرسالية', 'shipments', 'ledger_transfer_confirm', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

-- منح الصلاحية للأدوار المخوّلة
insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'daily_ledger.transfer.create',
  'daily_ledger.transfer.confirm'
)
where r.code in ('admin', 'general_manager', 'branch_manager', 'data_entry')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
