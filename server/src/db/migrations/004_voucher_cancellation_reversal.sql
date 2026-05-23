alter table cashbox_transactions
  add column if not exists is_reversal boolean not null default false,
  add column if not exists reversal_of_cashbox_transaction_id uuid references cashbox_transactions(id);

alter table party_financial_movements
  add column if not exists is_reversal boolean not null default false,
  add column if not exists reversal_of_movement_id uuid references party_financial_movements(id);

alter table cashbox_transactions
  drop constraint if exists cashbox_transactions_source_voucher_type_source_voucher_id_key;

alter table party_financial_movements
  drop constraint if exists party_financial_movements_voucher_type_voucher_id_party_type_party_id_key;

create unique index if not exists ux_cashbox_voucher_non_reversal
  on cashbox_transactions(source_voucher_type, source_voucher_id)
  where is_reversal = false;

create unique index if not exists ux_cashbox_reversal_origin
  on cashbox_transactions(reversal_of_cashbox_transaction_id)
  where reversal_of_cashbox_transaction_id is not null;

create unique index if not exists ux_party_movement_non_reversal
  on party_financial_movements(voucher_type, voucher_id, party_type, party_id)
  where is_reversal = false;

create unique index if not exists ux_party_movement_reversal_origin
  on party_financial_movements(reversal_of_movement_id)
  where reversal_of_movement_id is not null;
