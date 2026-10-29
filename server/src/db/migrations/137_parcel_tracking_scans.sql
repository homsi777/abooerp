-- Parcel receive/deliver tracking driven by the QR code printed on the
-- tablet label. Three independent additions, all purely additive — no
-- DROP/TRUNCATE/DELETE anywhere, and safe to re-run (every statement is
-- IF NOT EXISTS / ON CONFLICT DO NOTHING). The migration runner wraps this
-- file in BEGIN/COMMIT already.
--
-- ROLLBACK (manual, not auto-applied), in order:
--   drop table if exists parcel_scan_events;
--   alter table daily_ledger_rows drop column if exists parcel_status;
--   alter table daily_ledger_rows drop column if exists delivered_to_name;
--   alter table daily_ledger_rows drop column if exists tablet_receipt_no;
--   drop sequence if exists tablet_receipt_no_seq;

-- 1. Central receipt numbering for the Android data-entry app.
--
-- Receipt numbers used to be free text, optional, and non-unique: an empty
-- one fell back to the row number, so "15" could mean a different shipment
-- in every branch on every day. That is fine while a human reads it off a
-- page, but the QR code now has to resolve to exactly ONE shipment or a
-- scan could mark the wrong parcel delivered. So tablet-issued numbers come
-- from one shared sequence starting at 40000 and are unique company-wide.
--
-- Deliberately only for the tablet: agents still working on paper keep
-- their own numbering in receipt_no, which is why this is a separate column
-- rather than a constraint on receipt_no itself.
create sequence if not exists tablet_receipt_no_seq start with 40000 increment by 1;

alter table daily_ledger_rows
  add column if not exists tablet_receipt_no bigint;

create unique index if not exists uq_daily_ledger_rows_tablet_receipt_no
  on daily_ledger_rows(tablet_receipt_no)
  where tablet_receipt_no is not null and deleted_at is null;

-- 2. Where the parcel currently is.
--
-- 'intake'     — handed over by the sender, not yet scanned into a warehouse
-- 'warehouse'  — scanned in at the origin branch
-- 'arrived'    — scanned in at the destination branch by the agent
-- 'delivered'  — handed to the receiver; terminal
alter table daily_ledger_rows
  add column if not exists parcel_status text not null default 'intake';

alter table daily_ledger_rows
  drop constraint if exists chk_daily_ledger_rows_parcel_status;
alter table daily_ledger_rows
  add constraint chk_daily_ledger_rows_parcel_status
  check (parcel_status in ('intake', 'warehouse', 'arrived', 'delivered'));

-- Who physically took the parcel. Defaults to the receiver on the shipment
-- but is editable at delivery time, since someone else often collects it.
alter table daily_ledger_rows
  add column if not exists delivered_to_name text;

create index if not exists idx_daily_ledger_rows_parcel_status
  on daily_ledger_rows(parcel_status)
  where deleted_at is null;

-- 3. Every scan, kept forever.
--
-- The status column above answers "where is it now"; this answers "who
-- moved it, when, and from which branch" — which is the entire point of
-- scanning. A delivered parcel is filtered out of the default view, never
-- deleted, so the proof of delivery survives any later dispute.
create table if not exists parcel_scan_events (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references daily_ledger_rows(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  branch_id uuid references branches(id),
  scanned_by uuid references users(id),
  delivered_to_name text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_parcel_scan_events_row
  on parcel_scan_events(row_id, created_at);

-- 4. Who is allowed to move a parcel along.
--
-- Deliberately its own permission rather than reusing shipments.write:
-- marking a parcel delivered is the company's proof that the goods left
-- its hands, and that is granted only to the tablet data-entry accounts
-- and to agents — not to every office user who can type a ledger row.
insert into permissions (code, name, module, action)
values ('parcels.scan', 'مسح وتسليم الطرود', 'shipments', 'scan')
on conflict (code) do nothing;

-- Granted by role code on purpose. Matching on "any role holding
-- agent_portal.view" was tried first and is too wide: it also catches
-- admin and any office role that happens to see the agent portal, whereas
-- delivery is meant to be exactly the tablet and the agent. If the agent
-- role carries a different code in a given environment, grant it there
-- from the permissions screen rather than widening this.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'parcels.scan'
where r.code in ('data_entry_mobile', 'agent_user')
on conflict do nothing;
