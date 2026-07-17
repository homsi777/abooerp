import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { applyPushOperation, createScopedSnapshot, listOpenSyncConflicts, pullChanges, resolveSyncConflict, type SyncRequestContext } from '../sync/centralSyncService.js';
import { env } from '../config/env.js';
import { getLocalSyncStatus, requestImmediateSync } from '../sync/localSyncWorker.js';
import { pool } from '../db/pool.js';
import { loadUserContextByUserId } from '../auth/userContext.js';

const operationSchema = z.object({
  operationId: z.string().uuid(), deviceId: z.string().uuid(),
  deviceSequence: z.number().int().positive(), entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(), operation: z.enum(['UPSERT','DELETE','ACTION']),
  payload: z.record(z.string(),z.unknown()), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseVersion: z.number().int().nonnegative().nullable().optional(),
  clientSchemaVersion: z.string().min(1).max(128), appVersion: z.string().min(1).max(64),
});
const pushSchema=z.object({batchId:z.string().uuid(),operations:z.array(operationSchema).min(1).max(100)});
const pullSchema=z.object({deviceId:z.string().uuid(),lastCursor:z.number().int().nonnegative(),batchSize:z.number().int().min(1).max(500).default(200)});
const activateSchema=z.object({machineId:z.string().uuid(),deviceName:z.string().min(1).max(255),branchId:z.string().uuid().optional(),appVersion:z.string().max(64),schemaVersion:z.string().max(128)});

async function requireCentralSyncIdentity(req:Request,res:Response,next:NextFunction){
  if((req as any).requestUserContext){next();return}
  const deviceId=String(req.headers['x-sync-device-id']??'');const token=String(req.headers['x-sync-device-token']??'');
  if(!deviceId||!token){res.status(401).json({success:false,error:'SYNC_DEVICE_AUTH_REQUIRED'});return}
  const result=await pool.query<{sync_secret_hash:string|null;registered_by:string|null;company_id:string;branch_id:string|null;sync_state:string;is_blocked:boolean}>(`select sync_secret_hash,registered_by,company_id,branch_id,sync_state,is_blocked from linked_devices where id=$1::uuid`,[deviceId]).catch(()=>({rows:[]} as any));
  const device=result.rows[0];const actual=createHash('sha256').update(token).digest();const expected=device?.sync_secret_hash?Buffer.from(device.sync_secret_hash,'hex'):Buffer.alloc(0);
  if(!device||device.is_blocked||device.sync_state!=='active'||!device.registered_by||expected.length!==actual.length||!timingSafeEqual(expected,actual)){
    res.status(403).json({success:false,error:'SYNC_DEVICE_REVOKED'});return
  }
  const user=await loadUserContextByUserId(device.registered_by);if(!user||user.status!=='active'||user.companyId!==device.company_id){res.status(403).json({success:false,error:'SYNC_USER_REVOKED'});return}
  const deviceBranches=device.branch_id?[device.branch_id]:user.allowedBranchIds;
  if(!deviceBranches.length){res.status(403).json({success:false,error:'SYNC_BRANCH_SCOPE_REQUIRED'});return}
  const enriched={...user,allowedBranchIds:deviceBranches,activeBranchId:device.branch_id??user.scope.branchId,scope:{...user.scope,branchId:device.branch_id??user.scope.branchId}};
  (req as any).requestUserContext=enriched;(req as any).requestScope=enriched.scope;(req as any).requestContext={...enriched.scope,companyId:enriched.companyId,baseCurrency:enriched.baseCurrency};next();
}

function contextFromRequest(req:any):SyncRequestContext{
  const user=req.requestUserContext;
  if(!user?.companyId) throw new HttpError(401,'Authentication required.');
  const allowedBranchIds=Array.isArray(user.allowedBranchIds)?user.allowedBranchIds:[];
  if(!allowedBranchIds.length) throw new HttpError(403,'SYNC_BRANCH_SCOPE_REQUIRED');
  return {companyId:user.companyId,userId:user.userId,allowedBranchIds,agentId:user.agentId??user.scope?.agentId};
}

