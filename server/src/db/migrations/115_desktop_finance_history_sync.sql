-- Mirror the complete authorised finance history onto offline-first desktop nodes.
-- These entities are central-owned on desktop: triggers only publish central changes,
-- while the local worker suppresses its feed/outbox during snapshot and pull apply.

alter table deliveries
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

alter table receipt_vouchers
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

alter table payment_vouchers
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

alter table cashbox_transactions
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

alter table party_financial_movements
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

create or replace function sync_capture_shipping_change()
returns trigger language plpgsql as $$
declare
  row_data jsonb;
  row_id uuid;
  row_company_id uuid;
  row_branch_id uuid;
  row_agent_id uuid;
  row_version bigint;
  source_device uuid;
  op text;
begin
  if coalesce(current_setting('app.node_role', true), 'disabled') <> 'central'
     or coalesce(current_setting('app.sync_suppress_feed', true), '0') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then row_data := to_jsonb(old); else row_data := to_jsonb(new); end if;
  row_id := (row_data->>'id')::uuid;
  row_version := coalesce((row_data->>'sync_version')::bigint, 0);
  source_device := nullif(current_setting('app.sync_device_id', true), '')::uuid;
  op := case when tg_op = 'DELETE' then 'DELETE' else 'UPSERT' end;

  if tg_table_name in (
    'daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_print_documents',
    'cashboxes','transfers','deliveries','receipt_vouchers','payment_vouchers','cashbox_transactions'
  ) then
    row_company_id := nullif(row_data->>'company_id','')::uuid;
    row_branch_id := nullif(row_data->>'branch_id','')::uuid;
    row_agent_id := nullif(row_data->>'agent_id','')::uuid;
  elsif tg_table_name = 'party_financial_movements' then
    row_branch_id := nullif(row_data->>'branch_id','')::uuid;
    row_agent_id := nullif(row_data->>'agent_id','')::uuid;
    if row_branch_id is not null then
      select company_id into row_company_id from branches where id=row_branch_id;
    end if;
    if row_company_id is null and nullif(row_data->>'cashbox_id','') is not null then
      select company_id into row_company_id from cashboxes where id=(row_data->>'cashbox_id')::uuid;
    end if;
    if row_company_id is null and nullif(row_data->>'shipment_id','') is not null then
      select company_id into row_company_id from shipments where id=(row_data->>'shipment_id')::uuid;
    end if;
    if row_company_id is null and row_data->>'voucher_type' = 'receipt' then
      select company_id into row_company_id from receipt_vouchers where id=nullif(row_data->>'voucher_id','')::uuid;
    elsif row_company_id is null and row_data->>'voucher_type' = 'payment' then
      select company_id into row_company_id from payment_vouchers where id=nullif(row_data->>'voucher_id','')::uuid;
    end if;
  elsif tg_table_name = 'daily_ledger_print_events' then
    row_company_id := (row_data->>'company_id')::uuid;
    if row_data->>'session_id' is not null then
      select branch_id into row_branch_id from daily_ledger_sessions where id=(row_data->>'session_id')::uuid;
    end if;
  elsif tg_table_name = 'daily_ledger_rows' then
    select company_id, branch_id into row_company_id, row_branch_id
    from daily_ledger_sessions where id=(row_data->>'session_id')::uuid;
  elsif tg_table_name = 'daily_ledger_row_transfers' then
    row_company_id := (row_data->>'company_id')::uuid;
    select branch_id into row_branch_id from daily_ledger_sessions
    where id=(row_data->>'target_session_id')::uuid;
  elsif tg_table_name = 'daily_ledger_row_transfer_items' then
    select t.company_id, s.branch_id into row_company_id, row_branch_id
    from daily_ledger_row_transfers t
    left join daily_ledger_sessions s on s.id=t.target_session_id
    where t.id=(row_data->>'transfer_id')::uuid;
  end if;

  if row_company_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  insert into sync_change_feed(
    company_id, branch_id, agent_id, entity_type, entity_id, operation_type,
    authoritative_version, authoritative_payload, source_device_id, tombstone
  ) values (
    row_company_id, row_branch_id, row_agent_id, tg_table_name, row_id, op,
    row_version, case when tg_op='DELETE' then null else row_data end,
    source_device, tg_op='DELETE'
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'deliveries','receipt_vouchers','payment_vouchers',
    'cashbox_transactions','party_financial_movements'
  ] loop
    execute format('drop trigger if exists trg_%I_sync_version on %I', table_name, table_name);
    execute format(
      'create trigger trg_%I_sync_version before update on %I for each row execute function sync_increment_row_version()',
      table_name, table_name
    );
    execute format('drop trigger if exists trg_%I_sync_feed on %I', table_name, table_name);
    execute format(
      'create trigger trg_%I_sync_feed after insert or update or delete on %I for each row execute function sync_capture_shipping_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

-- Existing local mirrors need one safe replacement snapshot to receive finance
-- history. The worker first drains the outbox and refuses replacement while any
-- unresolved local operation remains.
update sync_local_state
set resnapshot_required = true,
    updated_at = now()
where singleton = true
  and snapshot_initialized_at is not null;
