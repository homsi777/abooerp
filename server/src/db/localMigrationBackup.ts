import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { env } from '../config/env.js';

function pgDumpCandidates(){const roots=[process.env.ProgramFiles,path.join(process.env.SystemDrive||'C:','Program Files')].filter(Boolean) as string[];const candidates=['pg_dump'];for(const root of roots)for(let version=20;version>=12;version--)candidates.push(path.join(root,'PostgreSQL',String(version),'bin','pg_dump.exe'));return candidates}
function resolvePgDump(){return pgDumpCandidates().filter(candidate=>candidate!=='pg_dump').find(candidate=>existsSync(candidate))??'pg_dump'}
async function runDump(target:string){return new Promise<void>((resolve,reject)=>{const child=spawn(resolvePgDump(),['-Fc','-h',env.PGHOST,'-p',String(env.PGPORT),'-U',env.PGUSER,'-d',env.PGDATABASE,'-f',target],{env:{...process.env,PGPASSWORD:env.PGPASSWORD},windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=String(chunk));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`pg_dump failed (${code}): ${stderr.slice(0,300)}`)))})}

export async function createEncryptedLocalMigrationBackup(reason:string){
  if(env.SYNC_NODE_ROLE!=='local')return null;if(!env.LOCAL_BACKUP_KEY)throw new Error('LOCAL_BACKUP_KEY is required for local migration backup.');
  const dir=path.join(process.env.APPDATA||process.cwd(),'offline-backups');await fs.mkdir(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');const temp=path.join(dir,`${stamp}.dump.tmp`);const output=path.join(dir,`${stamp}.abk`);
  try{
    await runDump(temp);const key=Buffer.from(env.LOCAL_BACKUP_KEY,'base64');if(key.length!==32)throw new Error('LOCAL_BACKUP_KEY must decode to 32 bytes.');
    const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const out=createWriteStream(output);out.write(Buffer.from('ABOOERP1'));out.write(iv);
    await pipeline(createReadStream(temp),cipher,out);await fs.appendFile(output,cipher.getAuthTag());
    const content=await fs.readFile(output);const sha256=createHash('sha256').update(content).digest('hex');await fs.writeFile(`${output}.json`,JSON.stringify({format:'ABOOERP1',reason,createdAt:new Date().toISOString(),sha256,size:content.length,database:env.PGDATABASE},null,2));
    const backups=(await fs.readdir(dir)).filter(name=>name.endsWith('.abk')).sort().reverse();for(const old of backups.slice(7)){await fs.rm(path.join(dir,old),{force:true});await fs.rm(path.join(dir,`${old}.json`),{force:true})}
    return{path:output,size:content.length,sha256};
  }catch(error){await fs.rm(output,{force:true});throw error}finally{await fs.rm(temp,{force:true})}
}

let backupTimer:NodeJS.Timeout|null=null;
let backupRunning=false;
export function startLocalBackupScheduler(){
  if(env.SYNC_NODE_ROLE!=='local'||backupTimer)return;
  const run=async()=>{if(backupRunning)return;backupRunning=true;try{const result=await createEncryptedLocalMigrationBackup('scheduled offline backup');if(result)console.info('[BACKUP] Encrypted local backup created.',{size:result.size,sha256:result.sha256})}catch(error){console.error('[BACKUP] Scheduled local backup failed.',error instanceof Error?error.message:String(error))}finally{backupRunning=false}};
  backupTimer=setInterval(()=>void run(),env.LOCAL_BACKUP_INTERVAL_HOURS*60*60*1000);backupTimer.unref();
}
export function stopLocalBackupScheduler(){if(backupTimer)clearInterval(backupTimer);backupTimer=null}
