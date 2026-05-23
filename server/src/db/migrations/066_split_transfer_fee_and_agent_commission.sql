-- Migration 066: Split transfer financial semantics
-- transfer_fee in shipments = COD for sender (already separated in shipments table).
-- In transfers table, split ambiguous commission fields into explicit accounting fields.

alter table transfers
  add column if not exists agent_commission numeric(14, 2) not null default 0,
  add column if not exists agent_commission_currency varchar(10) not null default 'USD',
  add column if not exists agent_commission_main numeric(14, 2) not null default 0,
  add column if not exists transfer_service_fee numeric(14, 2) not null default 0,
  add column if not exists transfer_service_fee_currency varchar(10) not null default 'USD',
  add column if not exists transfer_service_fee_main numeric(14, 2) not null default 0,
  add column if not exists company_transfer_profit numeric(14, 2) not null default 0,
  add column if not exists company_transfer_profit_currency varchar(10) not null default 'USD',
  add column if not exists company_transfer_profit_main numeric(14, 2) not null default 0;

-- Backfill legacy "commission" as agent commission (current behavior in code before this migration).
update transfers
set
  agent_commission = commission,
  agent_commission_currency = commission_currency,
  agent_commission_main = commission_main
where
  (agent_commission = 0 and commission <> 0)
  or (agent_commission_main = 0 and commission_main <> 0);

comment on column transfers.agent_commission is
  'Agent commission amount for this transfer (not transfer service fee).';
comment on column transfers.transfer_service_fee is
  'Transfer service fee charged by company for money transfer service.';
comment on column transfers.company_transfer_profit is
  'Company net profit from transfer service for this record.';

