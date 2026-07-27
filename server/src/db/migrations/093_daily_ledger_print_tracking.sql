-- 093: تتبّع طباعة دفتر الشحن + علامة "أعد الطباعة" + صلاحيات التصحيح بتاريخ سابق
-- غير هدّامة: تضيف أعمدة وجداول وصلاحيات فقط، لا تحذف ولا تعدّل بيانات قائمة.

alter table daily_ledger_sessions
  add column if not exists printed_at timestamptz,
  add column if not exists printed_by uuid references users(id),
  add column if not exists print_count integer not null default 0,
  add column if not exists last_printed_at timestamptz,
  add column if not exists reprint_required boolean not null default false,
  add column if not exists reprint_reason text;

create index if not exists idx_dl_sessions_reprint
  on daily_ledger_sessions(company_id, reprint_required)
  where reprint_required = true and deleted_at is null;

create table if not exists daily_ledger_print_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  session_id uuid references daily_ledger_sessions(id),
  print_type text not null default 'session',
  print_scope text,
  row_count integer not null default 0,
  pieces_count integer not null default 0,
  weight_kg numeric(14, 2) not null default 0,
  printed_by uuid references users(id),
  printed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_dl_print_events_company
  on daily_ledger_print_events(company_id, printed_at desc);

create index if not exists idx_dl_print_events_session
  on daily_ledger_print_events(session_id);

-- صلاحيات التصحيح بتاريخ سابق وإعادة الطباعة
insert into permissions(code, name, module, action, is_active)
values
  ('daily_ledger.backdate.create', 'إضافة إيصال ناقص بتاريخ سابق', 'shipments', 'ledger_backdate_create', true),
  ('daily_ledger.print.reprint', 'إعادة طباعة دفتر الشحن', 'shipments', 'ledger_print_reprint', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code in (
  'daily_ledger.backdate.create',
  'daily_ledger.print.reprint'
)
where r.code in ('admin', 'general_manager', 'branch_manager', 'data_entry')
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
