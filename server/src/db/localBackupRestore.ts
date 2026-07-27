import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAGIC=Buffer.from('ABOOERP1');
function restoreCandidates(){const roots=[process.env.ProgramFiles,path.join(process.env.SystemDrive||'C:','Program Files')].filter(Boolean) as string[];const candidates=['pg_restore'];for(const root of roots)for(let version=20;version>=12;version--)candidates.push(path.join(root,'PostgreSQL',String(version),'bin','pg_restore.exe'));return candidates}
export function resolvePgRestore(){return restoreCandidates().filter(candidate=>candidate!=='pg_restore').find(candidate=>existsSync(candidate))??'pg_restore'}
function run(file:string,args:string[],env?:NodeJS.ProcessEnv){return new Promise<void>((resolve,reject)=>{const child=spawn(file,args,{env:{...process.env,...env},windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=String(chunk));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Backup verification/restore failed (${code}): ${stderr.slice(0,500)}`)))})}

export async function decryptAndVerifyLocalBackup(sourcePath:string,keyBase64:string,targetPath:string){
  const source=path.resolve(sourcePath);const content=await fs.readFile(source);if(content.length<37||!content.subarray(0,8).equals(MAGIC))throw new Error('OFFLINE_BACKUP_FORMAT_INVALID');
  const sidecarPath=`${source}.json`;if(existsSync(sidecarPath)){const metadata=JSON.parse(await fs.readFile(sidecarPath,'utf8')) as {sha256?:string;size?:number};const hash=createHash('sha256').update(content).digest('hex');if(metadata.sha256!==hash||Number(metadata.size)!==content.length)throw new Error('OFFLINE_BACKUP_INTEGRITY_MISMATCH')}
  const key=Buffer.from(keyBase64,'base64');if(key.length!==32)throw new Error('OFFLINE_BACKUP_KEY_INVALID');const iv=content.subarray(8,20);const tag=content.subarray(content.length-16);const encrypted=content.subarray(20,content.length-16);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);let plain:Buffer;try{plain=Buffer.concat([decipher.update(encrypted),decipher.final()])}catch{throw new Error('OFFLINE_BACKUP_AUTHENTICATION_FAILED')}
  await fs.writeFile(targetPath,plain,{flag:'wx'});try{await run(resolvePgRestore(),['--list',targetPath])}catch(error){await fs.rm(targetPath,{force:true});throw error}
  return{sourcePath:source,decryptedPath:targetPath,encryptedSize:content.length,sha256:createHash('sha256').update(content).digest('hex')};
}

export async function runPgRestoreCustomDump(dumpPath:string,connection:{host:string;port:number;user:string;password:string;database:string}){
  await run(resolvePgRestore(),['--exit-on-error','--no-owner','--no-privileges','-h',connection.host,'-p',String(connection.port),'-U',connection.user,'-d',connection.database,dumpPath],{PGPASSWORD:connection.password});
}
