import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { sha256Payload } from './payloadHash.js';
import { env } from '../config/env.js';
import { executeCentralDeferredAction } from './centralDeferredActions.js';

export type CentralSyncStatus =
  | 'ACCEPTED' | 'ALREADY_APPLIED' | 'VALIDATION_REJECTED' | 'PERMISSION_REJECTED'
  | 'DEVICE_REVOKED' | 'DEPENDENCY_PENDING' | 'CONFLICT' | 'CENTRAL_PROCESSING_FAILED';

export type PushOperation = {
  operationId: string;
  deviceId: string;
  deviceSequence: number;
  entityType: string;
  entityId: string;
  operation: 'UPSERT' | 'DELETE' | 'ACTION';
  payload: Record<string, unknown>;
  requestHash: string;
  baseVersion?: number | null;
  clientSchemaVersion: string;
  appVersion: string;
};

export type SyncRequestContext = {
  companyId: string;
  userId?: string;
  allowedBranchIds: string[];
  agentId?: string;
  baseCurrency?: string;
  permissionCodes?: string[];
};

export type PushOperationResult = {
  operationId: string;
  status: CentralSyncStatus;
  resultId?: string;
  entityId: string;
  centralVersion?: number;
  authoritativePayload?: Record<string, unknown> | null;
  conflict?: Record<string, unknown> | null;
  errorCode?: string;
  errorMessage?: string;
};

type EntitySpec = {
  table: string;
  columns: readonly string[];
  softDelete: boolean;
  companyColumn?: string;
  branchColumn?: string;
  dependency?: { column: string; table: string; companyColumn?: string };
  hasUpdatedAt?: boolean;
};

const entitySpecs: Record<string, EntitySpec> = {
  daily_ledger_sessions: {
    table: 'daily_ledger_sessions', softDelete: true, companyColumn: 'company_id', branchColumn: 'branch_id', hasUpdatedAt:true,
    columns: ['company_id','branch_id','ledger_date','line_label','origin_label','trip_no','vehicle_label','driver_label','created_by','updated_by','deleted_at','driver_id','vehicle_id','printed_at','printed_by','print_count','last_printed_at','reprint_required','reprint_reason'],
  },
  daily_ledger_rows: {
    table: 'daily_ledger_rows', softDelete: true, hasUpdatedAt:true,
    dependency: { column: 'session_id', table: 'daily_ledger_sessions', companyColumn: 'company_id' },
    columns: ['session_id','row_no','receipt_no','destination','parcel_type','parcel_count','weight_kg','sender_name','receiver_name','collect_amount_usd','prepaid_amount_usd','hawala_amount_usd','fees_amount_usd','notes','created_by','updated_by','deleted_at','transfer_service_fee_usd','original_session_id','last_transfer_id','transfer_status','dispatch_id','row_sync_no'],
  },
  daily_ledger_dispatch_definitions: {
    table: 'daily_ledger_dispatch_definitions', softDelete: true, companyColumn: 'company_id', branchColumn: 'branch_id', hasUpdatedAt:true,
    columns: ['company_id','branch_id','ledger_date','line_label','dispatch_no','driver_id','vehicle_id','driver_label','vehicle_label','trip_no','notes','created_by','updated_by','deleted_at','dispatch_sync_no'],
  },
  daily_ledger_row_transfers: {
    table: 'daily_ledger_row_transfers', softDelete: false, companyColumn: 'company_id',
    dependency: { column: 'target_session_id', table: 'daily_ledger_sessions', companyColumn: 'company_id' },
    columns: ['company_id','transfer_no','source_session_id','target_session_id','old_driver_id','new_driver_id','old_vehicle_id','new_vehicle_id','old_ledger_date','new_ledger_date','reason','rows_count','pieces_count','weight_kg','status','transferred_by','transferred_at'],
  },
  daily_ledger_row_transfer_items: {
    table: 'daily_ledger_row_transfer_items', softDelete: false,
    dependency: { column: 'transfer_id', table: 'daily_ledger_row_transfers', companyColumn: 'company_id' },
    columns: ['transfer_id','row_id','shipment_id','receipt_no','source_session_id','target_session_id','weight_kg','pieces_count'],
  },
  daily_ledger_print_events: {
    table: 'daily_ledger_print_events', softDelete: false, companyColumn: 'company_id',
    columns: ['company_id','session_id','print_type','print_scope','row_count','pieces_count','weight_kg','printed_by','printed_at'],
  },
  daily_ledger_print_documents: {
    table: 'daily_ledger_print_documents', softDelete: false, companyColumn: 'company_id', branchColumn: 'branch_id',
    columns: ['company_id','branch_id','ledger_date','ledger_date_to','line_label','origin_label','driver_id','driver_label','destination_label','search_query','print_type','print_scope','title','row_count','pieces_count','weight_kg','collect_total_usd','prepaid_total_usd','hawala_total_usd','transfer_fee_total_usd','rows_snapshot','printed_by','printed_at'],
  },
};

