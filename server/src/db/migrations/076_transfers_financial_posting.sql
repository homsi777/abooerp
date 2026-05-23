-- Migration 076: Transfer financial posting (V2)
-- Adds lifecycle-safe posting links for transfer service fee.

alter table transfers
  add column if not exists posted_cashbox_id uuid references cashboxes(id) on delete set null,
  add column if not exists receipt_voucher_id uuid references receipt_vouchers(id) on delete set null,
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by_user_id uuid references users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references users(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table transfers drop constraint if exists transfers_status_check;
alter table transfers
  add constraint transfers_status_check
  check (status in ('PENDING', 'COMPLETED', 'CANCELLED'));

create unique index if not exists ux_transfers_receipt_voucher_id
  on transfers(receipt_voucher_id)
  where receipt_voucher_id is not null;

create unique index if not exists ux_receipt_vouchers_transfer_entity
  on receipt_vouchers(company_id, related_entity_type, related_entity_id)
  where related_entity_type = 'transfer' and related_entity_id is not null;

create index if not exists idx_transfers_posted_at on transfers(posted_at) where posted_at is not null;
create index if not exists idx_transfers_posted_cashbox on transfers(posted_cashbox_id) where posted_cashbox_id is not null;
