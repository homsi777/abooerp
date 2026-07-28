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
const mirroredEntities = new Set([...writableEntities,'cashboxes','payment_vouchers','transfers']);
const softDeleteEntities = new Set([
  'daily_ledger_sessions','daily_ledger_rows','daily_ledger_dispatch_definitions',
]);
let timer: NodeJS.Timeout | null=null;let running=false;let forceRequested=false;
let centralOnline:boolean|null=null;let lastCentralError:string|null=null;let lastCentralAttemptAt:string|null=null;
const columnCache=new Map<string,Set<string>>();
const foreignKeyCache=new Map<string,Array<{columnName:string;referencedTable:string;referencedColumn:string;nullable:boolean}>>();

function serializeValue(value:unknown):unknown{
  if(value!==null&&typeof value==='object'&&!(value instanceof Date))return JSON.stringify(value);
  return value;
}

function rememberInsertedKeys(target:Map<string,Map<string,Set<string>>>,table:string,row:Record<string,unknown>){
  let columns=target.get(table);
  if(!columns){columns=new Map();target.set(table,columns)}
  for(const [column,value] of Object.entries(row)){
    if(value===null||value===undefined||typeof value==='object')continue;
    let values=columns.get(column);
    if(!values){values=new Set();columns.set(column,values)}
    values.add(String(value));
  }
}

async function hasReferencedParent(
  client:PoolClient,
  included:Map<string,Map<string,Set<string>>>,
  table:string,
  column:string,
  value:unknown,
){
  if(value===null||value===undefined)return true;
  if(included.has(table))return Boolean(included.get(table)?.get(column)?.has(String(value)));
  if(!/^[a-z_][a-z0-9_]*$/i.test(table)||!/^[a-z_][a-z0-9_]*$/i.test(column))return false;
  const existing=await client.query(`select 1 from ${table} where ${column}=$1 limit 1`,[value]);
  return Boolean(existing.rowCount);
}

async function tableColumns(client:PoolClient,table:string){
  const cached=columnCache.get(table);if(cached)return cached;
  const result=await client.query<{column_name:string}>(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,[table],
  );
  const columns=new Set(result.rows.map((row)=>row.column_name));columnCache.set(table,columns);return columns;
}

async function singleColumnForeignKeys(client:PoolClient,table:string){
  const cached=foreignKeyCache.get(table);if(cached)return cached;
  const result=await client.query<{column_name:string;referenced_table:string;referenced_column:string;nullable:boolean}>(
    `select attribute.attname column_name,constraint_row.confrelid::regclass::text referenced_table,
            referenced.attname referenced_column, not attribute.attnotnull nullable
       from pg_constraint constraint_row
       join pg_attribute attribute
         on attribute.attrelid=constraint_row.conrelid and attribute.attnum=constraint_row.conkey[1]
       join pg_attribute referenced
         on referenced.attrelid=constraint_row.confrelid and referenced.attnum=constraint_row.confkey[1]
      where constraint_row.contype='f' and constraint_row.conrelid=$1::regclass
        and array_length(constraint_row.conkey,1)=1`,
    [table],
  );
  const rows=result.rows.map(row=>({
    columnName:row.column_name,
    referencedTable:row.referenced_table.replace(/^public\./,''),
    referencedColumn:row.referenced_column,
    nullable:row.nullable,
  }));
  foreignKeyCache.set(table,rows);return rows;
}

async function normalizeMissingForeignKeys(client:PoolClient,table:string,row:Record<string,unknown>){
  const normalized={...row};
  for(const foreignKey of await singleColumnForeignKeys(client,table)){
    const value=normalized[foreignKey.columnName];
    if(value===null||value===undefined)continue;
    // Identifiers come from pg_catalog for tables we already sync; keep them quoted-safe.
    if(!/^[a-z_][a-z0-9_]*$/i.test(foreignKey.referencedTable)||!/^[a-z_][a-z0-9_]*$/i.test(foreignKey.referencedColumn))continue;
    const exists=await client.query(
      `select 1 from ${foreignKey.referencedTable} where ${foreignKey.referencedColumn}=$1 limit 1`,
      [value],
    );
    if(!exists.rowCount){
      if(foreignKey.nullable)normalized[foreignKey.columnName]=null;
      else throw new Error(`SYNC_DEPENDENCY_MISSING:${table}.${foreignKey.columnName}->${foreignKey.referencedTable}.${foreignKey.referencedColumn}`);
    }
  }
  return normalized;
}