function comparablePayload(spec: EntitySpec, value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(spec.columns.map((column) => [column, value[column] ?? null]));
}

function sameBusinessPayload(spec: EntitySpec, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return sha256Payload(comparablePayload(spec, a)) === sha256Payload(comparablePayload(spec, b));
}

async function validateDevice(client: PoolClient, context: SyncRequestContext, operation: PushOperation) {
  const result = await client.query<{
    id: string; sync_state: string; is_blocked: boolean; company_id: string;
  }>(
    `select id,sync_state,is_blocked,company_id from linked_devices where id=$1::uuid for update`,
    [operation.deviceId],
  );
  const device = result.rows[0];
  if (!device || device.company_id !== context.companyId) return 'PERMISSION_REJECTED' as const;
  if (device.is_blocked || device.sync_state !== 'active') return 'DEVICE_REVOKED' as const;
  await client.query(
    `update linked_devices set last_seen_at=now(),app_version=$2,local_schema_version=$3,updated_at=now() where id=$1`,
    [operation.deviceId, operation.appVersion, operation.clientSchemaVersion],
  );
  return null;
}

async function databasePayloadHash(client:PoolClient,payload:Record<string,unknown>):Promise<string>{
  const result=await client.query<{hash:string}>(`select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash`,[JSON.stringify(payload)]);
  return result.rows[0].hash;
}

async function resolveBranchAndValidateScope(
  client: PoolClient,
  context: SyncRequestContext,
  spec: EntitySpec,
  payload: Record<string, unknown>,
): Promise<{ branchId: string | null; dependencyMissing: boolean; allowed: boolean }> {
  let companyId = spec.companyColumn ? String(payload[spec.companyColumn] ?? '') : '';
  let branchId = spec.branchColumn ? String(payload[spec.branchColumn] ?? '') || null : null;

  if (spec.dependency) {
    const dependencyId = String(payload[spec.dependency.column] ?? '');
    if (!dependencyId) return { branchId, dependencyMissing: true, allowed: false };
    const dependency = await client.query<Record<string, unknown>>(
      `select * from ${spec.dependency.table} where id=$1::uuid limit 1`,
      [dependencyId],
    );
    if (!dependency.rows[0]) return { branchId, dependencyMissing: true, allowed: false };
    if (spec.dependency.companyColumn) companyId = String(dependency.rows[0][spec.dependency.companyColumn] ?? '');
    branchId = String(dependency.rows[0].branch_id ?? branchId ?? '') || null;
  }

  if (companyId && companyId !== context.companyId) return { branchId, dependencyMissing: false, allowed: false };
  const allowed = !branchId || context.allowedBranchIds.includes(branchId);
  return { branchId, dependencyMissing: false, allowed };
}

async function finishResult(
  client: PoolClient,
  resultId: string,
  status: CentralSyncStatus,
  data: { centralVersion?: number; payload?: Record<string, unknown> | null; conflict?: Record<string, unknown> | null; code?: string; message?: string },
) {
  await client.query(
    `update sync_operation_results set result_status=$2,central_version=$3,authoritative_payload=$4::jsonb,
       conflict_payload=$5::jsonb,safe_error_code=$6,safe_error_message=$7,completed_at=now(),updated_at=now()
     where id=$1`,
    [resultId, status, data.centralVersion ?? null, JSON.stringify(data.payload ?? null), JSON.stringify(data.conflict ?? null), data.code ?? null, data.message ?? null],
  );
}

function mapStoredResult(row: Record<string, unknown>): PushOperationResult {
  return {
    operationId: String(row.operation_id),
    status: String(row.result_status === 'ACCEPTED' ? 'ALREADY_APPLIED' : row.result_status) as CentralSyncStatus,
    resultId: String(row.id), entityId: String(row.entity_id),
    centralVersion: row.central_version == null ? undefined : Number(row.central_version),
    authoritativePayload: row.authoritative_payload as Record<string, unknown> | null,
    conflict: row.conflict_payload as Record<string, unknown> | null,
    errorCode: row.safe_error_code ? String(row.safe_error_code) : undefined,
    errorMessage: row.safe_error_message ? String(row.safe_error_message) : undefined,
  };
}

