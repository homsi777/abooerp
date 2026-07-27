import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { env } from '../config/env.js';
import { decryptAndVerifyLocalBackup, runPgRestoreCustomDump } from '../db/localBackupRestore.js';

const source=process.argv.find(argument=>argument.toLowerCase().endsWith('.abk'));
if(!process.argv.includes('--confirm-local-restore')||!source)throw new Error('Usage: restoreOfflineBackup <file.abk> --confirm-local-restore (the desktop backend must be stopped).');
if(env.SYNC_NODE_ROLE!=='local'||!env.LOCAL_BACKUP_KEY)throw new Error('Offline restore is allowed only with the local node configuration and backup key.');
assert.match(env.PGDATABASE,/^almiya_hsahin_offline$/);
const suffix=Date.now();const recovery=`almiya_restore_${suffix}`;const previous=`almiya_before_restore_${suffix}`;
assert.match(recovery,/^almiya_restore_\d+$/);assert.match(previous,/^almiya_before_restore_\d+$/);
const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'almiya-restore-'));const dump=path.join(tempDir,'verified.dump');
const admin=new pg.Client({host:env.PGHOST,port:env.PGPORT,user:env.PGUSER,password:env.PGPASSWORD,database:'postgres'});await admin.connect();let swapped=false;
try{
  const verified=await decryptAndVerifyLocalBackup(source,env.LOCAL_BACKUP_KEY,dump);
  await admin.query(`create database "${recovery}" owner "${env.PGUSER.replace(/"/g,'""')}"`);
  await runPgRestoreCustomDump(dump,{host:env.PGHOST,port:env.PGPORT,user:env.PGUSER,password:env.PGPASSWORD,database:recovery});
  const check=new pg.Client({host:env.PGHOST,port:env.PGPORT,user:env.PGUSER,password:env.PGPASSWORD,database:recovery});await check.connect();
  try{const validation=await check.query(`select (select count(*) from schema_migrations)::int migrations,(select count(*) from sync_outbox)::int outbox`);if(Number(validation.rows[0]?.migrations)<1)throw new Error('RESTORED_DATABASE_VALIDATION_FAILED');console.info('[RESTORE] Verified restored content.',validation.rows[0])}finally{await check.end()}
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`,[env.PGDATABASE]);
  await admin.query(`alter database "${env.PGDATABASE}" rename to "${previous}"`);
  try{await admin.query(`alter database "${recovery}" rename to "${env.PGDATABASE}"`);swapped=true}catch(error){await admin.query(`alter database "${previous}" rename to "${env.PGDATABASE}"`);throw error}
  console.info('[RESTORE] Offline database restored.',{source:verified.sourcePath,sha256:verified.sha256,previousDatabase:previous,restartRequired:true});
}finally{
  if(!swapped){const exists=await admin.query(`select 1 from pg_database where datname=$1`,[recovery]);if(exists.rowCount){await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1`,[recovery]);await admin.query(`drop database "${recovery}"`)}}
  await admin.end();await fs.rm(tempDir,{recursive:true,force:true});
}
