import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { config } from 'dotenv';

async function worker() {
  const { runMigrations } = await import('../db/migrate.js');
  const { pool } = await import('../db/pool.js');
  const { applyPushOperation, createScopedSnapshot, listOpenSyncConflicts, pullChanges, resolveSyncConflict } = await import('../sync/centralSyncService.js');
  const { applyScopedSnapshot } = await import('../sync/localSyncWorker.js');
  const { queuePostShipmentsAction } = await import('../sync/localDeferredActions.js');
  await runMigrations();
  const companyId = (await pool.query<{ id: string }>(`select id from companies limit 1`)).rows[0]?.id;
  assert.ok(companyId);
  const branchId = (await pool.query<{ id: string }>(`insert into branches(code,name,company_id) values($1,'Sync branch',$2) returning id`, [`SYNC-${Date.now()}`, companyId])).rows[0].id;
  const otherBranchId = (await pool.query<{ id: string }>(`insert into branches(code,name,company_id) values($1,'Other branch',$2) returning id`, [`OTHER-${Date.now()}`, companyId])).rows[0].id;
  const roleId = (await pool.query<{ id: string }>(`insert into roles(code,name,company_id) values($1,'Sync role',$2) returning id`, [`sync-role-${Date.now()}`, companyId])).rows[0].id;
  const userId = (await pool.query<{ id: string }>(`insert into users(username,full_name,password_hash,role_id,role,company_id,branch_id) values($1,'Sync user','test-only',$2,'admin',$3,$4) returning id`, [`sync-${Date.now()}`, roleId, companyId, branchId])).rows[0].id;
  const deviceId = randomUUID();
  const secondDeviceId = randomUUID();
  for (const id of [deviceId, secondDeviceId]) await pool.query(
    `insert into linked_devices(id,machine_id,device_name,company_id,branch_id,is_approved,approved_by,approved_at,registered_by,sync_state)
     values($1::uuid,$1::text,'Sync smoke',$2,$3,true,$4,now(),$4,'active')`, [id, companyId, branchId, userId],
  );
  const context = { companyId, userId, allowedBranchIds: [branchId] };
  const hash = async (payload: Record<string, unknown>) => (await pool.query<{ hash: string }>(`select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash`, [JSON.stringify(payload)])).rows[0].hash;
  const sessionId = randomUUID();
  const payload = { company_id: companyId, branch_id: branchId, ledger_date: '2099-01-01', line_label: `sync-${Date.now()}`, origin_label: 'smoke', created_by: userId, updated_by: userId };
  const operation = { operationId: randomUUID(), deviceId, deviceSequence: 1, entityType: 'daily_ledger_sessions', entityId: sessionId, operation: 'UPSERT' as const, payload, requestHash: await hash(payload), baseVersion: 0, clientSchemaVersion: '112_offline_sync_foundation', appVersion: 'smoke' };
  const accepted = await applyPushOperation(context, operation);
  assert.equal(accepted.status, 'ACCEPTED');
  const replay = await applyPushOperation(context, operation);
  assert.equal(replay.status, 'ALREADY_APPLIED');

  await pool.query(`update daily_ledger_sessions set origin_label='central-change' where id=$1`, [sessionId]);
  const conflictingPayload = { ...payload, origin_label: 'second-device-change' };
  const conflict = await applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceId: secondDeviceId, deviceSequence: 1, payload: conflictingPayload, requestHash: await hash(conflictingPayload) });
  assert.equal(conflict.status, 'CONFLICT');
  const openConflicts = await listOpenSyncConflicts(context);
  const openConflict = openConflicts.find((entry) => entry.entity_id === sessionId);
  assert.ok(openConflict);
  const resolution = await resolveSyncConflict(context, String(openConflict.id), 'APPLY_LOCAL', undefined, 'Integration smoke resolution');
  assert.equal((resolution.authoritativePayload as Record<string, unknown>)?.origin_label, 'second-device-change');

  const missingPayload = { session_id: randomUUID(), row_no: 1, destination: 'X', parcel_type: 'X', sender_name: 'X', receiver_name: 'X', created_by: userId, updated_by: userId };
  const dependency = await applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceSequence: 2, entityType: 'daily_ledger_rows', entityId: randomUUID(), payload: missingPayload, requestHash: await hash(missingPayload) });
  assert.equal(dependency.status, 'DEPENDENCY_PENDING');

  const wrongScopePayload = { ...payload, branch_id: otherBranchId, line_label: `wrong-${Date.now()}` };
  const scope = await applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceSequence: 3, entityId: randomUUID(), payload: wrongScopePayload, requestHash: await hash(wrongScopePayload) });
  assert.equal(scope.status, 'PERMISSION_REJECTED');

  const invalidRowPayload = { session_id: sessionId, row_no: 'not-an-integer', destination: 'X', parcel_type: 'X', sender_name: 'X', receiver_name: 'X', created_by: userId, updated_by: userId };
  const failedOperationId = randomUUID();
  const failed = await applyPushOperation(context, { ...operation, operationId: failedOperationId, deviceSequence: 4, entityType: 'daily_ledger_rows', entityId: randomUUID(), payload: invalidRowPayload, requestHash: await hash(invalidRowPayload) });
  assert.equal(failed.status, 'CENTRAL_PROCESSING_FAILED');
  const durableFailure = await pool.query(`select result_status,safe_error_code from sync_operation_results where operation_id=$1`, [failedOperationId]);
  assert.equal(durableFailure.rows[0]?.result_status, 'CENTRAL_PROCESSING_FAILED');

  const concurrentPayloadA = { ...payload, line_label: `concurrent-a-${Date.now()}` };
  const concurrentPayloadB = { ...payload, line_label: `concurrent-b-${Date.now()}` };
  const [concurrentA, concurrentB] = await Promise.all([
    applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceSequence: 5, entityId: randomUUID(), payload: concurrentPayloadA, requestHash: await hash(concurrentPayloadA) }),
    applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceId: secondDeviceId, deviceSequence: 2, entityId: randomUUID(), payload: concurrentPayloadB, requestHash: await hash(concurrentPayloadB) }),
  ]);
  assert.equal(concurrentA.status, 'ACCEPTED');
  assert.equal(concurrentB.status, 'ACCEPTED');
  const actionPayload = { action: 'POST_DAILY_LEDGER_SHIPMENTS', branchId, ledgerDate: '2099-01-01', lineLabel: 'no-matching-rows', rowIds: [] };
  const actionOperation = { ...operation, operationId: randomUUID(), deviceSequence: 6, entityType: 'central_action.post_shipments', entityId: randomUUID(), operation: 'ACTION' as const, payload: actionPayload, requestHash: await hash(actionPayload) };
  const deferredAction = await applyPushOperation(context, actionOperation);
  assert.equal(deferredAction.status, 'ACCEPTED');
  const deferredReplay = await applyPushOperation(context, actionOperation);
  assert.equal(deferredReplay.status, 'ALREADY_APPLIED');
  const snapshot = await createScopedSnapshot(context);
  assert.ok(Array.isArray(snapshot.data.daily_ledger_sessions));
  assert.ok((snapshot.data.branches as Array<Record<string, unknown>>).every((branch) => branch.id === branchId));
  const pulled = await pullChanges(context, { deviceId: secondDeviceId, lastCursor: 0, batchSize: 200 });
  assert.equal(pulled.deviceRejected, false);
  assert.ok(pulled.changes.length > 0);

  const local = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE, options: '-c app.node_role=local' });
  await local.connect();
  try {
    await local.query(`insert into sync_local_state(singleton,device_id,device_name,snapshot_initialized_at,offline_grant_expires_at) values(true,$1,'local-smoke',now(),now()+interval '1 day') on conflict(singleton) do update set device_id=excluded.device_id`, [secondDeviceId]);
    await local.query('begin');
    const localSession = (await local.query<{ id: string }>(`insert into daily_ledger_sessions(company_id,branch_id,ledger_date,line_label,origin_label,created_by,updated_by) values($1,$2,'2099-01-02',$3,'local',$4,$4) returning id`, [companyId, branchId, `local-${Date.now()}`, userId])).rows[0];
    assert.equal(Number((await local.query(`select count(*) count from sync_outbox where entity_id=$1`, [localSession.id])).rows[0].count), 1);
    await local.query('rollback');
    assert.equal(Number((await local.query(`select count(*) count from sync_outbox where entity_id=$1`, [localSession.id])).rows[0].count), 0);
  } finally { await local.end(); }

  await pool.query(`update linked_devices set sync_state='revoked' where id=$1`, [deviceId]);
  const revokedPayload = { ...payload, line_label: `revoked-${Date.now()}` };
  const revoked = await applyPushOperation(context, { ...operation, operationId: randomUUID(), deviceSequence: 7, entityId: randomUUID(), payload: revokedPayload, requestHash: await hash(revokedPayload) });
  assert.equal(revoked.status, 'DEVICE_REVOKED');
  const feedCount = Number((await pool.query(`select count(*) count from sync_change_feed where company_id=$1`, [companyId])).rows[0].count);
  assert.ok(feedCount > 0);
  await pool.query(`insert into sync_local_state(singleton,device_id,device_name) values(true,$1,'snapshot-apply') on conflict(singleton) do update set device_id=excluded.device_id,snapshot_initialized_at=null`, [secondDeviceId]);
  await applyScopedSnapshot(snapshot);
  assert.equal(Number((await pool.query(`select count(*) count from branches where id=$1`, [branchId])).rows[0].count), 1);
  assert.equal(Number((await pool.query(`select count(*) count from branches where id=$1`, [otherBranchId])).rows[0].count), 0);
  assert.equal(Number((await pool.query(`select count(*) count from daily_ledger_sessions where id=$1`, [sessionId])).rows[0].count), 1);
  const queued=await queuePostShipmentsAction({companyId,branchId,userId,payload:{branchId,ledgerDate:'2099-01-01',lineLabel:'queued',rowIds:[]}});
  assert.equal(Number((await pool.query(`select count(*) count from sync_outbox where operation_id=$1 and operation_type='ACTION'`,[queued.operationId])).rows[0].count),1);
  assert.equal(Number((await pool.query(`select count(*) count from sync_deferred_actions where operation_id=$1`,[queued.operationId])).rows[0].count),1);
  const beforeInvalid=Number((await pool.query(`select count(*) count from sync_outbox`)).rows[0].count);
  await assert.rejects(()=>queuePostShipmentsAction({companyId,branchId:randomUUID(),userId,payload:{}}));
  assert.equal(Number((await pool.query(`select count(*) count from sync_outbox`)).rows[0].count),beforeInvalid);
  console.info('[OFFLINE-SYNC-SMOKE]', JSON.stringify({ accepted: accepted.status, replay: replay.status, conflict: conflict.status, conflictResolution: resolution.resolution, dependency: dependency.status, scope: scope.status, durableFailure: durableFailure.rows[0].result_status, concurrentDevices: [concurrentA.status, concurrentB.status], deferredAction: deferredAction.status, deferredReplay: deferredReplay.status, localDeferredQueueAtomicity:'PASS', scopedSnapshot: 'PASS', snapshotApplyAndPrune: 'PASS', incrementalPull: pulled.changes.length, atomicOutboxRollback: 'PASS', revoked: revoked.status, feedCount }));
  await pool.end();
}

