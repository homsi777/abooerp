-- Offline-first shipping sync foundation.
-- Safe to install on both central and local PostgreSQL nodes. Runtime behavior is
-- selected with the per-connection `app.node_role` setting (central/local/disabled).

alter table linked_devices
  add column if not exists registered_by uuid references users(id) on delete set null,
  add column if not exists app_version text,
  add column if not exists local_schema_version text,
  add column if not exists last_central_cursor bigint not null default 0,
  add column if not exists last_sync_success_at timestamptz,
  add column if not exists sync_state text not null default 'active',
  add column if not exists sync_secret_hash text,
  add column if not exists sync_credential_issued_at timestamptz;

alter table linked_devices drop constraint if exists linked_devices_sync_state_check;
alter table linked_devices
  add constraint linked_devices_sync_state_check
  check (sync_state in ('active', 'disabled', 'revoked'));

create table if not exists sync_local_state (
  singleton boolean primary key default true check (singleton),
  device_id uuid not null unique,
  device_name text not null default 'desktop-node',
  app_version text,
  schema_version text,
  last_central_cursor bigint not null default 0,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  last_successful_sync_at timestamptz,
  offline_grant_expires_at timestamptz,
  snapshot_initialized_at timestamptz,
  resnapshot_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists sync_device_sequence as bigint start with 1 increment by 1 no cycle;

create table if not exists sync_outbox (
  operation_id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  device_sequence bigint not null,
  company_id uuid references companies(id),
  branch_id uuid references branches(id),
  user_id uuid references users(id),
  entity_type text not null,
  entity_id uuid not null,
  operation_type text not null check (operation_type in ('UPSERT', 'DELETE', 'ACTION')),
  payload jsonb not null,
  payload_version integer not null default 1,
  payload_hash text not null,
  local_base_version bigint,
  sync_status text not null default 'PENDING'
    check (sync_status in ('PENDING','SENDING','ACKNOWLEDGED','RETRY','CONFLICT','REJECTED','BLOCKED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  acknowledged_central_version bigint,
  central_result_id uuid,
  committed_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id, device_sequence)
);

create index if not exists idx_sync_outbox_ready
  on sync_outbox(sync_status, next_retry_at, device_sequence)
  where sync_status in ('PENDING','RETRY','SENDING');
create index if not exists idx_sync_outbox_entity
  on sync_outbox(entity_type, entity_id, device_sequence);
create index if not exists idx_sync_outbox_retention
  on sync_outbox(acknowledged_at)
  where sync_status = 'ACKNOWLEDGED';

create table if not exists sync_operation_results (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  device_id uuid not null references linked_devices(id) on delete restrict,
  device_sequence bigint not null,
  company_id uuid not null references companies(id),
  user_id uuid references users(id),
  entity_type text not null,
  entity_id uuid not null,
  operation_type text not null,
  request_hash text not null,
  result_status text not null check (result_status in (
    'PROCESSING','ACCEPTED','ALREADY_APPLIED','VALIDATION_REJECTED','PERMISSION_REJECTED',
    'DEVICE_REVOKED','DEPENDENCY_PENDING','CONFLICT','CENTRAL_PROCESSING_FAILED'
  )),
  central_entity_id uuid,
  central_version bigint,
  authoritative_payload jsonb,
  conflict_payload jsonb,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(device_id, device_sequence)
);

create index if not exists idx_sync_results_company_created
  on sync_operation_results(company_id, created_at desc);

create table if not exists sync_change_feed (
  cursor_id bigserial primary key,
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  agent_id uuid references agents(id),
  entity_type text not null,
  entity_id uuid not null,
  operation_type text not null check (operation_type in ('UPSERT','DELETE')),
  authoritative_version bigint not null default 0,
  authoritative_payload jsonb,
  source_device_id uuid,
  tombstone boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_change_feed_scope_cursor
  on sync_change_feed(company_id, cursor_id);
create index if not exists idx_sync_change_feed_branch_cursor
  on sync_change_feed(company_id, branch_id, cursor_id)
  where branch_id is not null;

create table if not exists sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  device_id uuid not null,
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  entity_type text not null,
  entity_id uuid not null,
  local_payload jsonb not null,
  local_base_version bigint,
  central_payload jsonb,
  central_version bigint,
  intended_action text not null,
  conflict_code text not null,
  conflict_reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','REJECTED')),
  resolution_type text,
  resolution_payload jsonb,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operation_id)
);

create index if not exists idx_sync_conflicts_open
  on sync_conflicts(company_id, branch_id, created_at desc)
  where status = 'OPEN';

create table if not exists sync_deferred_actions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id),
  entity_type text not null,
  entity_id uuid not null,
  action_type text not null check (action_type in ('FINANCIAL','INVENTORY','CENTRAL_ACTION')),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','CONFIRMED','FAILED')),
  payload jsonb not null default '{}'::jsonb,
  safe_error_code text,
  safe_error_message text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(operation_id, action_type)
);

alter table daily_ledger_sessions
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint;
alter table daily_ledger_rows
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint,
  add column if not exists row_sync_no text;
alter table daily_ledger_dispatch_definitions
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint,
  add column if not exists dispatch_sync_no text;
alter table daily_ledger_row_transfers
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint;
alter table daily_ledger_row_transfer_items
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint;
alter table daily_ledger_print_events
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint;
alter table daily_ledger_print_documents
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_central_version bigint not null default 0,
  add column if not exists sync_origin_device_id uuid,
  add column if not exists sync_last_device_sequence bigint;