async function processDeferredAction(client:PoolClient,context:SyncRequestContext,operation:PushOperation,resultId:string):Promise<PushOperationResult>{
  await client.query(`select pg_advisory_lock(hashtextextended($1,0))`,[operation.operationId]);
  try{
    const current=(await client.query<Record<string,unknown>>(`select * from sync_operation_results where id=$1`,[resultId])).rows[0];
    if(current?.result_status==='ACCEPTED')return mapStoredResult(current);
    const actionResult=await executeCentralDeferredAction(context,operation.payload);
    await client.query('begin');
    await finishResult(client,resultId,'ACCEPTED',{payload:{actionResult} as Record<string,unknown>});
    await client.query('commit');
    return{operationId:operation.operationId,entityId:operation.entityId,status:'ACCEPTED',resultId,centralVersion:0,authoritativePayload:{actionResult} as Record<string,unknown>};
  }catch(error){
    try{await client.query('rollback')}catch{/* best effort */}
    await client.query('begin');
    await finishResult(client,resultId,'CENTRAL_PROCESSING_FAILED',{code:'DEFERRED_ACTION_FAILED',message:'The central action was not confirmed and will be retried.'});
    await client.query('commit');
    console.error('[SYNC] Deferred central action failed',{operationId:operation.operationId,error:error instanceof Error?error.message:String(error)});
    return{operationId:operation.operationId,entityId:operation.entityId,status:'CENTRAL_PROCESSING_FAILED',resultId,errorCode:'DEFERRED_ACTION_FAILED',errorMessage:'The central action was not confirmed and will be retried.'};
  }finally{await client.query(`select pg_advisory_unlock(hashtextextended($1,0))`,[operation.operationId]).catch(()=>undefined)}
}

const supportedDeferredActionEntities=new Set([
  'central_action.post_shipments',
  'central_action.transfer_complete',
  'central_action.transfer_cancel',
]);

