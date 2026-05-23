-- Migration 077: Transfer service fee (V3)
-- Adds a dedicated transfer service fee column on shipments and daily ledger rows.

alter table shipments
  add column if not exists transfer_service_fee numeric(14, 2) not null default 0;

create index if not exists idx_shipments_transfer_service_fee
  on shipments(transfer_service_fee)
  where transfer_service_fee > 0;

comment on column shipments.transfer_service_fee is 'أجرة الحوالة — company profit (posted via Transfers V2)';

alter table daily_ledger_rows
  add column if not exists transfer_service_fee_usd numeric(14, 2) not null default 0;

comment on column daily_ledger_rows.transfer_service_fee_usd is 'أجرة الحوالة — transfer service fee in USD';
