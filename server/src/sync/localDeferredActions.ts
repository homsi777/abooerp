import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';

export async function queuePostShipmentsAction(input:{companyId:string;branchId:string;userId?:string;payload:Record<string,unknown>}){
  const client=await pool.connect();try{
    await client.query('begin');
    const state=(await client.query<{device_id:string}>(`select device_id from sync_local_state where singleton=true for update`)).rows[0];
    if(!state?.device_id)throw new Error('LOCAL_SYNC_IDENTITY_REQUIRED');
    const operationId=randomUUID();const entityId=randomUUID();
    const sequence=Number((await client.query<{value:string}>(`select nextval('sync_device_sequence')::text value`)).rows[0].value);
    const payload={action:'POST_DAILY_LEDGER_SHIPMENTS',...input.payload};
    const hash=(await client.query<{hash:string}>(`select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash`,[JSON.stringify(payload)])).rows[0].hash;
    await client.query(
      `insert into sync_outbox(operation_id,device_id,device_sequence,company_id,branch_id,user_id,entity_type,entity_id,operation_type,payload,payload_hash,local_base_version)
       values($1,$2,$3,$4,$5,$6,'central_action.post_shipments',$7,'ACTION',$8::jsonb,$9,0)`,
      [operationId,state.device_id,sequence,input.companyId,input.branchId,input.userId??null,entityId,JSON.stringify(payload),hash],
    );
    await client.query(
      `insert into sync_deferred_actions(operation_id,company_id,branch_id,entity_type,entity_id,action_type,payload)
       values($1,$2,$3,'daily_ledger_rows',$4,'CENTRAL_ACTION',$5::jsonb)`,
      [operationId,input.companyId,input.branchId,entityId,JSON.stringify(payload)],
    );
    await client.query('commit');return{operationId,entityId,deviceSequence:sequence};
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}
