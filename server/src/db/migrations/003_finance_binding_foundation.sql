create table if not exists receipt_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique,
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  shipment_id uuid references shipments(id),
  delivery_id uuid references deliveries(id),
  customer_id uuid references customers(id),
  sender_receiver_id uuid references senders_receivers(id),
  related_entity_type text,
  related_entity_id uuid,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  notes text,
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id)
);

create table if not exists payment_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique,
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  shipment_id uuid references shipments(id),
  delivery_id uuid references deliveries(id),
  customer_id uuid references customers(id),
  sender_receiver_id uuid references senders_receivers(id),
  related_entity_type text,
  related_entity_id uuid,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  notes text,
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cashbox_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('inflow', 'outflow')),
  source_voucher_type text not null check (source_voucher_type in ('receipt', 'payment')),
  source_voucher_id uuid not null,
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  shipment_id uuid references shipments(id),
  delivery_id uuid references deliveries(id),
  notes text,
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (source_voucher_type, source_voucher_id)
);

create table if not exists party_financial_movements (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('customer', 'sender_receiver', 'agent')),
  party_id uuid not null,
  movement_type text not null check (movement_type in ('voucher_receipt', 'voucher_payment')),
  voucher_type text not null check (voucher_type in ('receipt', 'payment')),
  voucher_id uuid not null,
  shipment_id uuid references shipments(id),
  delivery_id uuid references deliveries(id),
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  direction text not null check (direction in ('debit', 'credit', 'inflow', 'outflow')),
  notes text,
  original_amount numeric(14, 2) not null default 0,
  original_currency text not null references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null default 0,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (voucher_type, voucher_id, party_type, party_id)
);

create index if not exists idx_receipt_vouchers_branch on receipt_vouchers(branch_id);
create index if not exists idx_receipt_vouchers_delivery on receipt_vouchers(delivery_id);
create index if not exists idx_payment_vouchers_branch on payment_vouchers(branch_id);
create index if not exists idx_cashbox_transactions_branch on cashbox_transactions(branch_id);
create index if not exists idx_party_fin_movements_party on party_financial_movements(party_type, party_id);

insert into permissions(code, name, module, action, is_active)
values
('finance.read', 'Read finance module', 'finance', 'read', true),
('finance.write', 'Write finance module', 'finance', 'write', true),
('finance.vouchers.read', 'Read finance vouchers', 'finance_vouchers', 'read', true),
('finance.vouchers.write', 'Write finance vouchers', 'finance_vouchers', 'write', true),
('finance.cashbox.read', 'Read cashbox transactions', 'finance_cashbox', 'read', true),
('finance.cashbox.write', 'Write cashbox transactions', 'finance_cashbox', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'finance.read',
  'finance.write',
  'finance.vouchers.read',
  'finance.vouchers.write',
  'finance.cashbox.read',
  'finance.cashbox.write'
)
where r.code in ('admin', 'accountant')
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'finance.read',
  'finance.vouchers.read',
  'finance.vouchers.write',
  'finance.cashbox.read'
)
where r.code = 'operator'
on conflict do nothing;
