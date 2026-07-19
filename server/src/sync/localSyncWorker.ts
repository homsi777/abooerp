import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { canonicalJson } from './payloadHash.js';
import { isLocalSyncNode } from './localOutbox.js';

const writableEntities = new Set([
  'daily_ledger_sessions','daily_ledger_rows','daily_ledger_dispatch_definitions',
  'daily_ledger_row_transfers','daily_ledger_row_transfer_items',
  'daily_ledger_print_events','daily_ledger_print_documents',
]);
const softDeleteEntities = new Set([
  'daily_ledger_sessions','daily_ledger_rows','daily_ledger_dispatch_definitions',
]);
let timer: NodeJS.Timeout | null=null;let running=false;let forceRequested=false;
let centralOnline:boolean|null=null;let lastCentralError:string|null=null;let lastCentralAttemptAt:string|null=null;
const columnCache=new Map<string,Set<string>>();
const foreignKeyCache=new Map<string,Array<{columnName:string;referencedTable:string;nullable:boolean}>>();

async function tableColumns(client:PoolClient,table:string){
  const cached=columnCache.get(table);if(cached)return cached;
  const result=await client.query<{column_name:string}>(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,[table],
  );
  const columns=new Set(result.rows.map((row)=>row.column_name));columnCache.set(table,columns);return columns;
}

async function singleColumnForeignKeys(client:PoolClient,table:string){
  const cached=foreignKeyCache.get(table);if(cached)return cached;
  const result=await client.query<{column_name:string;referenced_table:string;nullable:boolean}>(
    `select attribute.attname column_name,constraint_row.confrelid::regclass::text referenced_table,
            not attribute.attnotnull nullable
       from pg_constraint constraint_row
       join pg_attribute attribute
         on attribute.attrelid=constraint_row.conrelid and attribute.attnum=constraint_row.conkey[1]
      where constraint_row.contype='f' and constraint_row.conrelid=$1::regclass
        and array_length(constraint_row.conkey,1)=1`,
    [table],
  );
  const rows=result.rows.map(row=>({columnName:row.column_name,referencedTable:row.referenced_table.replace(/^public\./,''),nullable:row.nullable}));
  foreignKeyCache.set(table,rows);return rows;
}

async function applyAuthoritativeRow(client:PoolClient,entityType:string,entityId:string,payload:Record<string,unknown>|null,version:number,tombstone=false){
  if(!writableEntities.has(entityType))return;
  await client.query(`select set_config('app.sync_suppress_feed','1',true)`);
  await client.query(`select set_config('app.sync_suppress_outbox','1',true)`);
  if(tombstone||!payload){
    if(softDeleteEntities.has(entityType)) await client.query(`update ${entityType} set deleted_at=coalesce(deleted_at,now()),sync_central_version=$2 where id=$1::uuid`,[entityId,version]);
    else await client.query(`delete from ${entityType} where id=$1::uuid`,[entityId]);
    return;
  }
  const allowed=await tableColumns(client,entityType);
  const entries=Object.entries(payload).filter(([key])=>key!=='id'&&allowed.has(key));
  const exists=await client.query(`select 1 from ${entityType} where id=$1::uuid`,[entityId]);
  const normalized={...payload,sync_central_version:version,sync_version:version};
  const normalizedEntries=Object.entries(normalized).filter(([key])=>key!=='id'&&allowed.has(key));
  if(exists.rowCount){
    const assignments=normalizedEntries.map(([key],index)=>`${key}=$${index+2}`);
    await client.query(`update ${entityType} set ${assignments.join(',')} where id=$1::uuid`,[entityId,...normalizedEntries.map(([,value])=>value)]);
  }else{
    const keys=['id',...entries.map(([key])=>key),'sync_central_version','sync_version'];
    const values=[entityId,...entries.map(([,value])=>value),version,version];
    await client.query(`insert into ${entityType}(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')})`,values);
  }
}

