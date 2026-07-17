import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

function tcpOpen(port=5432,host='127.0.0.1',timeout=800){return new Promise<boolean>(resolve=>{const socket=new net.Socket();let done=false;const finish=(value:boolean)=>{if(done)return;done=true;socket.destroy();resolve(value)};socket.setTimeout(timeout);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));socket.connect(port,host)})}
function run(file:string,args:string[],timeout=10000){return new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{execFile(file,args,{windowsHide:true,timeout},(error,stdout,stderr)=>resolve({code:(error as any)?.code??0,stdout:String(stdout),stderr:String(stderr)}))})}

function findPgIsReady():string|null{
  const roots=[process.env.ProgramFiles,path.join(process.env.SystemDrive||'C:','Program Files')].filter(Boolean) as string[];
  for(const root of roots){const postgres=path.join(root,'PostgreSQL');if(!existsSync(postgres))continue;const versions=readdirSync(postgres).sort((a,b)=>Number(b)-Number(a));for(const version of versions){const candidate=path.join(postgres,version,'bin','pg_isready.exe');if(existsSync(candidate))return candidate}}
  return null;
}

async function tryStartPostgresService(){
  const listed=await run('sc.exe',['query','state=','all']);const match=listed.stdout.match(/SERVICE_NAME:\s*(postgresql[^\r\n]+)/i);if(!match)return false;
  await run('sc.exe',['start',match[1].trim()]);for(let i=0;i<15;i++){if(await tcpOpen())return true;await new Promise(resolve=>setTimeout(resolve,1000))}return false;
}

export async function ensureLocalPostgresReady():Promise<{ready:boolean;reason?:string;pgIsReadyPath?:string|null}>{
  let open=await tcpOpen();if(!open)open=await tryStartPostgresService();if(!open)return{ready:false,reason:'POSTGRES_SERVICE_NOT_RUNNING'};
  const pgIsReady=findPgIsReady();if(pgIsReady){const result=await run(pgIsReady,['-h','127.0.0.1','-p','5432','-t','3']);if(result.code!==0)return{ready:false,reason:'PORT_5432_IS_NOT_READY',pgIsReadyPath:pgIsReady}}
  return{ready:true,pgIsReadyPath:pgIsReady};
}