/** Keep a local ledger row on its newer session when central tries to pull it onto an older date. */
async function preferNewerLedgerSession(
  client:PoolClient,
  entityId:string,
  row:Record<string,unknown>,
):Promise<Record<string,unknown>>{
  if(!row.session_id)return row;
  const local=await client.query<{session_id:string;ledger_date:string;row_no:number}>(
    `select r.session_id::text session_id, s.ledger_date::text ledger_date, r.row_no
       from daily_ledger_rows r
       join daily_ledger_sessions s on s.id=r.session_id
      where r.id=$1::uuid and r.deleted_at is null and s.deleted_at is null`,
    [entityId],
  );
  const incoming=await client.query<{ledger_date:string}>(
    `select ledger_date::text ledger_date from daily_ledger_sessions where id=$1::uuid and deleted_at is null`,
    [row.session_id],
  );
  const localRow=local.rows[0];
  const incomingDate=incoming.rows[0]?.ledger_date;
  if(localRow&&incomingDate&&localRow.session_id!==String(row.session_id)&&localRow.ledger_date>incomingDate){
    console.warn('[SYNC] Refusing to move ledger row onto an older session date.',{
      entityId,localSession:localRow.session_id,localDate:localRow.ledger_date,
      incomingSession:row.session_id,incomingDate,
    });
    // Keep local row_no too — applying the old session's row_no into today's session
    // hits uq_daily_ledger_rows_row_no and aborts the whole sync cycle.
    return {...row,session_id:localRow.session_id,row_no:localRow.row_no};
  }
  return row;
}

async function applyAuthoritativeRow(client:PoolClient,entityType:string,entityId:string,payload:Record<string,unknown>|null,version:number,tombstone=false){
  if(!mirroredEntities.has(entityType))return;
  await client.query(`select set_config('app.sync_suppress_feed','1',true)`);
  await client.query(`select set_config('app.sync_suppress_outbox','1',true)`);
  if(tombstone||!payload){
    if(softDeleteEntities.has(entityType)) await client.query(`update ${entityType} set deleted_at=coalesce(deleted_at,now()),sync_central_version=$2 where id=$1::uuid`,[entityId,version]);
    else await client.query(`delete from ${entityType} where id=$1::uuid`,[entityId]);
    return;
  }
  const allowed=await tableColumns(client,entityType);
  let sanitized=await normalizeMissingForeignKeys(client,entityType,payload);
  if(entityType==='daily_ledger_rows'){
    sanitized=await preferNewerLedgerSession(client,entityId,sanitized);
  }
  const entries=Object.entries(sanitized).filter(([key])=>key!=='id'&&key!=='sync_central_version'&&key!=='sync_version'&&allowed.has(key));
  const exists=await client.query(`select 1 from ${entityType} where id=$1::uuid`,[entityId]);
  // Ensure version columns appear once even when the central payload already carries them.
  const updateEntries=Object.entries({
    ...Object.fromEntries(entries),
    sync_central_version:version,
    sync_version:version,
  });
  if(exists.rowCount){
    const assignments=updateEntries.map(([key],index)=>`${key}=$${index+2}`);
    await client.query(`update ${entityType} set ${assignments.join(',')} where id=$1::uuid`,[entityId,...updateEntries.map(([,value])=>serializeValue(value))]);
  }else{
    const keys=['id',...entries.map(([key])=>key),'sync_central_version','sync_version'];
    const values=[entityId,...entries.map(([,value])=>serializeValue(value)),version,version];
    await client.query(`insert into ${entityType}(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')})`,values);
  }
}

const snapshotOrder=[
  'companies','roles','permissions','branches','agents','users','role_permissions','user_branches',
  'currencies','cashboxes','cities','goods_types','tariffs','drivers','vehicles','customers','senders_receivers',
  'system_settings','printers','shipments','transfers','shipment_status_history','manifests','manifest_shipments',
  'daily_ledger_sessions','daily_ledger_dispatch_definitions','daily_ledger_row_transfers',
  'daily_ledger_rows','daily_ledger_row_transfer_items','daily_ledger_print_events','daily_ledger_print_documents',
];