const snapshotOrder=[
  'companies','roles','permissions','branches','agents','users','role_permissions','user_branches',
  'currencies','cities','goods_types','tariffs','drivers','vehicles','customers','senders_receivers',
  'system_settings','printers','shipments','shipment_status_history','manifests','manifest_shipments',
  'daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_row_transfers',
  'daily_ledger_rows','daily_ledger_row_transfer_items','daily_ledger_print_events','daily_ledger_print_documents',
];

async function upsertSnapshotRow(client:PoolClient,table:string,row:Record<string,unknown>,includedIds:Map<string,Set<string>>){
  const normalizedRow={...row};
  for(const foreignKey of await singleColumnForeignKeys(client,table)){
    const referencedIds=includedIds.get(foreignKey.referencedTable);const value=normalizedRow[foreignKey.columnName];
    if(referencedIds&&value!==null&&value!==undefined&&!referencedIds.has(String(value))){
      if(foreignKey.nullable)normalizedRow[foreignKey.columnName]=null;
      else{
        console.warn('[SYNC] Skipped scoped snapshot row with an unavailable required parent.',{table,id:normalizedRow.id,column:foreignKey.columnName,referencedTable:foreignKey.referencedTable});
        return;
      }
    }
  }
  const allowed=await tableColumns(client,table);const entries=Object.entries(normalizedRow).filter(([key])=>allowed.has(key));
  if(!entries.length)return;
  if(table==='manifest_shipments'){
    const keys=entries.map(([key])=>key);const values=entries.map(([,value])=>value);
    await client.query(`insert into manifest_shipments(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) on conflict(manifest_id,shipment_id) do update set created_at=excluded.created_at`,values);return;
  }
  const id=normalizedRow.id;if(!id)return;const withoutId=entries.filter(([key])=>key!=='id');const keys=['id',...withoutId.map(([key])=>key)];const values=[id,...withoutId.map(([,value])=>value)];
  const updates=withoutId.map(([key])=>`${key}=excluded.${key}`);
  await client.query(`insert into ${table}(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) on conflict(id) do update set ${updates.length?updates.join(','):'id=excluded.id'}`,values);
}

