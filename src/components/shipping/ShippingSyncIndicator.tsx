import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { httpClient } from '../../lib/api/httpClient';

type SyncStatus={
  nodeRole:'local'|'central'|'disabled';configured:boolean;centralOnline:boolean|null;
  counts:Record<string,number>;totalEligible:number;acknowledged:number;percentage:number;
  oldestPendingAt:string|null;lastCentralAttemptAt:string|null;lastCentralError:string|null;running:boolean;
  state?:{last_successful_sync_at?:string|null;last_central_cursor?:number;resnapshot_required?:boolean};
};

export default function ShippingSyncIndicator(props:{fallbackStatus:'online'|'offline'|'checking';pendingDrafts:number}){
  const [status,setStatus]=useState<SyncStatus|null>(null);const [open,setOpen]=useState(false);const [retrying,setRetrying]=useState(false);
  const refresh=async()=>{try{setStatus(await httpClient.get<SyncStatus>('/sync/status'))}catch{setStatus(null)}};
  useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),3000);return()=>window.clearInterval(id)},[]);
  const local=status?.nodeRole==='local';const visual=local?(status.centralOnline===true?'online':status.centralOnline===null?'checking':'offline'):props.fallbackStatus;
  const pending=useMemo(()=>status?['PENDING','SENDING','RETRY','BLOCKED'].reduce((sum,key)=>sum+(status.counts[key]??0),0):props.pendingDrafts,[status,props.pendingDrafts]);
  const conflicts=status?.counts.CONFLICT??0;const failed=(status?.counts.REJECTED??0)+(status?.counts.RETRY??0);
  const short=visual==='online'?'متصل':visual==='checking'?'فحص الاتصال':'غير متصل';
  const retry=async()=>{setRetrying(true);try{await httpClient.post('/sync/retry',{});await refresh()}finally{setRetrying(false)}};
  return <span className="quick-ledger-sync-indicator">
    <button type="button" className={`quick-ledger-cloud-pill is-${visual}`} onClick={()=>setOpen(value=>!value)} aria-expanded={open} title="حالة مزامنة بيانات الشحن">
      {short}{pending>0?` · ${pending} بانتظار`:''}{conflicts>0?` · ${conflicts} تعارض`:''}
    </button>
    {open&&local?<span className="quick-ledger-sync-popover" role="status" aria-live="polite">
      <strong>{status?.centralOnline?'مزامنة البيانات مع السحابة':'تم حفظ البيانات محليًا — بانتظار عودة الاتصال'}</strong>
      <span>{status?.acknowledged??0} من {status?.totalEligible??0} مؤكدة · {status?.percentage??0}%</span>
      <span>متبقي: {pending} · فشل/إعادة: {failed} · تعارض: {conflicts}</span>
      <span>آخر نجاح: {status?.state?.last_successful_sync_at?new Date(status.state.last_successful_sync_at).toLocaleString('ar-SY'):'لا يوجد'}</span>
      {status?.lastCentralError?<span className="is-error">تعذر الاتصال بالخادم المركزي</span>:null}
      <button type="button" onClick={()=>void retry()} disabled={retrying}><RefreshCw size={14}/>{retrying?'جارٍ الطلب...':'إعادة المحاولة'}</button>
    </span>:null}
  </span>;
}
