-- Opening balance / prior debt for account customers (ذمم افتتاحية)

alter table customers
  add column if not exists opening_balance_amount numeric(14, 2) not null default 0,
  add column if not exists opening_balance_side text not null default 'debit';

alter table customers drop constraint if exists customers_opening_balance_side_check;
alter table customers
  add constraint customers_opening_balance_side_check
  check (opening_balance_side in ('debit', 'credit'));

alter table customers drop constraint if exists customers_opening_balance_amount_check;
alter table customers
  add constraint customers_opening_balance_amount_check
  check (opening_balance_amount >= 0);

comment on column customers.opening_balance_amount is
  'رصيد أو دين سابق — المبلغ دائماً موجب';
comment on column customers.opening_balance_side is
  'debit = عليه (ذمة على العميل) | credit = له (ذمة للعميل)';

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
      'transfer_agent_commission',
      'customer_opening_balance'
    )
  );

create unique index if not exists ux_party_movement_customer_opening
  on party_financial_movements(party_type, party_id)
  where party_type = 'customer'
    and movement_type = 'customer_opening_balance'
    and is_reversal = false;