async function backupWorker(){
  const {createEncryptedLocalMigrationBackup}=await import('../db/localMigrationBackup.js');
  const {decryptAndVerifyLocalBackup,runPgRestoreCustomDump}=await import('../db/localBackupRestore.js');
  const result=await createEncryptedLocalMigrationBackup('offline sync integration smoke');assert.ok(result);
  const target=path.join(process.env.SYNC_BACKUP_TEST_DIR!,'verified.dump');const verified=await decryptAndVerifyLocalBackup(result.path,process.env.LOCAL_BACKUP_KEY!,target);
  assert.equal(verified.sha256,result.sha256);assert.ok((await fs.stat(target)).size>0);
  const recovery=`almiya_restore_test_${Date.now()}`;assert.match(recovery,/^almiya_restore_test_\d+$/);const connection={host:process.env.PGHOST!,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER!,password:process.env.PGPASSWORD!};const admin=new pg.Client({...connection,database:'postgres'});await admin.connect();
  try{await admin.query(`create database "${recovery}"`);await runPgRestoreCustomDump(target,{...connection,database:recovery});const restored=new pg.Client({...connection,database:recovery});await restored.connect();try{const check=await restored.query(`select (select count(*) from schema_migrations)::int migrations,(select count(*) from sync_outbox)::int outbox`);assert.ok(Number(check.rows[0].migrations)>0);assert.ok(Number(check.rows[0].outbox)>0)}finally{await restored.end()}}finally{const exists=await admin.query(`select 1 from pg_database where datname=$1`,[recovery]);if(exists.rowCount)await admin.query(`drop database "${recovery}" with (force)`);await admin.end()}
  console.info('[OFFLINE-BACKUP-SMOKE]',JSON.stringify({encrypted:true,integrityVerified:true,pgRestoreListVerified:true,restoredIntoIsolatedDatabase:true,size:result.size}));
}