export async function applyPushOperation(context: SyncRequestContext, operation: PushOperation): Promise<PushOperationResult> {
  const client = await pool.connect();
  let durableResultId: string | undefined;
  try {
    await client.query('begin');
    const stored = await client.query<Record<string, unknown>>(
      `select * from sync_operation_results where operation_id=$1::uuid for update`,
      [operation.operationId],
    );
    if (stored.rows[0]) {
      if(String(stored.rows[0].device_id)!==operation.deviceId||String(stored.rows[0].entity_id)!==operation.entityId||String(stored.rows[0].entity_type)!==operation.entityType||Number(stored.rows[0].device_sequence)!==operation.deviceSequence){
        await client.query('commit');return{operationId:operation.operationId,entityId:operation.entityId,status:'VALIDATION_REJECTED',errorCode:'OPERATION_IDENTITY_MISMATCH'}
      }
      const replayDeviceError=await validateDevice(client,context,operation);
      if(replayDeviceError){await client.query('rollback');return{operationId:operation.operationId,entityId:operation.entityId,status:replayDeviceError,errorCode:replayDeviceError}}
      if (String(stored.rows[0].request_hash) !== operation.requestHash) {
        await client.query('commit');
        return { operationId: operation.operationId, entityId: operation.entityId, status: 'VALIDATION_REJECTED', errorCode: 'OPERATION_HASH_MISMATCH', errorMessage: 'Operation ID was already used with a different payload.' };
      }
      if(operation.operation==='ACTION'&&supportedDeferredActionEntities.has(operation.entityType)&&['PROCESSING','CENTRAL_PROCESSING_FAILED'].includes(String(stored.rows[0].result_status))){
        const resultId=String(stored.rows[0].id);await client.query('commit');return processDeferredAction(client,context,operation,resultId);
      }
      await client.query('commit');
      return mapStoredResult(stored.rows[0]);
    }

    const deviceError = await validateDevice(client, context, operation);
    if (deviceError) {
      await client.query('rollback');
      return { operationId: operation.operationId, entityId: operation.entityId, status: deviceError, errorCode: deviceError };
    }
    if (await databasePayloadHash(client,operation.payload) !== operation.requestHash) {
      await client.query('rollback');
      return { operationId: operation.operationId, entityId: operation.entityId, status: 'VALIDATION_REJECTED', errorCode: 'PAYLOAD_HASH_INVALID' };
    }

    const createdResult = await client.query<{ id: string }>(
      `insert into sync_operation_results(operation_id,device_id,device_sequence,company_id,user_id,entity_type,entity_id,operation_type,request_hash,result_status)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROCESSING') returning id`,
      [operation.operationId,operation.deviceId,operation.deviceSequence,context.companyId,context.userId ?? null,operation.entityType,operation.entityId,operation.operation,operation.requestHash],
    );
    const resultId = createdResult.rows[0].id;
    durableResultId = resultId;
    if(operation.operation==='ACTION'&&supportedDeferredActionEntities.has(operation.entityType)){
      await client.query('commit');return processDeferredAction(client,context,operation,resultId);
    }
    const spec = entitySpecs[operation.entityType];
    if (!spec || operation.operation === 'ACTION') {
      await finishResult(client,resultId,'VALIDATION_REJECTED',{code:'ENTITY_OR_ACTION_NOT_SUPPORTED',message:'Entity or action is not enabled for offline write.'});
      await client.query('commit');
      return { operationId:operation.operationId,entityId:operation.entityId,status:'VALIDATION_REJECTED',resultId,errorCode:'ENTITY_OR_ACTION_NOT_SUPPORTED' };
    }

    const scoped = await resolveBranchAndValidateScope(client,context,spec,operation.payload);
    if (scoped.dependencyMissing) {
      await finishResult(client,resultId,'DEPENDENCY_PENDING',{code:'DEPENDENCY_MISSING'});
      await client.query('commit');
      return { operationId:operation.operationId,entityId:operation.entityId,status:'DEPENDENCY_PENDING',resultId,errorCode:'DEPENDENCY_MISSING' };
    }
    if (!scoped.allowed) {
      await finishResult(client,resultId,'PERMISSION_REJECTED',{code:'SCOPE_REJECTED'});
      await client.query('commit');
      return { operationId:operation.operationId,entityId:operation.entityId,status:'PERMISSION_REJECTED',resultId,errorCode:'SCOPE_REJECTED' };
    }

    const currentResult = await client.query<Record<string, unknown>>(
      `select * from ${spec.table} where id=$1::uuid for update`, [operation.entityId],
    );
    const current = currentResult.rows[0];
    const currentVersion = Number(current?.sync_version ?? 0);
    const baseVersion = Number(operation.baseVersion ?? 0);
    const sameDeviceContinuation = Boolean(
      current && String(current.sync_origin_device_id ?? '') === operation.deviceId
      && Number(current.sync_last_device_sequence ?? -1) < operation.deviceSequence,
    );

    if (current && currentVersion !== baseVersion && !sameDeviceContinuation && !sameBusinessPayload(spec,current,operation.payload)) {
      const conflict = {
        code:'CENTRAL_VERSION_MISMATCH', localBaseVersion:baseVersion,
        centralVersion:currentVersion, localPayload:operation.payload, centralPayload:current,
      };
      await client.query(
        `insert into sync_conflicts(operation_id,device_id,company_id,branch_id,entity_type,entity_id,local_payload,local_base_version,central_payload,central_version,intended_action,conflict_code,conflict_reason)
         values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,'CENTRAL_VERSION_MISMATCH','Central row changed after the local base version.')`,
        [operation.operationId,operation.deviceId,context.companyId,scoped.branchId,operation.entityType,operation.entityId,JSON.stringify(operation.payload),baseVersion,JSON.stringify(current),currentVersion,operation.operation],
      );
      await finishResult(client,resultId,'CONFLICT',{centralVersion:currentVersion,payload:current,conflict});
      await client.query('commit');
      return {operationId:operation.operationId,entityId:operation.entityId,status:'CONFLICT',resultId,centralVersion:currentVersion,authoritativePayload:current,conflict};
    }

    await client.query(`select set_config('app.sync_device_id',$1,true)`,[operation.deviceId]);
    let authoritative: Record<string, unknown>;
    if (operation.operation === 'DELETE') {
      if (!current) {
        authoritative = { id: operation.entityId, deleted_at: new Date().toISOString() };
      } else if (spec.softDelete) {
        const deleted = await client.query<Record<string, unknown>>(
          `update ${spec.table} set deleted_at=coalesce(deleted_at,now()),sync_origin_device_id=$2::uuid,sync_last_device_sequence=$3,updated_at=now() where id=$1::uuid returning *`,
          [operation.entityId,operation.deviceId,operation.deviceSequence],
        );
        authoritative=deleted.rows[0];
      } else {
        authoritative=current;
        await client.query(`delete from ${spec.table} where id=$1::uuid`,[operation.entityId]);
      }
    } else if (!current) {
      const columns = spec.columns.filter((column)=>Object.prototype.hasOwnProperty.call(operation.payload,column));
      const names = ['id',...columns,'sync_origin_device_id','sync_last_device_sequence'];
      const values = [operation.entityId,...columns.map((column)=>operation.payload[column]),operation.deviceId,operation.deviceSequence];
      const params = values.map((_,index)=>`$${index+1}`);
      const inserted = await client.query<Record<string, unknown>>(
        `insert into ${spec.table}(${names.join(',')}) values(${params.join(',')}) returning *`,values,
      );
      authoritative=inserted.rows[0];
    } else if (sameBusinessPayload(spec,current,operation.payload)) {
      authoritative=current;
    } else {
      const columns = spec.columns.filter((column)=>Object.prototype.hasOwnProperty.call(operation.payload,column));
      const assignments = columns.map((column,index)=>`${column}=$${index+2}`);
      const values = [operation.entityId,...columns.map((column)=>operation.payload[column]),operation.deviceId,operation.deviceSequence];
      assignments.push(`sync_origin_device_id=$${values.length-1}::uuid`,`sync_last_device_sequence=$${values.length}`);
      if(spec.hasUpdatedAt) assignments.push('updated_at=now()');
      const updated = await client.query<Record<string, unknown>>(
        `update ${spec.table} set ${assignments.join(',')} where id=$1::uuid returning *`,values,
      );
      authoritative=updated.rows[0];
    }

    const centralVersion=Number(authoritative?.sync_version ?? currentVersion);
    await finishResult(client,resultId,'ACCEPTED',{centralVersion,payload:authoritative});
    await client.query('commit');
    return {operationId:operation.operationId,entityId:operation.entityId,status:'ACCEPTED',resultId,centralVersion,authoritativePayload:authoritative};
  } catch (error) {
    try { await client.query('rollback'); } catch { /* connection may already be aborted */ }
    console.error('[SYNC] Central operation failed', {
      operationId: operation.operationId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      error: error instanceof Error ? error.message : String(error),
    });

    // The business transaction was rolled back, including its PROCESSING row.
    // Persist a replayable failure result in a fresh transaction without leaking
    // database internals to the desktop client.
    try {
      await client.query('begin');
      const failed = await client.query<{ id: string }>(
        `insert into sync_operation_results(
           operation_id,device_id,device_sequence,company_id,user_id,entity_type,entity_id,
           operation_type,request_hash,result_status,safe_error_code,safe_error_message,completed_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'CENTRAL_PROCESSING_FAILED','CENTRAL_PROCESSING_FAILED',
                  'Central processing failed. The operation was not applied.',now())
         on conflict(operation_id) do update set
           result_status='CENTRAL_PROCESSING_FAILED',safe_error_code='CENTRAL_PROCESSING_FAILED',
           safe_error_message='Central processing failed. The operation was not applied.',
           completed_at=now(),updated_at=now()
         where sync_operation_results.request_hash=excluded.request_hash
         returning id`,
        [operation.operationId,operation.deviceId,operation.deviceSequence,context.companyId,
          context.userId ?? null,operation.entityType,operation.entityId,operation.operation,operation.requestHash],
      );
      durableResultId = failed.rows[0]?.id ?? durableResultId;
      await client.query('commit');
    } catch (persistenceError) {
      try { await client.query('rollback'); } catch { /* best effort */ }
      console.error('[SYNC] Could not persist central failure result', {
        operationId: operation.operationId,
        error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
      });
    }
    return {
      operationId:operation.operationId,entityId:operation.entityId,status:'CENTRAL_PROCESSING_FAILED',
      resultId:durableResultId,errorCode:'CENTRAL_PROCESSING_FAILED',
      errorMessage:'Central processing failed. The operation was not applied.',
    };
  } finally { client.release(); }
}

