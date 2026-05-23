import { useEffect, useRef, useState } from 'react';
import { getLanState, saveLanConnection } from '../../lib/api/httpClient';

type TestStatus = 'idle' | 'testing' | 'success' | 'fail';

interface Props {
  onClose: () => void;
  onConnected: (serverIp: string, branches: { id: string; code: string; name: string }[]) => void;
}

function validateIp(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim());
}

async function readBackendPort(): Promise<number> {
  try {
    const runtime = (window as any)?.runtime;
    if (runtime?.getConfig) {
      const cfg = await runtime.getConfig();
      if (cfg?.backendPort) return Number(cfg.backendPort);
    }
  } catch { /* ignore */ }
  return 4010;
}

export default function LanConnectionModal({ onClose, onConnected }: Props) {
  const saved = getLanState();
  const [ip, setIp] = useState(saved.serverIp || '');
  const [status, setStatus] = useState<TestStatus>('idle');
  const [testedBranches, setTestedBranches] = useState<{ id: string; code: string; name: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [lanInfo, setLanInfo] = useState<{ lanAddresses: string[]; firewallHint: string } | null>(null);
  const [resolvedPort, setResolvedPort] = useState(4010);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    readBackendPort().then(setResolvedPort).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buildApiUrl = (ip: string) => `http://${ip}:${resolvedPort}/api/v1`;

  const handleTest = async () => {
    if (!validateIp(ip)) {
      setErrorMsg('عنوان IP غير صالح — مثال: 192.168.1.100');
      return;
    }
    setStatus('testing');
    setErrorMsg('');
    setTestedBranches([]);
    setLanInfo(null);

    const base = buildApiUrl(ip.trim());

    try {
      // Step 1 — LAN health check
      const healthRes = await fetch(`${base}/system/lan-health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) throw new Error(`lan-health HTTP ${healthRes.status}`);
      const healthPayload = await healthRes.json();
      if (!healthPayload?.ok) throw new Error('lan-health returned ok=false');

      setLanInfo({
        lanAddresses: healthPayload.lanAddresses ?? [],
        firewallHint: healthPayload.lanFirewallHint ?? '',
      });

      // Step 2 — Load branches
      const branchRes = await fetch(`${base}/auth/branches`, { signal: AbortSignal.timeout(5000) });
      if (!branchRes.ok) throw new Error(`branches HTTP ${branchRes.status}`);
      const branchPayload = await branchRes.json();
      const branches = Array.isArray(branchPayload?.data) ? branchPayload.data : [];

      setTestedBranches(branches);
      setStatus('success');
    } catch (err: any) {
      setStatus('fail');
      setErrorMsg(`تعذر الاتصال — تحقق من IP وأن السيرفر يعمل (منفذ ${resolvedPort})`);
    }
  };

  const handleSave = () => {
    saveLanConnection(ip.trim(), resolvedPort);
    onConnected(ip.trim(), testedBranches);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const statusColor = status === 'success' ? '#10b981' : status === 'fail' ? '#ef4444' : 'rgba(255,255,255,.3)';
  const statusIcon  = status === 'testing' ? '⏳' : status === 'success' ? '✅' : status === 'fail' ? '❌' : '🔌';
  const statusLabel = status === 'testing' ? 'جارٍ الاختبار...' : status === 'success' ? 'الاتصال ناجح' : status === 'fail' ? 'فشل الاتصال' : 'لم يتم الاختبار بعد';

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      dir="rtl"
    >
      <div style={{
        width: '440px', background: '#1e1b3a',
        border: '1px solid rgba(255,255,255,.12)', borderRadius: '20px',
        padding: '32px', boxShadow: '0 32px 80px rgba(0,0,0,.6)',
        animation: 'fadeUp .25s ease both',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '12px',
              background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
            }}>🌐</div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>ربط محلي LAN</div>
              <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '12px' }}>الاتصال بالسيرفر الرئيسي على الشبكة</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
        </div>

        {/* Current connection */}
        {saved.serverIp && (
          <div style={{
            background: 'rgba(14,165,233,.1)', border: '1px solid rgba(14,165,233,.25)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '16px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ color: '#38bdf8', fontSize: '12px' }}>🔗 متصل حالياً بـ {saved.serverIp}</span>
            <button
              onClick={() => { saveLanConnection(''); setIp(''); setStatus('idle'); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: '11px', marginRight: 'auto' }}
            >قطع</button>
          </div>
        )}

        {/* IP input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'rgba(255,255,255,.7)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
            IP الجهاز الرئيسي (السيرفر)
          </label>
          <input
            value={ip}
            onChange={(e) => { setIp(e.target.value); setStatus('idle'); setErrorMsg(''); }}
            placeholder="192.168.1.100"
            dir="ltr"
            style={{
              width: '100%', padding: '12px 14px', boxSizing: 'border-box',
              background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.15)',
              borderRadius: '10px', color: '#fff', fontSize: '16px', fontFamily: 'monospace', outline: 'none',
            }}
          />
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: '11px', marginTop: '6px' }}>
            المنفذ يُضبط تلقائياً ({resolvedPort}) — لا داعي لإدخاله
          </div>
        </div>

        {/* Status indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(255,255,255,.04)', border: `1px solid ${statusColor}44`,
          marginBottom: '16px',
        }}>
          <span style={{ fontSize: '18px' }}>{statusIcon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: statusColor, fontSize: '13px', fontWeight: 600 }}>{statusLabel}</div>
            {status === 'success' && lanInfo && (
              <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '11px', marginTop: '2px' }}>
                {buildApiUrl(ip.trim())} — {testedBranches.length} فرع
              </div>
            )}
          </div>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
            background: statusColor, boxShadow: status !== 'idle' ? `0 0 8px ${statusColor}` : 'none',
            animation: status === 'testing' ? 'pulse 1s infinite' : 'none',
          }} />
        </div>

        {/* LAN addresses from server */}
        {status === 'success' && lanInfo && lanInfo.lanAddresses.length > 0 && (
          <div style={{
            background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.2)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
          }}>
            <div style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>🌐 عناوين LAN المكتشفة على السيرفر</div>
            {lanInfo.lanAddresses.map(a => (
              <div key={a} style={{ color: 'rgba(255,255,255,.6)', fontSize: '12px', fontFamily: 'monospace' }}>• {a}:{resolvedPort}</div>
            ))}
          </div>
        )}

        {/* Branches */}
        {status === 'success' && testedBranches.length > 0 && (
          <div style={{
            background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '16px',
          }}>
            <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>الفروع المتاحة:</div>
            {testedBranches.map((b) => (
              <div key={b.id} style={{ color: 'rgba(255,255,255,.7)', fontSize: '13px', padding: '2px 0' }}>• {b.name}</div>
            ))}
          </div>
        )}

        {errorMsg && (
          <div style={{
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Firewall hint */}
        {lanInfo?.firewallHint && (
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: '11px', marginBottom: '14px', padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
            💡 {lanInfo.firewallHint}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={() => void handleTest()}
            disabled={!validateIp(ip) || status === 'testing'}
            style={{
              flex: 1, padding: '12px',
              background: validateIp(ip) && status !== 'testing' ? 'linear-gradient(135deg,#0ea5e9,#2563eb)' : 'rgba(255,255,255,.07)',
              border: 'none', borderRadius: '10px', color: '#fff',
              fontSize: '14px', fontWeight: 600,
              cursor: validateIp(ip) && status !== 'testing' ? 'pointer' : 'not-allowed',
              opacity: validateIp(ip) && status !== 'testing' ? 1 : 0.5,
            }}
          >
            {status === 'testing' ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
          </button>
          {status === 'success' && (
            <button
              onClick={handleSave}
              style={{
                flex: 1, padding: '12px',
                background: 'linear-gradient(135deg,#059669,#10b981)',
                border: 'none', borderRadius: '10px', color: '#fff',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}
            >حفظ</button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '12px 20px', background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: '10px',
              color: 'rgba(255,255,255,.7)', fontSize: '14px', cursor: 'pointer',
            }}
          >إلغاء</button>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} } @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }`}</style>
    </div>
  );
}
