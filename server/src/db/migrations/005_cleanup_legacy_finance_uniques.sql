do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'u'
      and n.nspname = 'public'
      and t.relname = 'cashbox_transactions'
      and pg_get_constraintdef(c.oid) like 'UNIQUE (source_voucher_type, source_voucher_id)%'
  loop
    execute format('alter table cashbox_transactions drop constraint if exists %I', constraint_name);
  end loop;

  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'u'
      and n.nspname = 'public'
      and t.relname = 'party_financial_movements'
      and pg_get_constraintdef(c.oid) like 'UNIQUE (voucher_type, voucher_id, party_type, party_id)%'
  loop
    execute format('alter table party_financial_movements drop constraint if exists %I', constraint_name);
  end loop;
end $$;

drop index if exists ux_cashbox_voucher_non_reversal;
drop index if exists ux_cashbox_reversal_origin;
drop index if exists ux_party_movement_non_reversal;
drop index if exists ux_party_movement_reversal_origin;

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
