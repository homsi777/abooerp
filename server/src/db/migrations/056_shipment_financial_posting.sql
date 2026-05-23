-- Phase 2B: Shipment financial posting — columns + party_financial_movements extensions

-- ─── shipments: financial tracking ─────────────────────────────────────────────

alter table shipments
  add column if not exists financial_status text not null default 'UNPOSTED',
  add column if not exists financial_posted_at timestamptz,
  add column if not exists financial_posted_by_user_id uuid references users(id),
  add column if not exists payer_party_kind text,
  add column if not exists payer_name_snapshot text,
  add column if not exists payment_status text,
  add column if not exists paid_amount numeric(14, 2) not null default 0,
  add column if not exists remaining_amount numeric(14, 2),
  add column if not exists default_cashbox_id uuid references cashboxes(id),
  add column if not exists financial_notes text;

alter table shipments drop constraint if exists shipments_financial_status_check;
alter table shipments
  add constraint shipments_financial_status_check check (
    financial_status in ('UNPOSTED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REVERSED')
  );

alter table shipments drop constraint if exists shipments_payment_status_check;
alter table shipments
  add constraint shipments_payment_status_check check (
    payment_status is null or payment_status in ('UNPAID', 'PARTIAL', 'PAID')
  );

alter table shipments drop constraint if exists shipments_payer_party_kind_check;
alter table shipments
  add constraint shipments_payer_party_kind_check check (
    payer_party_kind is null or payer_party_kind in ('SENDER', 'RECEIVER', 'CUSTOMER')
  );

create index if not exists idx_shipments_financial_status on shipments(financial_status) where deleted_at is null;
create index if not exists idx_shipments_payment_status on shipments(payment_status) where deleted_at is null;

comment on column shipments.payer_party_kind is 'SENDER | RECEIVER | CUSTOMER — resolves to sender_id/receiver_id/customer_id';

-- ─── party_financial_movements: shipment charges + nullable vouchers ─────────────

alter table party_financial_movements drop constraint if exists party_financial_movements_movement_type_check;
alter table party_financial_movements
  add constraint party_financial_movements_movement_type_check
  check (movement_type in ('voucher_receipt', 'voucher_payment', 'shipment_charge'));

alter table party_financial_movements drop constraint if exists party_financial_movements_voucher_type_check;
alter table party_financial_movements
  alter column voucher_type drop not null;

alter table party_financial_movements
  alter column voucher_id drop not null;

alter table party_financial_movements
  add constraint party_financial_movements_voucher_pair_check check (
    (voucher_type is null and voucher_id is null)
    or (
      voucher_type in ('receipt', 'payment')
      and voucher_id is not null
    )
  );

alter table party_financial_movements
  add column if not exists reference_type text,
  add column if not exists reference_id uuid,
  add column if not exists reference_no text,
  add column if not exists debit_amount numeric(14, 2) not null default 0,
  add column if not exists credit_amount numeric(14, 2) not null default 0,
  add column if not exists currency_code text,
  add column if not exists exchange_rate numeric(18, 8),
  add column if not exists cashbox_id uuid references cashboxes(id),
  add column if not exists payment_method text,
  add column if not exists posted_at timestamptz,
  add column if not exists reverse_reason text,
  add column if not exists metadata jsonb;

update party_financial_movements
set
  debit_amount = case when direction in ('debit', 'inflow') then original_amount else 0 end,
  credit_amount = case when direction in ('credit', 'outflow') then original_amount else 0 end,
  currency_code = coalesce(currency_code, original_currency),
  exchange_rate = coalesce(exchange_rate, exchange_rate_to_usd),
  posted_at = coalesce(posted_at, created_at)
where debit_amount = 0 and credit_amount = 0;

drop index if exists ux_party_movement_non_reversal;

create unique index if not exists ux_party_movement_voucher_non_reversal
  on party_financial_movements(voucher_type, voucher_id, party_type, party_id)
  where is_reversal = false and voucher_id is not null;

create unique index if not exists ux_party_movement_shipment_charge
  on party_financial_movements(shipment_id)
  where is_reversal = false and movement_type = 'shipment_charge';

create index if not exists idx_party_fin_movements_shipment_id on party_financial_movements(shipment_id) where shipment_id is not null;
create index if not exists idx_party_fin_movements_reference on party_financial_movements(reference_type, reference_id);
create index if not exists idx_party_fin_movements_cashbox on party_financial_movements(cashbox_id) where cashbox_id is not null;
create index if not exists idx_party_fin_movements_agent on party_financial_movements(agent_id) where agent_id is not null;
create index if not exists idx_party_fin_movements_branch on party_financial_movements(branch_id) where branch_id is not null;
create index if not exists idx_party_fin_movements_posted_at on party_financial_movements(posted_at);
create index if not exists idx_party_fin_movements_currency on party_financial_movements(original_currency);