export async function pullChanges(context: SyncRequestContext,input:{deviceId:string;lastCursor:number;batchSize:number}) {
  const offlineGrantExpiresAt=new Date(Date.now()+env.OFFLINE_AUTH_MAX_AGE_HOURS*3600000).toISOString();
  const device = await pool.query<{sync_state:string;is_blocked:boolean;company_id:string}>(
    `select sync_state,is_blocked,company_id from linked_devices where id=$1::uuid`,[input.deviceId],
  );
  if (!device.rows[0] || device.rows[0].company_id!==context.companyId || device.rows[0].is_blocked || device.rows[0].sync_state!=='active') {
    return { deviceRejected:true, changes:[], nextCursor:input.lastCursor, hasMore:false, resnapshotRequired:false, offlineGrantExpiresAt };
  }
  const retention=await pool.query<{min_cursor:string|null,max_cursor:string|null}>(
    `select min(cursor_id)::text min_cursor,max(cursor_id)::text max_cursor from sync_change_feed where company_id=$1`,[context.companyId],
  );
  const minCursor=Number(retention.rows[0]?.min_cursor ?? 0);
  const maxCursor=Number(retention.rows[0]?.max_cursor ?? input.lastCursor);
  if(input.lastCursor>0 && minCursor>0 && input.lastCursor<minCursor-1){
    return {deviceRejected:false,changes:[],nextCursor:input.lastCursor,hasMore:false,resnapshotRequired:true,offlineGrantExpiresAt};
  }
  const changes=await pool.query<Record<string,unknown>>(
    `select cursor_id,company_id,branch_id,agent_id,entity_type,entity_id,operation_type,authoritative_version,authoritative_payload,source_device_id,tombstone,created_at
     from sync_change_feed where company_id=$1 and cursor_id>$2
       and (branch_id is null or branch_id=any($3::uuid[]))
     order by cursor_id asc limit $4`,
    [context.companyId,input.lastCursor,context.allowedBranchIds,input.batchSize],
  );
  const nextCursor=changes.rows.length?Number(changes.rows.at(-1)?.cursor_id):input.lastCursor;
  return {deviceRejected:false,changes:changes.rows,nextCursor,hasMore:nextCursor<maxCursor,resnapshotRequired:false,offlineGrantExpiresAt};
}