async function upsertSnapshotRow(client:PoolClient,table:string,row:Record<string,unknown>,includedKeys:Map<string,Map<string,Set<string>>>):Promise<Record<string,unknown>|undefined>{
  let normalizedRow={...row};
  for(const foreignKey of await singleColumnForeignKeys(client,table)){
    const value=normalizedRow[foreignKey.columnName];
    if(!await hasReferencedParent(client,includedKeys,foreignKey.referencedTable,foreignKey.referencedColumn,value)){
      if(foreignKey.nullable)normalizedRow[foreignKey.columnName]=null;
      else{
        console.warn('[SYNC] Skipped scoped snapshot row with an unavailable required parent.',{table,id:normalizedRow.id,column:foreignKey.columnName,referencedTable:foreignKey.referencedTable,referencedColumn:foreignKey.referencedColumn});
        return undefined;
      }
    }
  }
  if(table==='daily_ledger_rows'&&normalizedRow.id){
    normalizedRow=await preferNewerLedgerSession(client,String(normalizedRow.id),normalizedRow);
  }
  const allowed=await tableColumns(client,table);const entries=Object.entries(normalizedRow).filter(([key])=>allowed.has(key));
  if(!entries.length)return undefined;
  if(table==='manifest_shipments'){
    const keys=entries.map(([key])=>key);const values=entries.map(([,value])=>serializeValue(value));
    await client.query(`insert into manifest_shipments(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) on conflict(manifest_id,shipment_id) do update set created_at=excluded.created_at`,values);return undefined;
  }
  const id=normalizedRow.id;if(!id)return undefined;const withoutId=entries.filter(([key])=>key!=='id');const keys=['id',...withoutId.map(([key])=>key)];const values=[id,...withoutId.map(([,value])=>serializeValue(value))];
  const updates=withoutId.map(([key])=>`${key}=excluded.${key}`);
  await client.query(`insert into ${table}(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) on conflict(id) do update set ${updates.length?updates.join(','):'id=excluded.id'}`,values);
  return normalizedRow;
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
    // Built incrementally, in snapshotOrder's dependency order, using only rows that were
    // actually inserted — a row skipped for a missing parent (e.g. currency code USD)
    // must not appear as a valid parent for its own dependents (e.g. shipment_status_history),
    // or the later insert trips a hard FK violation and rolls back the entire snapshot.
    // Keys are tracked by referenced column (id AND code, etc.) because some FKs point at
    // unique business keys rather than UUID primary keys.
    const includedKeys=new Map<string,Map<string,Set<string>>>();
    for(const table of snapshotOrder){
      const rows=Array.isArray(snapshot.data?.[table])?snapshot.data[table]:[];
      // Mark the table as in-scope even when empty so dependents cannot slip through.
      if(!includedKeys.has(table))includedKeys.set(table,new Map());
      for(const row of rows){
        const inserted=await upsertSnapshotRow(client,table,row,includedKeys);
        if(inserted)rememberInsertedKeys(includedKeys,table,inserted);
      }
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
  const state=await pool.query<{snapshot_initialized_at:string|null;resnapshot_required:boolean;offline_grant_expires_at:string|null}>(
    `select snapshot_initialized_at,resnapshot_required,offline_grant_expires_at from sync_local_state where singleton=true`,
  );
  const grantActive=Boolean(
    state.rows[0]?.offline_grant_expires_at&&Date.parse(state.rows[0].offline_grant_expires_at)>Date.now(),
  );
  if(state.rows[0]?.snapshot_initialized_at&&!state.rows[0]?.resnapshot_required&&grantActive)return true;
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
    // Re-hash from the payload object actually sent. The stored payload_hash can diverge after
    // jsonb round-trips (numeric/text coercion), which made central reject with PAYLOAD_HASH_INVALID.
    const operations=[];
    for(const row of rows){
      const payload=row.payload&&typeof row.payload==='object'?row.payload as Record<string,unknown>:{};
      const hashResult=await pool.query<{hash:string}>(
        `select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash`,
        [JSON.stringify(payload)],
      );
      operations.push({
        operationId:row.operation_id,deviceId:row.device_id,deviceSequence:Number(row.device_sequence),
        entityType:row.entity_type,entityId:row.entity_id,operation:row.operation_type,payload,
        requestHash:hashResult.rows[0]?.hash??row.payload_hash,baseVersion:row.local_base_version==null?null:Number(row.local_base_version),
        clientSchemaVersion:env.SYNC_SCHEMA_VERSION,appVersion:env.SYNC_APP_VERSION,
      });
    }
    const response=await fetch(`${env.CENTRAL_SYNC_API_BASE_URL.replace(/\/$/,'')}/sync/push`,{
      method:'POST',headers:{'content-type':'application/json',...(env.CENTRAL_SYNC_ACCESS_TOKEN?{authorization:`Bearer ${env.CENTRAL_SYNC_ACCESS_TOKEN}`}:{'x-sync-device-id':String(rows[0].device_id),'x-sync-device-token':env.CENTRAL_SYNC_DEVICE_TOKEN!}),'x-sync-batch-id':batchId},
      body:JSON.stringify({batchId,operations}),
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
          const entityType=String(row.entity_type);
          const authoritative=result.authoritativePayload as Record<string,unknown>|undefined;
          if(authoritative)await applyAuthoritativeRow(applyClient,entityType,String(row.entity_id),authoritative,Number(result.centralVersion??0));
          if(
            (entityType==='central_action.transfer_complete'||entityType==='central_action.transfer_cancel')&&
            authoritative?.actionResult&&typeof authoritative.actionResult==='object'
          ){
            const actionResult=authoritative.actionResult as Record<string,unknown>;
            const transferResult=actionResult.transfer&&typeof actionResult.transfer==='object'
              ?actionResult.transfer as Record<string,unknown>
              :actionResult;
            const cashboxResult=actionResult.cashbox&&typeof actionResult.cashbox==='object'
              ?actionResult.cashbox as Record<string,unknown>
              :null;
            const paymentVoucherResult=actionResult.paymentVoucher&&typeof actionResult.paymentVoucher==='object'
              ?actionResult.paymentVoucher as Record<string,unknown>
              :null;
            let localCashboxId=cashboxResult?.id?String(cashboxResult.id):null;
            if(cashboxResult?.id){
              const matchingLocalCashbox=await applyClient.query<{id:string}>(
                `select id
                   from cashboxes
                  where company_id=$1::uuid
                    and (
                      (agent_id=$2::uuid and upper(currency_code)=upper($3::text))
                      or code=$4::text
                    )
                  order by case when agent_id=$2::uuid and upper(currency_code)=upper($3::text) then 0 else 1 end
                  limit 1`,
                [
                  cashboxResult.company_id,
                  cashboxResult.agent_id??null,
                  cashboxResult.currency_code,
                  cashboxResult.code,
                ],
              );
              if(matchingLocalCashbox.rows[0]?.id){
                localCashboxId=matchingLocalCashbox.rows[0].id;
              }else{
                await applyAuthoritativeRow(
                  applyClient,
                  'cashboxes',
                  String(cashboxResult.id),
                  cashboxResult,
                  Number(cashboxResult.sync_version??0),
                );
              }
            }
            if(paymentVoucherResult?.id){
              await applyAuthoritativeRow(
                applyClient,
                'payment_vouchers',
                String(paymentVoucherResult.id),
                {
                  ...paymentVoucherResult,
                  cashbox_id:localCashboxId??paymentVoucherResult.cashbox_id,
                },
                Number(paymentVoucherResult.sync_version??0),
              );
            }
            await applyAuthoritativeRow(
              applyClient,
              'transfers',
              String(row.entity_id),
              {
                ...transferResult,
                posted_cashbox_id:localCashboxId??transferResult.posted_cashbox_id,
                payout_cashbox_id:localCashboxId??transferResult.payout_cashbox_id,
              },
              Number(transferResult.sync_version??0),
            );
          }
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
      if(!mirroredEntities.has(String(change.entity_type)))continue;
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
    await client.query(
      `update sync_local_state set last_central_cursor=$1,offline_grant_expires_at=$2::timestamptz,
       last_pull_at=now(),last_successful_sync_at=now(),updated_at=now() where singleton=true`,
      [data.nextCursor,data.offlineGrantExpiresAt??new Date(Date.now()+env.OFFLINE_AUTH_MAX_AGE_HOURS*3600000).toISOString()],
    );
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
