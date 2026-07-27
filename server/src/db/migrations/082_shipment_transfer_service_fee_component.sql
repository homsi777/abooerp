-- Keep the shipment-linked transfer service fee separate from shipping fees,
-- hawala principal, and sender collection trust.

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
      'shipment_transfer_service_fee',
      'transfer_principal_collected',
      'transfer_service_fee_collected',
      'transfer_principal_paid',
      'transfer_agent_commission'
    )
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
      'shipment_hawala_trust',
      'shipment_transfer_service_fee'
    );