export async function createScopedSnapshot(context:SyncRequestContext){
  const client=await pool.connect();try{
    await client.query('begin isolation level repeatable read read only');
    const branches=context.allowedBranchIds;
    const query=async(sql:string,values:unknown[]=[])=>(await client.query<Record<string,unknown>>(sql,values)).rows;
    const data:Record<string,unknown[]>={};
    data.companies=await query(`select * from companies where id=$1`,[context.companyId]);
    // Destination lookup in the daily ledger needs the full company reference catalog,
    // even when this desktop device may write only to one assigned branch.
    data.branches=await query(`select * from branches where company_id=$1 and is_active=true`,[context.companyId]);
    data.agents=await query(
      `select a.* from agents a join branches b on b.id=a.branch_id
       where b.company_id=$1 and ($2::uuid is null or a.id=$2::uuid)`,
      [context.companyId,context.agentId??null],
    );
    // Historical finance rows must retain their party names even when the party
    // is no longer active. The UI still filters active choices for new entries.
    data.senders_receivers=await query(`select * from senders_receivers where (branch_id is null or branch_id=any($1::uuid[])) and ($2::uuid is null or agent_id is null or agent_id=$2::uuid)`,[branches,context.agentId??null]);
    data.customers=await query(`select * from customers where (company_id is null or company_id=$1) and (branch_id is null or branch_id=any($2::uuid[])) and ($3::uuid is null or agent_id is null or agent_id=$3::uuid)`,[context.companyId,branches,context.agentId??null]);
    data.cities=await query(`select * from cities where is_active=true`);
    // Include inactive currencies too: shipments/history still reference them, and
    // scoped snapshot apply skips any child whose required parent UUID is absent.
    data.currencies=await query(`select * from currencies where company_id=$1`,[context.companyId]);
    data.cashboxes=await query(
      `select * from cashboxes where company_id=$1
       and (branch_id is null or branch_id=any($2::uuid[]))`,
      [context.companyId,branches],
    );
    data.goods_types=await query(`select * from goods_types where is_active=true`);
    data.tariffs=await query(`select * from tariffs where is_active=true`);
    data.drivers=await query(`select * from drivers where status='active' and (branch_id is null or branch_id=any($1::uuid[])) and ($2::uuid is null or agent_id is null or agent_id=$2::uuid)`,[branches,context.agentId??null]);
    data.vehicles=await query(`select * from vehicles where status='active' and (branch_id is null or branch_id=any($1::uuid[])) and ($2::uuid is null or agent_id is null or agent_id=$2::uuid)`,[branches,context.agentId??null]);
    data.users=await query(`select id,username,full_name,email,phone,password_hash,role_id,branch_id,agent_id,status,role,company_id,is_active,user_type,created_at,updated_at,last_login_at from users where id=$1 and company_id=$2`,[context.userId,context.companyId]);
    data.roles=await query(`select r.* from roles r join users u on u.role_id=r.id where u.id=$1`,[context.userId]);
    data.permissions=await query(`select p.* from permissions p join role_permissions rp on rp.permission_id=p.id join users u on u.role_id=rp.role_id where u.id=$1 and p.is_active=true`,[context.userId]);
    data.role_permissions=await query(`select rp.* from role_permissions rp join users u on u.role_id=rp.role_id where u.id=$1`,[context.userId]);
    data.user_branches=await query(`select ub.* from user_branches ub where ub.user_id=$1 and ub.branch_id=any($2::uuid[])`,[context.userId,branches]);
    data.system_settings=await query(`select * from system_settings where is_encrypted=false and (key like 'daily_ledger.%' or key like 'printing.%' or key like 'terminology.%')`);
    data.printers=await query(`select * from printers where company_id=$1 and is_active=true and (branch_id is null or branch_id=any($2::uuid[]))`,[context.companyId,branches]);
    data.shipments=await query(`select * from shipments where company_id=$1 and deleted_at is null and branch_id=any($2::uuid[]) and ($3::uuid is null or agent_id is null or agent_id=$3::uuid)`,[context.companyId,branches,context.agentId??null]);
    const shipmentIds=(data.shipments as Array<Record<string,unknown>>).map(row=>row.id);
    data.deliveries=shipmentIds.length
      ?await query(`select * from deliveries where company_id=$1 and deleted_at is null and shipment_id=any($2::uuid[])`,[context.companyId,shipmentIds])
      :[];
    data.receipt_vouchers=await query(
      `select * from receipt_vouchers where company_id=$1
       and branch_id=any($2::uuid[])
       and ($3::uuid is null or agent_id=$3::uuid)
       order by created_at,id`,
      [context.companyId,branches,context.agentId??null],
    );
    data.payment_vouchers=await query(
      `select * from payment_vouchers where company_id=$1
       and branch_id=any($2::uuid[])
       and ($3::uuid is null or agent_id=$3::uuid)
       order by created_at,id`,
      [context.companyId,branches,context.agentId??null],
    );
    data.transfers=await query(
      `select * from transfers where company_id=$1
       and (branch_id is null or branch_id=any($2::uuid[]))
       and ($3::uuid is null or agent_id=$3::uuid or origin_agent_id=$3::uuid or destination_agent_id=$3::uuid)`,
      [context.companyId,branches,context.agentId??null],
    );
    data.cashbox_transactions=await query(
      `select * from cashbox_transactions where company_id=$1
       and branch_id=any($2::uuid[])
       and ($3::uuid is null or agent_id=$3::uuid)
       order by (reversal_of_cashbox_transaction_id is not null),created_at,id`,
      [context.companyId,branches,context.agentId??null],
    );
    data.party_financial_movements=await query(
      `select pfm.* from party_financial_movements pfm
       where pfm.branch_id=any($1::uuid[])
       and ($2::uuid is null or pfm.agent_id=$2::uuid)
       order by (pfm.reversal_of_movement_id is not null),pfm.created_at,pfm.id`,
      [branches,context.agentId??null],
    );
    data.shipment_status_history=shipmentIds.length?await query(`select * from shipment_status_history where shipment_id=any($1::uuid[])`,[shipmentIds]):[];
    data.manifests=await query(`select * from manifests where company_id=$1 and deleted_at is null and branch_id=any($2::uuid[])`,[context.companyId,branches]);
    const manifestIds=(data.manifests as Array<Record<string,unknown>>).map(row=>row.id);
    data.manifest_shipments=manifestIds.length?await query(`select * from manifest_shipments where manifest_id=any($1::uuid[])`,[manifestIds]):[];
    data.daily_ledger_sessions=await query(`select * from daily_ledger_sessions where company_id=$1 and deleted_at is null and branch_id=any($2::uuid[])`,[context.companyId,branches]);
    data.daily_ledger_rows=await query(`select r.* from daily_ledger_rows r join daily_ledger_sessions s on s.id=r.session_id where s.company_id=$1 and r.deleted_at is null and s.deleted_at is null and s.branch_id=any($2::uuid[])`,[context.companyId,branches]);
    data.daily_ledger_dispatch_definitions=await query(`select * from daily_ledger_dispatch_definitions where company_id=$1 and deleted_at is null and branch_id=any($2::uuid[])`,[context.companyId,branches]);
    const sessionIds=(data.daily_ledger_sessions as Array<Record<string,unknown>>).map(row=>row.id);
    data.daily_ledger_row_transfers=sessionIds.length?await query(`select * from daily_ledger_row_transfers where company_id=$1 and target_session_id=any($2::uuid[])`,[context.companyId,sessionIds]):[];
    const transferIds=(data.daily_ledger_row_transfers as Array<Record<string,unknown>>).map(row=>row.id);
    const ledgerRowIds=(data.daily_ledger_rows as Array<Record<string,unknown>>).map(row=>row.id);
    data.daily_ledger_row_transfer_items=transferIds.length&&ledgerRowIds.length
      ?await query(`select * from daily_ledger_row_transfer_items where transfer_id=any($1::uuid[]) and row_id=any($2::uuid[])`,[transferIds,ledgerRowIds])
      :[];
    data.daily_ledger_print_events=await query(`select e.* from daily_ledger_print_events e left join daily_ledger_sessions s on s.id=e.session_id where e.company_id=$1 and (e.session_id is null or s.branch_id=any($2::uuid[]))`,[context.companyId,branches]);
    data.daily_ledger_print_documents=await query(`select * from daily_ledger_print_documents where company_id=$1 and (branch_id is null or branch_id=any($2::uuid[]))`,[context.companyId,branches]);
    const cursor=await client.query<{cursor:string}>(`select coalesce(max(cursor_id),0)::text cursor from sync_change_feed where company_id=$1`,[context.companyId]);
    await client.query('commit');return {cursor:Number(cursor.rows[0].cursor),data,generatedAt:new Date().toISOString(),offlineGrantExpiresAt:new Date(Date.now()+env.OFFLINE_AUTH_MAX_AGE_HOURS*3600000).toISOString()};
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

export async function listOpenSyncConflicts(context:SyncRequestContext,limit=100){
  const result=await pool.query<Record<string,unknown>>(
    `select * from sync_conflicts where company_id=$1 and status='OPEN'
       and (branch_id is null or branch_id=any($2::uuid[])) order by created_at asc limit $3`,
    [context.companyId,context.allowedBranchIds,limit],
  );
  return result.rows;
}

export async function resolveSyncConflict(
  context:SyncRequestContext,conflictId:string,resolution:'KEEP_CENTRAL'|'APPLY_LOCAL'|'APPLY_EDITED',editedPayload?:Record<string,unknown>,notes?:string,
){
  const client=await pool.connect();try{
    await client.query('begin');
    const conflictResult=await client.query<Record<string,unknown>>(
      `select * from sync_conflicts where id=$1::uuid and company_id=$2 and status='OPEN' for update`,[conflictId,context.companyId],
    );
    const conflict=conflictResult.rows[0];if(!conflict)throw new Error('SYNC_CONFLICT_NOT_FOUND');
    const branchId=conflict.branch_id?String(conflict.branch_id):null;
    if(branchId&&!context.allowedBranchIds.includes(branchId))throw new Error('SYNC_CONFLICT_SCOPE_REJECTED');
    const spec=entitySpecs[String(conflict.entity_type)];if(!spec)throw new Error('SYNC_CONFLICT_ENTITY_UNSUPPORTED');
    const current=(await client.query<Record<string,unknown>>(`select * from ${spec.table} where id=$1::uuid for update`,[conflict.entity_id])).rows[0]??null;
    let chosen:Record<string,unknown>|null=current;
    if(resolution==='APPLY_LOCAL')chosen=conflict.local_payload as Record<string,unknown>;
    if(resolution==='APPLY_EDITED')chosen=editedPayload??null;
    if(resolution!=='KEEP_CENTRAL'&&!chosen)throw new Error('SYNC_CONFLICT_RESOLUTION_PAYLOAD_REQUIRED');
    if(chosen){
      const scoped=await resolveBranchAndValidateScope(client,context,spec,chosen);
      if(scoped.dependencyMissing)throw new Error('SYNC_CONFLICT_DEPENDENCY_MISSING');
      if(!scoped.allowed)throw new Error('SYNC_CONFLICT_SCOPE_REJECTED');
      await client.query(`select set_config('app.sync_device_id',$1,true)`,[String(conflict.device_id)]);
      if(current){
        const columns=spec.columns.filter(column=>Object.prototype.hasOwnProperty.call(chosen!,column));
        const values=[conflict.entity_id,...columns.map(column=>chosen![column]),conflict.device_id];
        const assignments=columns.map((column,index)=>`${column}=$${index+2}`);
        assignments.push(`sync_origin_device_id=$${values.length}::uuid`);
        if(spec.hasUpdatedAt)assignments.push('updated_at=now()');
        chosen=(await client.query<Record<string,unknown>>(`update ${spec.table} set ${assignments.join(',')} where id=$1::uuid returning *`,values)).rows[0];
      }else{
        const columns=spec.columns.filter(column=>Object.prototype.hasOwnProperty.call(chosen!,column));
        const keys=['id',...columns,'sync_origin_device_id'];const values=[conflict.entity_id,...columns.map(column=>chosen![column]),conflict.device_id];
        chosen=(await client.query<Record<string,unknown>>(`insert into ${spec.table}(${keys.join(',')}) values(${values.map((_,index)=>`$${index+1}`).join(',')}) returning *`,values)).rows[0];
      }
    }else{
      await client.query(
        `insert into sync_change_feed(company_id,branch_id,entity_type,entity_id,operation_type,authoritative_version,authoritative_payload,source_device_id,tombstone)
         values($1,$2,$3,$4,'DELETE',$5,null,$6,true)`,
        [context.companyId,branchId,conflict.entity_type,conflict.entity_id,Number(conflict.central_version??0),conflict.device_id],
      );
    }
    const version=Number(chosen?.sync_version??conflict.central_version??0);
    await client.query(
      `update sync_conflicts set status='RESOLVED',resolution_type=$2,resolution_payload=$3::jsonb,resolved_by=$4,resolved_at=now(),resolution_notes=$5 where id=$1`,
      [conflictId,resolution,JSON.stringify(chosen),context.userId??null,notes??null],
    );
    await client.query(
      `update sync_operation_results set result_status='ACCEPTED',central_version=$2,authoritative_payload=$3::jsonb,
       conflict_payload=null,safe_error_code=null,safe_error_message=null,completed_at=now(),updated_at=now() where operation_id=$1`,
      [conflict.operation_id,version,JSON.stringify(chosen)],
    );
    await client.query('commit');return{conflictId,resolution,authoritativePayload:chosen,centralVersion:version};
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}
