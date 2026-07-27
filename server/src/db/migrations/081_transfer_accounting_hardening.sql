-- Separate shipment hawala principal from generic additional charges.
-- Add lifecycle-safe transfer collection and payout posting links.

alter table shipments
  add column if not exists hawala_amount numeric(14, 2) not null default 0;

update shipments s
set hawala_amount = dlr.hawala_amount_usd,
    additional_charges = greatest(s.additional_charges - dlr.hawala_amount_usd, 0)
from daily_ledger_rows dlr
where dlr.posted_shipment_id = s.id
  and dlr.hawala_amount_usd > 0
  and s.hawala_amount = 0
  and s.additional_charges >= dlr.hawala_amount_usd;

comment on column shipments.hawala_amount is
  'أصل الحوالة المرتبطة بالشحنة، منفصل عن التحصيل وأجرة الشحن وأجرة خدمة الحوالة';

alter table transfers
  add column if not exists destination_city text,
  add column if not exists origin_agent_id uuid references agents(id) on delete set null,
  add column if not exists destination_agent_id uuid references agents(id) on delete set null,
  add column if not exists collection_cashbox_id uuid references cashboxes(id) on delete set null,
  add column if not exists collection_receipt_voucher_id uuid references receipt_vouchers(id) on delete set null,
  add column if not exists payout_cashbox_id uuid references cashboxes(id) on delete set null,
  add column if not exists payout_payment_voucher_id uuid references payment_vouchers(id) on delete set null,
  add column if not exists collected_at timestamptz,
  add column if not exists paid_out_at timestamptz;

update transfers
set destination_agent_id = agent_id
where destination_agent_id is null and agent_id is not null;

create unique index if not exists ux_transfers_collection_receipt_voucher_id
  on transfers(collection_receipt_voucher_id)
  where collection_receipt_voucher_id is not null;

create unique index if not exists ux_transfers_payout_payment_voucher_id
  on transfers(payout_payment_voucher_id)
  where payout_payment_voucher_id is not null;

create unique index if not exists ux_receipt_vouchers_transfer_collection
  on receipt_vouchers(company_id, related_entity_type, related_entity_id)
  where related_entity_type = 'transfer_collection' and related_entity_id is not null;

create unique index if not exists ux_payment_vouchers_transfer_payout
  on payment_vouchers(company_id, related_entity_type, related_entity_id)
  where related_entity_type = 'transfer_payout' and related_entity_id is not null;

alter table party_financial_movements drop constraint if exists party_financial_movements_movement_type_check;
alter table party_financial_movements
  add constraint party_financial_movements_movement_type_check
  check (
    movement_type in (
      'voucher_receipt',
      'voucher_payment',
      'shipment_charge',
      'shipment_shipping_fee',
      'sender_collection_trust',
      'loading_dues',
      'general_collection',
      'shipment_hawala_trust',
      'transfer_principal_collected',
      'transfer_service_fee_collected',
      'transfer_principal_paid',
      'transfer_agent_commission'
    )
  );

create unique index if not exists ux_party_movement_transfer_component
  on party_financial_movements(reference_id, movement_type, party_type, party_id)
  where is_reversal = false
    and reference_type = 'TRANSFER'
    and movement_type in (
      'transfer_principal_collected',
      'transfer_service_fee_collected',
      'transfer_principal_paid',
      'transfer_agent_commission'
    );

drop index if exists ux_party_movement_shipment_component;
create unique index if not exists ux_party_movement_shipment_component
  on party_financial_movements(shipment_id, movement_type, party_type, party_id)
  where is_reversal = false
    and movement_type in (
      'shipment_shipping_fee',
      'sender_collection_trust',
      'loading_dues',
      'general_collection',
      'shipment_hawala_trust'
    );

create index if not exists idx_transfers_origin_agent on transfers(origin_agent_id) where origin_agent_id is not null;
create index if not exists idx_transfers_destination_agent on transfers(destination_agent_id) where destination_agent_id is not null;