export function createSyncRouter(){
  const router=Router();
  router.get('/bootstrap-status',asyncHandler(async(_req,res)=>{
    if(env.SYNC_NODE_ROLE!=='local'){res.json({success:true,data:{ready:true,nodeRole:env.SYNC_NODE_ROLE}});return}
    const state=await pool.query<{snapshot_initialized_at:string|null;offline_grant_expires_at:string|null;resnapshot_required:boolean}>(`select snapshot_initialized_at,offline_grant_expires_at,resnapshot_required from sync_local_state where singleton=true`);
    const row=state.rows[0];
    res.json({success:true,data:{ready:Boolean(row?.snapshot_initialized_at&&!row.resnapshot_required),snapshotInitializedAt:row?.snapshot_initialized_at??null,offlineGrantExpiresAt:row?.offline_grant_expires_at??null}});
  }));
  router.get('/status',requirePermissions(['sync.status.read']),asyncHandler(async(_req,res)=>{
    res.json({success:true,data:await getLocalSyncStatus()});
  }));
  router.post('/retry',requirePermissions(['sync.retry']),asyncHandler(async(_req,res)=>{
    if(env.SYNC_NODE_ROLE!=='local') throw new HttpError(409,'Retry is available on the local desktop node only.');
    requestImmediateSync();res.status(202).json({success:true,data:{scheduled:true}});
  }));
  router.post('/device-activate',requirePermissions(['shipments.write']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Device activation is available on the central node only.');
    const body=activateSchema.parse(req.body);const context=contextFromRequest(req);const user=(req as any).requestUserContext;
    const branchId=body.branchId??user.activeBranchId??user.scope?.branchId??null;
    if(!branchId) throw new HttpError(400,'DEVICE_BRANCH_SCOPE_REQUIRED');
    if(!context.allowedBranchIds.includes(branchId)) throw new HttpError(403,'DEVICE_BRANCH_SCOPE_REJECTED');
    const branch=await pool.query(`select 1 from branches where id=$1::uuid and company_id=$2::uuid and is_active=true`,[branchId,context.companyId]);
    if(!branch.rowCount) throw new HttpError(403,'DEVICE_BRANCH_SCOPE_REJECTED');
    const isAdmin=['admin','general_manager'].includes(String(user.roleCode??''));
    const device=await pool.query<{id:string;is_approved:boolean;is_blocked:boolean;sync_state:string}>(
      `insert into linked_devices(id,machine_id,device_name,os_type,company_id,branch_id,is_approved,registered_by,app_version,local_schema_version,sync_state)
       values($1::uuid,$1::text,$2,'windows',$3,$4,$5,$6,$7,$8,'active')
       on conflict(machine_id) do update set device_name=excluded.device_name,branch_id=excluded.branch_id,registered_by=excluded.registered_by,app_version=excluded.app_version,local_schema_version=excluded.local_schema_version,last_seen_at=now(),updated_at=now()
       returning id,is_approved,is_blocked,sync_state`,
      [body.machineId,body.deviceName,context.companyId,branchId,isAdmin,context.userId,body.appVersion,body.schemaVersion],
    );
    const record=device.rows[0];if(record.is_blocked||record.sync_state!=='active') throw new HttpError(403,'DEVICE_REVOKED');
    if(!record.is_approved){res.status(202).json({success:false,error:'DEVICE_PENDING_APPROVAL',data:{deviceId:record.id}});return}
    const secret=randomBytes(32).toString('base64url');const secretHash=createHash('sha256').update(secret).digest('hex');
    await pool.query(`update linked_devices set sync_secret_hash=$2,sync_credential_issued_at=now(),last_seen_at=now(),updated_at=now() where id=$1`,[record.id,secretHash]);
    res.json({success:true,data:{deviceId:record.id,deviceToken:secret}});
  }));
  router.post('/push',requireCentralSyncIdentity,requirePermissions(['shipments.write']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Push endpoint is available on the central node only.');
    const body=pushSchema.parse(req.body);const context=contextFromRequest(req);const results=[];
    for(const operation of body.operations) results.push(await applyPushOperation(context,operation));
    res.json({success:true,data:{batchId:body.batchId,results,serverTimestamp:new Date().toISOString()}});
  }));
  router.post('/pull',requireCentralSyncIdentity,requirePermissions(['shipments.read']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Pull endpoint is available on the central node only.');
    const body=pullSchema.parse(req.body);const data=await pullChanges(contextFromRequest(req),body);
    if(data.deviceRejected) throw new HttpError(403,'DEVICE_REVOKED');
    res.json({success:true,data:{...data,serverTimestamp:new Date().toISOString()}});
  }));
  router.post('/snapshot',requireCentralSyncIdentity,requirePermissions(['shipments.read']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Snapshot endpoint is available on the central node only.');
    const {deviceId}=z.object({deviceId:z.string().uuid()}).parse(req.body);
    if(String(req.headers['x-sync-device-id']??deviceId)!==deviceId) throw new HttpError(403,'DEVICE_ID_MISMATCH');
    res.json({success:true,data:await createScopedSnapshot(contextFromRequest(req))});
  }));
  router.get('/conflicts',requireCentralSyncIdentity,requirePermissions(['sync.conflicts.resolve']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Conflict review is available on the central node only.');
    const limit=z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit);
    res.json({success:true,data:await listOpenSyncConflicts(contextFromRequest(req),limit)});
  }));
  router.post('/conflicts/:id/resolve',requireCentralSyncIdentity,requirePermissions(['sync.conflicts.resolve']),asyncHandler(async(req,res)=>{
    if(env.SYNC_NODE_ROLE!=='central') throw new HttpError(409,'Conflict resolution is available on the central node only.');
    const id=z.string().uuid().parse(req.params.id);
    const body=z.object({resolution:z.enum(['KEEP_CENTRAL','APPLY_LOCAL','APPLY_EDITED']),editedPayload:z.record(z.string(),z.unknown()).optional(),notes:z.string().max(2000).optional()}).parse(req.body);
    res.json({success:true,data:await resolveSyncConflict(contextFromRequest(req),id,body.resolution,body.editedPayload,body.notes)});
  }));
  return router;
}
