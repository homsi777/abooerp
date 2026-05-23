-- Migration 058: Add shipment fee breakdown columns
-- Separates freight charge, sender collection amount (COD), extra charges, prepaid, and discount
-- so the Agent COD Statement can display each component distinctly.

alter table shipments
  add column if not exists freight_charge     numeric(14, 2) not null default 0,
  add column if not exists transfer_fee       numeric(14, 2) not null default 0,
  add column if not exists additional_charges numeric(14, 2) not null default 0,
  add column if not exists prepaid_amount     numeric(14, 2) not null default 0,
  add column if not exists discount_amount    numeric(14, 2) not null default 0;

-- Back-fill existing rows: assume original_amount was entirely freight charge
update shipments
set freight_charge = original_amount
where freight_charge = 0 and original_amount > 0;

-- Indexes for COD statement queries
create index if not exists idx_shipments_transfer_fee
  on shipments(transfer_fee)
  where transfer_fee > 0;

create index if not exists idx_shipments_freight_charge
  on shipments(freight_charge)
  where freight_charge > 0;

comment on column shipments.freight_charge     is 'أجور الشحن — shipping fee belonging to the company';
comment on column shipments.transfer_fee       is 'تحصيل لصالح المرسل — COD amount to be collected for the sender';
comment on column shipments.additional_charges is 'مستحقات إضافية / تحميل — extra loading or handling fees';
comment on column shipments.prepaid_amount     is 'المدفوع مسبقاً — prepaid before delivery';
comment on column shipments.discount_amount    is 'خصم — discount applied to freight charge';