create unique index if not exists ux_daily_ledger_rows_sync_no
  on daily_ledger_rows(row_sync_no) where row_sync_no is not null;
create unique index if not exists ux_daily_ledger_dispatch_sync_no
  on daily_ledger_dispatch_definitions(dispatch_sync_no) where dispatch_sync_no is not null;

create or replace function sync_increment_row_version()
returns trigger language plpgsql as $$
begin
  -- Pull/snapshot application supplies the authoritative version explicitly.
  -- Do not advance it again while those writes are being applied locally.
  if coalesce(current_setting('app.node_role', true), 'disabled') = 'local'
     and coalesce(current_setting('app.sync_suppress_outbox', true), '0') = '1' then
    return new;
  end if;
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  if coalesce(current_setting('app.node_role', true), 'disabled') = 'central' then
    new.sync_central_version := new.sync_version;
  end if;
  return new;
end;
$$;

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

  if tg_table_name in ('daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_print_documents') then
    row_company_id := (row_data->>'company_id')::uuid;
    row_branch_id := nullif(row_data->>'branch_id','')::uuid;
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

create or replace function sync_capture_local_outbox()
returns trigger language plpgsql as $$
declare
  row_data jsonb;
  row_id uuid;
  row_company_id uuid;
  row_branch_id uuid;
  row_user_id uuid;
  row_base_version bigint;
  local_device_id uuid;
  local_sequence bigint;
  op text;
  hash text;
begin
  if coalesce(current_setting('app.node_role', true), 'disabled') <> 'local'
     or coalesce(current_setting('app.sync_suppress_outbox', true), '0') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    row_data := to_jsonb(old); row_base_version := coalesce(old.sync_central_version,0); op := 'DELETE';
  else
    row_data := to_jsonb(new); row_base_version := coalesce(new.sync_central_version,0); op := 'UPSERT';
  end if;
  row_id := (row_data->>'id')::uuid;
  row_user_id := nullif(coalesce(row_data->>'updated_by',row_data->>'created_by',row_data->>'printed_by',row_data->>'transferred_by'),'')::uuid;

  if tg_table_name in ('daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_print_documents') then
    row_company_id := (row_data->>'company_id')::uuid;
    row_branch_id := nullif(row_data->>'branch_id','')::uuid;
  elsif tg_table_name = 'daily_ledger_print_events' then
    row_company_id := (row_data->>'company_id')::uuid;
    select branch_id into row_branch_id from daily_ledger_sessions where id=nullif(row_data->>'session_id','')::uuid;
  elsif tg_table_name = 'daily_ledger_rows' then
    select company_id,branch_id into row_company_id,row_branch_id from daily_ledger_sessions where id=(row_data->>'session_id')::uuid;
  elsif tg_table_name = 'daily_ledger_row_transfers' then
    row_company_id := (row_data->>'company_id')::uuid;
    select branch_id into row_branch_id from daily_ledger_sessions where id=(row_data->>'target_session_id')::uuid;
  elsif tg_table_name = 'daily_ledger_row_transfer_items' then
    select t.company_id,s.branch_id into row_company_id,row_branch_id
    from daily_ledger_row_transfers t left join daily_ledger_sessions s on s.id=t.target_session_id
    where t.id=(row_data->>'transfer_id')::uuid;
  end if;

  select device_id into local_device_id from sync_local_state where singleton=true;
  if local_device_id is null or row_company_id is null then
    raise exception 'Local sync identity/scope is not initialized.' using errcode='23514';
  end if;
  local_sequence := nextval('sync_device_sequence');
  hash := encode(digest(convert_to(row_data::text,'UTF8'),'sha256'),'hex');
  insert into sync_outbox(
    device_id,device_sequence,company_id,branch_id,user_id,entity_type,entity_id,
    operation_type,payload,payload_version,payload_hash,local_base_version
  ) values(
    local_device_id,local_sequence,row_company_id,row_branch_id,row_user_id,tg_table_name,row_id,
    op,row_data,1,hash,row_base_version
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'daily_ledger_sessions','daily_ledger_rows','daily_ledger_dispatch_definitions',
    'daily_ledger_row_transfers','daily_ledger_row_transfer_items',
    'daily_ledger_print_events','daily_ledger_print_documents'
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
    execute format('drop trigger if exists trg_%I_sync_outbox on %I', table_name, table_name);
    execute format(
      'create trigger trg_%I_sync_outbox after insert or update or delete on %I for each row execute function sync_capture_local_outbox()',
      table_name, table_name
    );
  end loop;
end;
$$;

insert into permissions(code, name, module, action, is_active)
values
  ('sync.status.read', 'عرض حالة المزامنة', 'sync', 'read', true),
  ('sync.retry', 'إعادة محاولة المزامنة', 'sync', 'retry', true),
  ('sync.conflicts.resolve', 'حل تعارضات المزامنة', 'sync', 'resolve_conflicts', true),
  ('sync.diagnostics.read', 'عرض تشخيص المزامنة', 'sync', 'diagnostics', true)
on conflict (code) do update set
  name=excluded.name, module=excluded.module, action=excluded.action, is_active=excluded.is_active;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r join permissions p on p.code in ('sync.status.read','sync.retry','sync.diagnostics.read')
where r.code in ('admin','general_manager','branch_manager','manager','data_entry','operator','shipment_auditor')
on conflict (role_id, permission_id) do update set permission_code=excluded.permission_code;

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r join permissions p on p.code='sync.conflicts.resolve'
where r.code in ('admin','general_manager')
on conflict (role_id, permission_id) do update set permission_code=excluded.permission_code;
