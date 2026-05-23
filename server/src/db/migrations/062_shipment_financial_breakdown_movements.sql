-- Phase 2B hardening: shipment financial breakdown ledger movements.
-- Keeps legacy shipment_charge for historical rows, but new postings use explicit components.

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
      'general_collection'
    )
  );

create unique index if not exists ux_party_movement_shipment_component
  on party_financial_movements(shipment_id, movement_type, party_type, party_id)
  where is_reversal = false
    and movement_type in (
      'shipment_shipping_fee',
      'sender_collection_trust',
      'loading_dues',
      'general_collection'
    );

create index if not exists idx_party_fin_movements_breakdown_type
  on party_financial_movements(movement_type)
  where movement_type in (
    'shipment_shipping_fee',
    'sender_collection_trust',
    'loading_dues',
    'general_collection'
  );
