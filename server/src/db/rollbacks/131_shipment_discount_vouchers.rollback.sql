drop table if exists shipment_discount_vouchers;

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
      'transfer_agent_commission',
      'customer_opening_balance'
    )
  );
