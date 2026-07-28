import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const allowedLocalWritePaths=[
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/sync\/retry$/,
  /^\/api\/v1\/daily-ledger\/rows\/upsert$/,
  /^\/api\/v1\/daily-ledger\/rows\/upsert-batch$/,
  /^\/api\/v1\/daily-ledger\/rows\/delete$/,
  /^\/api\/v1\/daily-ledger\/rows\/post-shipments$/,
  /^\/api\/v1\/daily-ledger\/sessions\/cancel$/,
  /^\/api\/v1\/daily-ledger\/dispatch-definitions(?:\/[0-9a-f-]+)?$/i,
  /^\/api\/v1\/daily-ledger\/transfer\/(?:validate|confirm)$/,
  /^\/api\/v1\/daily-ledger\/print\/(?:record|document)$/,
  /^\/api\/v1\/daily-ledger\/print\/documents\/[0-9a-f-]+$/i,
  /^\/api\/v1\/daily-ledger\/client-logs$/,
  /^\/api\/v1\/transfers\/[0-9a-f-]+\/(?:complete|cancel)$/i,
];

export async function localOfflinePolicyMiddleware(req:Request,res:Response,next:NextFunction){
  if(env.SYNC_NODE_ROLE!=='local'||['GET','HEAD','OPTIONS'].includes(req.method)){next();return}
  if(!allowedLocalWritePaths.some(pattern=>pattern.test(req.path))){
    res.status(409).json({success:false,error:'CENTRAL_ACTION_REQUIRED',message:'هذا الإجراء يحتاج اتصالاً بالخادم المركزي ولا يُنفذ محلياً.'});return
  }
  if(req.path.startsWith('/api/v1/auth/')||req.path==='/api/v1/sync/retry'){next();return}
  const state=await pool.query<{snapshot_initialized_at:string|null;offline_grant_expires_at:string|null}>(`select snapshot_initialized_at,offline_grant_expires_at from sync_local_state where singleton=true`);
  const local=state.rows[0];
  if(!local?.snapshot_initialized_at){res.status(409).json({success:false,error:'LOCAL_SNAPSHOT_REQUIRED',message:'يجب إكمال تهيئة البيانات المحلية قبل بدء الإدخال.'});return}
  if(!local.offline_grant_expires_at||Date.parse(local.offline_grant_expires_at)<=Date.now()){
    res.status(403).json({success:false,error:'OFFLINE_AUTH_EXPIRED',message:'انتهت مدة السماح للعمل دون اتصال. اتصل بالخادم لتجديد المصادقة. لم تُحذف البيانات غير المزامنة.'});return
  }
  next();
}
