import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';

async function queueCentralAction(input:{
  companyId:string;
  branchId:string;
  userId?:string;
  entityType:string;
  entityId?:string;
  payload:Record<string,unknown>;
}){
  const client=await pool.connect();try{
    await client.query('begin');
    const state=(await client.query<{device_id:string}>(`select device_id from sync_local_state where singleton=true for update`)).rows[0];
    if(!state?.device_id)throw new Error('LOCAL_SYNC_IDENTITY_REQUIRED');
    const operationId=randomUUID();const entityId=input.entityId??randomUUID();
    const sequence=Number((await client.query<{value:string}>(`select nextval('sync_device_sequence')::text value`)).rows[0].value);
    const payload=input.payload;
    const hash=(await client.query<{hash:string}>(`select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash`,[JSON.stringify(payload)])).rows[0].hash;
    await client.query(
      `insert into sync_outbox(operation_id,device_id,device_sequence,company_id,branch_id,user_id,entity_type,entity_id,operation_type,payload,payload_hash,local_base_version)
       values($1,$2,$3,$4,$5,$6,$7,$8,'ACTION',$9::jsonb,$10,0)`,
      [operationId,state.device_id,sequence,input.companyId,input.branchId,input.userId??null,input.entityType,entityId,JSON.stringify(payload),hash],
    );
    await client.query(
      `insert into sync_deferred_actions(operation_id,company_id,branch_id,entity_type,entity_id,action_type,payload)
       values($1,$2,$3,$4,$5,'CENTRAL_ACTION',$6::jsonb)`,
      [operationId,input.companyId,input.branchId,input.entityType,entityId,JSON.stringify(payload)],
    );
    await client.query('commit');return{operationId,entityId,deviceSequence:sequence};
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

export async function queuePostShipmentsAction(input:{companyId:string;branchId:string;userId?:string;payload:Record<string,unknown>}){
  return queueCentralAction({
    ...input,
    entityType:'central_action.post_shipments',
    payload:{action:'POST_DAILY_LEDGER_SHIPMENTS',...input.payload},
  });
}

export async function queueCompleteTransferAction(input:{
  companyId:string;branchId:string;userId?:string;transferId:string;cashboxId:string;voucherNo?:string;
}){
  return queueCentralAction({
    companyId:input.companyId,
    branchId:input.branchId,
    userId:input.userId,
    entityType:'central_action.transfer_complete',
    entityId:input.transferId,
    payload:{action:'COMPLETE_TRANSFER',transferId:input.transferId,cashboxId:input.cashboxId,voucherNo:input.voucherNo},
  });
}

export async function queueCancelTransferAction(input:{
  companyId:string;branchId:string;userId?:string;transferId:string;reason?:string;
}){
  return queueCentralAction({
    companyId:input.companyId,
    branchId:input.branchId,
    userId:input.userId,
    entityType:'central_action.transfer_cancel',
    entityId:input.transferId,
    payload:{action:'CANCEL_TRANSFER',transferId:input.transferId,reason:input.reason},
  });
}