export async function applyScopedSnapshot(snapshot:any){
  const client=await pool.connect();try{
    await client.query('begin');
    await client.query(`select set_config('app.sync_suppress_feed','1',true)`);
    await client.query(`select set_config('app.sync_suppress_outbox','1',true)`);
    const state=await client.query<{snapshot_initialized_at:string|null}>(`select snapshot_initialized_at from sync_local_state where singleton=true for update`);
    const replacingMirror=!state.rows[0]?.snapshot_initialized_at || Boolean(snapshot.resnapshotRequired);
    if(replacingMirror){
      const outbox=await client.query<{count:string}>(`select count(*)::text count from sync_outbox where sync_status not in ('ACKNOWLEDGED','REJECTED')`);
      if(Number(outbox.rows[0]?.count??0)!==0)throw new Error('SCOPED_SNAPSHOT_BLOCKED_BY_UNRESOLVED_OUTBOX');
      // Old migrations seed placeholder identities. They must not survive into the
      // local mirror because business rows must carry the central UUIDs. The same
      // replacement also removes rows that left the device scope during resnapshot.
      await client.query(`truncate table companies,permissions,cities,goods_types restart identity cascade`);
      columnCache.clear();foreignKeyCache.clear();
    }
    const includedIds=new Map<string,Set<string>>();
    for(const [table,rows] of Object.entries(snapshot.data??{})){
      if(Array.isArray(rows))includedIds.set(table,new Set(rows.map((row:any)=>row?.id).filter(Boolean).map(String)));
    }
    for(const table of snapshotOrder){
      const rows=Array.isArray(snapshot.data?.[table])?snapshot.data[table]:[];
      for(const row of rows)await upsertSnapshotRow(client,table,row,includedIds);
    }
    await client.query(
      `update sync_local_state set last_central_cursor=$1,offline_grant_expires_at=$2::timestamptz,
       snapshot_initialized_at=coalesce(snapshot_initialized_at,now()),resnapshot_required=false,last_pull_at=now(),
       last_successful_sync_at=now(),updated_at=now() where singleton=true`,
      [snapshot.cursor,snapshot.offlineGrantExpiresAt],
    );
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

async function ensureSnapshotReady():Promise<boolean>{
  if(!env.CENTRAL_SYNC_API_BASE_URL||(!env.CENTRAL_SYNC_ACCESS_TOKEN&&!env.CENTRAL_SYNC_DEVICE_TOKEN)||!env.SYNC_DEVICE_ID)return false;
  const state=await pool.query<{snapshot_initialized_at:string|null;resnapshot_required:boolean}>(`select snapshot_initialized_at,resnapshot_required from sync_local_state where singleton=true`);
  if(state.rows[0]?.snapshot_initialized_at&&!state.rows[0]?.resnapshot_required)return true;
  const response=await fetch(`${env.CENTRAL_SYNC_API_BASE_URL.replace(/\/$/,'')}/sync/snapshot`,{
    method:'POST',headers:{'content-type':'application/json',...(env.CENTRAL_SYNC_ACCESS_TOKEN?{authorization:`Bearer ${env.CENTRAL_SYNC_ACCESS_TOKEN}`}:{'x-sync-device-id':env.SYNC_DEVICE_ID,'x-sync-device-token':env.CENTRAL_SYNC_DEVICE_TOKEN!})},
    body:JSON.stringify({deviceId:env.SYNC_DEVICE_ID}),
  });
  if(!response.ok)throw new Error(`CENTRAL_SNAPSHOT_HTTP_${response.status}`);
  const body=await response.json() as any;if(!body?.data)throw new Error('CENTRAL_SNAPSHOT_INVALID');
  await applyScopedSnapshot({...body.data,resnapshotRequired:Boolean(state.rows[0]?.resnapshot_required)});return true;
}

function nextDelay(attempt:number){const base=Math.min(300000,1000*2**Math.min(attempt,8));return Math.round(base*(0.75+Math.random()*0.5));}

async function markRetry(operationId:string,attempt:number,code:string,message:string){
  const delay=nextDelay(attempt);await pool.query(
    `update sync_outbox set sync_status='RETRY',attempt_count=attempt_count+1,next_retry_at=now()+($2::text||' milliseconds')::interval,last_error_code=$3,last_error_message=$4,updated_at=now() where operation_id=$1`,
    [operationId,delay,code,message.slice(0,500)],
  );
}

async function pushOnce():Promise<void>{
  if(!env.CENTRAL_SYNC_API_BASE_URL||(!env.CENTRAL_SYNC_ACCESS_TOKEN&&!env.CENTRAL_SYNC_DEVICE_TOKEN))return;
  const client=await pool.connect();let rows:Array<Record<string,unknown>>=[];
  try{
    lastCentralAttemptAt=new Date().toISOString();
    await client.query('begin');
    const selected=await client.query<Record<string,unknown>>(
      `select * from sync_outbox where sync_status in ('PENDING','RETRY') and (next_retry_at is null or next_retry_at<=now()) order by device_sequence asc limit $1 for update skip locked`,
      [env.SYNC_PUSH_BATCH_SIZE],
    );rows=selected.rows;
    if(rows.length)await client.query(`update sync_outbox set sync_status='SENDING',last_attempt_at=now(),updated_at=now() where operation_id=any($1::uuid[])`,[rows.map(r=>r.operation_id)]);
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
  if(!rows.length)return;
  const batchId=randomUUID();
  try{
    const response=await fetch(`${env.CENTRAL_SYNC_API_BASE_URL.replace(/\/$/,'')}/sync/push`,{
      method:'POST',headers:{'content-type':'application/json',...(env.CENTRAL_SYNC_ACCESS_TOKEN?{authorization:`Bearer ${env.CENTRAL_SYNC_ACCESS_TOKEN}`}:{'x-sync-device-id':String(rows[0].device_id),'x-sync-device-token':env.CENTRAL_SYNC_DEVICE_TOKEN!}),'x-sync-batch-id':batchId},
      body:JSON.stringify({batchId,operations:rows.map(row=>({
        operationId:row.operation_id,deviceId:row.device_id,deviceSequence:Number(row.device_sequence),
        entityType:row.entity_type,entityId:row.entity_id,operation:row.operation_type,payload:row.payload,
        requestHash:row.payload_hash,baseVersion:row.local_base_version==null?null:Number(row.local_base_version),
        clientSchemaVersion:env.SYNC_SCHEMA_VERSION,appVersion:env.SYNC_APP_VERSION,
      }))}),
    });
    if(!response.ok)throw new Error(`CENTRAL_HTTP_${response.status}`);centralOnline=true;lastCentralError=null;
    const body=await response.json() as any;const results=Array.isArray(body?.data?.results)?body.data.results:[];
    const byId=new Map(results.map((result:any)=>[String(result.operationId),result]));
    for(const row of rows){
      const operationId=String(row.operation_id);const result:any=byId.get(operationId);
      if(!result){await markRetry(operationId,Number(row.attempt_count),'RESULT_MISSING','Central response did not include the operation.');continue}
      if(result.status==='ACCEPTED'||result.status==='ALREADY_APPLIED'){
        const applyClient=await pool.connect();try{
          await applyClient.query('begin');
          if(result.authoritativePayload)await applyAuthoritativeRow(applyClient,String(row.entity_type),String(row.entity_id),result.authoritativePayload,Number(result.centralVersion??0));
          await applyClient.query(`update sync_outbox set sync_status='ACKNOWLEDGED',acknowledged_at=now(),acknowledged_central_version=$2,central_result_id=$3,last_error_code=null,last_error_message=null,updated_at=now() where operation_id=$1`,[operationId,result.centralVersion??null,result.resultId??null]);
          await applyClient.query(`update sync_deferred_actions set status='CONFIRMED',safe_error_code=null,safe_error_message=null,completed_at=now(),updated_at=now() where operation_id=$1`,[operationId]);
          await applyClient.query(`update sync_local_state set last_push_at=now(),last_successful_sync_at=now(),updated_at=now() where singleton=true`);
          await applyClient.query('commit');
        }catch(error){await applyClient.query('rollback');throw error}finally{applyClient.release()}
      }else if(result.status==='CONFLICT'){
        await pool.query(`update sync_outbox set sync_status='CONFLICT',last_error_code='CONFLICT',last_error_message=$2,updated_at=now() where operation_id=$1`,[operationId,result.conflict?.code??'Central version conflict']);
        await pool.query(`insert into sync_conflicts(operation_id,device_id,company_id,branch_id,entity_type,entity_id,local_payload,local_base_version,central_payload,central_version,intended_action,conflict_code,conflict_reason) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13) on conflict(operation_id) do nothing`,[operationId,row.device_id,row.company_id,row.branch_id,row.entity_type,row.entity_id,JSON.stringify(row.payload),row.local_base_version,JSON.stringify(result.authoritativePayload??null),result.centralVersion??null,row.operation_type,result.conflict?.code??'CONFLICT','Central state differs from the local base version.']);
      }else if(result.status==='DEPENDENCY_PENDING'||result.status==='CENTRAL_PROCESSING_FAILED'){
        await markRetry(operationId,Number(row.attempt_count),result.errorCode??result.status,result.errorMessage??result.status);
        await pool.query(`update sync_deferred_actions set status='FAILED',attempt_count=attempt_count+1,safe_error_code=$2,safe_error_message=$3,updated_at=now() where operation_id=$1`,[operationId,result.errorCode??result.status,String(result.errorMessage??result.status).slice(0,500)]);
      }else{
        await pool.query(`update sync_outbox set sync_status='REJECTED',last_error_code=$2,last_error_message=$3,updated_at=now() where operation_id=$1`,[operationId,result.errorCode??result.status,String(result.errorMessage??result.status).slice(0,500)]);
      }
    }
  }catch(error){centralOnline=false;lastCentralError=(error as Error).message;for(const row of rows)await markRetry(String(row.operation_id),Number(row.attempt_count),'NETWORK_OR_PROTOCOL_ERROR',(error as Error).message)}
}

async function pullOnce():Promise<void>{
  if(!env.CENTRAL_SYNC_API_BASE_URL||(!env.CENTRAL_SYNC_ACCESS_TOKEN&&!env.CENTRAL_SYNC_DEVICE_TOKEN)||!env.SYNC_DEVICE_ID)return;
  const state=await pool.query<{last_central_cursor:string}>(`select last_central_cursor::text from sync_local_state where singleton=true`);
  const lastCursor=Number(state.rows[0]?.last_central_cursor??0);
  lastCentralAttemptAt=new Date().toISOString();const response=await fetch(`${env.CENTRAL_SYNC_API_BASE_URL.replace(/\/$/,'')}/sync/pull`,{
    method:'POST',headers:{'content-type':'application/json',...(env.CENTRAL_SYNC_ACCESS_TOKEN?{authorization:`Bearer ${env.CENTRAL_SYNC_ACCESS_TOKEN}`}:{'x-sync-device-id':env.SYNC_DEVICE_ID,'x-sync-device-token':env.CENTRAL_SYNC_DEVICE_TOKEN!})},
    body:JSON.stringify({deviceId:env.SYNC_DEVICE_ID,lastCursor,batchSize:env.SYNC_PULL_BATCH_SIZE}),
  });
  if(!response.ok)throw new Error(`CENTRAL_PULL_HTTP_${response.status}`);centralOnline=true;lastCentralError=null;
  const body=await response.json() as any;const data=body?.data;if(!data)return;
  if(data.resnapshotRequired){await pool.query(`update sync_local_state set resnapshot_required=true,updated_at=now() where singleton=true`);return}
  const changes=Array.isArray(data.changes)?data.changes:[];if(!changes.length)return;
  const client=await pool.connect();try{
    await client.query('begin');
    for(const change of changes){
      if(!writableEntities.has(String(change.entity_type)))continue;
      const pending=await client.query<Record<string,unknown>>(`select * from sync_outbox where entity_type=$1 and entity_id=$2::uuid and sync_status in ('PENDING','SENDING','RETRY','BLOCKED') order by device_sequence desc limit 1`,[change.entity_type,change.entity_id]);
      if(pending.rows[0]&&String(change.source_device_id??'')!==env.SYNC_DEVICE_ID){
        const local=await client.query<Record<string,unknown>>(`select * from ${change.entity_type} where id=$1::uuid`,[change.entity_id]);
        await client.query(`insert into sync_conflicts(operation_id,device_id,company_id,branch_id,entity_type,entity_id,local_payload,local_base_version,central_payload,central_version,intended_action,conflict_code,conflict_reason) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,'PULL_CONFLICT','Central change arrived while a local operation is pending.') on conflict(operation_id) do nothing`,[pending.rows[0].operation_id,pending.rows[0].device_id,pending.rows[0].company_id,pending.rows[0].branch_id,change.entity_type,change.entity_id,JSON.stringify(local.rows[0]??{}),pending.rows[0].local_base_version,JSON.stringify(change.authoritative_payload??null),change.authoritative_version,pending.rows[0].operation_type]);
        await client.query(`update sync_outbox set sync_status='CONFLICT',last_error_code='PULL_CONFLICT',updated_at=now() where operation_id=$1`,[pending.rows[0].operation_id]);
      }else{
        await applyAuthoritativeRow(client,String(change.entity_type),String(change.entity_id),change.authoritative_payload??null,Number(change.authoritative_version??0),Boolean(change.tombstone));
        const resolved=await client.query<{operation_id:string}>(
          `update sync_outbox set sync_status='ACKNOWLEDGED',acknowledged_at=now(),acknowledged_central_version=$3,
           last_error_code=null,last_error_message=null,updated_at=now()
           where entity_type=$1 and entity_id=$2::uuid and sync_status='CONFLICT' returning operation_id`,
          [change.entity_type,change.entity_id,change.authoritative_version??null],
        );
        if(resolved.rows.length)await client.query(
          `update sync_conflicts set status='RESOLVED',resolution_type='CENTRAL_REVIEW',resolution_payload=$2::jsonb,
           resolved_at=now(),resolution_notes='Resolved by a central conflict-review decision received through pull.'
           where operation_id=any($1::uuid[]) and status='OPEN'`,
          [resolved.rows.map(row=>row.operation_id),JSON.stringify(change.authoritative_payload??null)],
        );
      }
    }
    await client.query(`update sync_local_state set last_central_cursor=$1,last_pull_at=now(),last_successful_sync_at=now(),updated_at=now() where singleton=true`,[data.nextCursor]);
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

export async function runLocalSyncCycle(){
  if(!isLocalSyncNode()||running)return;running=true;
  try{
    const state=await pool.query<{snapshot_initialized_at:string|null;resnapshot_required:boolean}>(`select snapshot_initialized_at,resnapshot_required from sync_local_state where singleton=true`);
    // When retention requires a replacement snapshot, first drain every operation
    // that can still be accepted. The mirror is replaced only with no unresolved work.
    if(state.rows[0]?.snapshot_initialized_at&&state.rows[0]?.resnapshot_required)await pushOnce();
    if(!await ensureSnapshotReady())return;
    await pushOnce();await pullOnce();
  }catch(error){
    centralOnline=false;
    lastCentralError=(error as Error).message;
    console.error('[SYNC] Local sync cycle failed.',lastCentralError);
  }finally{running=false}
}
export function requestImmediateSync(){forceRequested=true;setTimeout(()=>{if(forceRequested){forceRequested=false;void runLocalSyncCycle()}},0)}
export function startLocalSyncWorker(){if(!isLocalSyncNode()||timer)return;void runLocalSyncCycle();timer=setInterval(()=>void runLocalSyncCycle(),env.SYNC_POLL_INTERVAL_MS);timer.unref()}
export function stopLocalSyncWorker(){if(timer)clearInterval(timer);timer=null}

export async function getLocalSyncStatus(){
  const counts=await pool.query<{sync_status:string;count:string}>(`select sync_status,count(*)::text count from sync_outbox group by sync_status`);
  const state=await pool.query<Record<string,unknown>>(`select * from sync_local_state where singleton=true`);
  const oldest=await pool.query<{committed_at:string|null}>(`select min(committed_at)::text committed_at from sync_outbox where sync_status in ('PENDING','SENDING','RETRY','BLOCKED','CONFLICT')`);
  const map=Object.fromEntries(counts.rows.map(row=>[row.sync_status,Number(row.count)]));
  const eligible=['PENDING','SENDING','RETRY','ACKNOWLEDGED','CONFLICT','REJECTED','BLOCKED'].reduce((sum,key)=>sum+(map[key]??0),0);
  const acknowledged=map.ACKNOWLEDGED??0;
  return {nodeRole:env.SYNC_NODE_ROLE,configured:Boolean(env.CENTRAL_SYNC_API_BASE_URL&&(env.CENTRAL_SYNC_ACCESS_TOKEN||env.CENTRAL_SYNC_DEVICE_TOKEN)),centralOnline,lastCentralError,lastCentralAttemptAt,counts:map,totalEligible:eligible,acknowledged,percentage:eligible===0?100:Math.floor(acknowledged/eligible*100),oldestPendingAt:oldest.rows[0]?.committed_at??null,state:state.rows[0]??null,running,canonicalState:canonicalJson(map)};
}