async function orchestrate() {
  config({ path: path.resolve('server/.env'), quiet: true });
  const database = `almiya_sync_test_${Date.now()}`;
  assert.match(database, /^almiya_sync_test_\d+$/);
  const admin = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`create database "${database}"`);
    const child = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve(process.argv[1]), '--worker'], {
      cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', PGDATABASE: database, SYNC_NODE_ROLE: 'central', ALLOW_DB_SEED: 'false' },
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, `sync smoke worker exited ${child.status}`);
    const backupDir=await fs.mkdtemp(path.join(os.tmpdir(),'almiya-backup-smoke-'));
    try{
      const backup=spawnSync(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),path.resolve(process.argv[1]),'--backup-worker'],{cwd:process.cwd(),stdio:'inherit',env:{...process.env,NODE_ENV:'test',PGDATABASE:database,SYNC_NODE_ROLE:'local',LOCAL_BACKUP_KEY:randomBytes(32).toString('base64'),APPDATA:backupDir,SYNC_BACKUP_TEST_DIR:backupDir}});
      if(backup.error)throw backup.error;assert.equal(backup.status,0,`backup smoke worker exited ${backup.status}`);
    }finally{await fs.rm(backupDir,{recursive:true,force:true})}
  } finally {
    const exact = await admin.query<{ datname: string }>(`select datname from pg_database where datname=$1`, [database]);
    if (exact.rows[0] && /^almiya_sync_test_\d+$/.test(exact.rows[0].datname)) await admin.query(`drop database "${database}" with (force)`);
    await admin.end();
  }
}

if(process.argv.includes('--backup-worker'))await backupWorker();else if (process.argv.includes('--worker')) await worker(); else await orchestrate();
