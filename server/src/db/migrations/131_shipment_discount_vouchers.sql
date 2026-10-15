-- 131_shipment_discount_vouchers.sql
-- حسم بعدي على شحنة واصلة: بعض المستلمين يطلبون حسماً عند الاستلام، فيوافق
-- الوكيل على مبلغ معيّن. هذا السند يُنقص المطلوب من الوكيل على هذه الشحنة
-- بالضبط (برقم إيصالها) حتى لا يُطالَب بالمبلغ المحسوم لاحقاً، ويظهر تلقائياً
-- في كشف العميل/الوكيل لأنه يُسجَّل في نفس دفتر party_financial_movements.

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
      'customer_opening_balance',
      'shipment_discount'
    )
  );

create table if not exists shipment_discount_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique,
  shipment_id uuid not null references shipments(id),
  shipment_no text not null,
  agent_id uuid references agents(id),
  branch_id uuid references branches(id),
  company_id uuid references companies(id),
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  notes text,
  party_financial_movement_id uuid references party_financial_movements(id),
  reversal_movement_id uuid references party_financial_movements(id),
  reversed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_shipment_discount_vouchers_shipment on shipment_discount_vouchers(shipment_id);
create index if not exists idx_shipment_discount_vouchers_created_at on shipment_discount_vouchers(created_at desc);

comment on table shipment_discount_vouchers is
  'سند حسم على شحنة واصلة — يُنشئ سطر credit في party_financial_movements بنفس المبلغ لإنقاص المطلوب من الوكيل على هذه الشحنة.';
