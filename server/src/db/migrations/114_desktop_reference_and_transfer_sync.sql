-- Keep desktop reference catalogs complete and mirror transfer state from the cloud.

alter table cashboxes
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0;

alter table transfers
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

  if tg_table_name in ('daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_print_documents','cashboxes','transfers') then
    row_company_id := nullif(row_data->>'company_id','')::uuid;
    row_branch_id := nullif(row_data->>'branch_id','')::uuid;
    row_agent_id := nullif(row_data->>'agent_id','')::uuid;
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
  foreach table_name in array array['cashboxes','transfers'] loop
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

-- Existing desktop installations need one replacement snapshot to receive the
-- full company agent catalog plus the newly mirrored cashboxes and transfers.
update sync_local_state
set resnapshot_required = true,
    updated_at = now()
where singleton = true
  and snapshot_initialized_at is not null;
