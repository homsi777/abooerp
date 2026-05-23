-- Migration 057: Correct financial responsibility model for shipments
-- Adds financial_responsibility_type and related fields.
-- Updates payer_party_kind constraint to include AGENT.
-- This corrects the model where sender/receiver were incorrectly used as financial ledger parties.

-- Add financial responsibility columns to shipments
alter table shipments
  add column if not exists financial_responsibility_type text,
  add column if not exists financial_responsibility_id   uuid,
  add column if not exists collection_owner_type         text,
  add column if not exists collection_cashbox_id         uuid;

-- Update payer_party_kind constraint to allow AGENT (backward-compatible)
alter table shipments drop constraint if exists shipments_payer_party_kind_check;
alter table shipments add constraint shipments_payer_party_kind_check check (
  payer_party_kind is null
  or payer_party_kind in ('SENDER', 'RECEIVER', 'CUSTOMER', 'AGENT')
);

-- Add constraint for financial_responsibility_type
alter table shipments drop constraint if exists shipments_financial_responsibility_type_check;
alter table shipments add constraint shipments_financial_responsibility_type_check check (
  financial_responsibility_type is null
  or financial_responsibility_type in ('AGENT', 'ACCOUNT_CUSTOMER', 'COMPANY_CASH', 'FREE')
);

-- Add constraint for collection_owner_type
alter table shipments drop constraint if exists shipments_collection_owner_type_check;
alter table shipments add constraint shipments_collection_owner_type_check check (
  collection_owner_type is null
  or collection_owner_type in ('COMPANY', 'BRANCH', 'AGENT', 'PENDING')
);

-- Indexes for lookups
create index if not exists idx_shipments_financial_responsibility_type
  on shipments(financial_responsibility_type)
  where financial_responsibility_type is not null;

create index if not exists idx_shipments_financial_responsibility_id
  on shipments(financial_responsibility_id)
  where financial_responsibility_id is not null;

-- Comment columns
comment on column shipments.financial_responsibility_type is
  'AGENT | ACCOUNT_CUSTOMER | COMPANY_CASH | FREE — who bears financial responsibility for the shipment fee';
comment on column shipments.financial_responsibility_id is
  'agent_id or customer_id depending on financial_responsibility_type';
comment on column shipments.collection_owner_type is
  'COMPANY | BRANCH | AGENT | PENDING — who collects the shipment cash';
comment on column shipments.collection_cashbox_id is
  'cashbox that received or will receive the cash payment';
