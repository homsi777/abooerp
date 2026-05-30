import { useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';

const REAL_KEY_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function formatRealKey(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) parts.push(clean.slice(i, i + 4));
  return parts.join('-');
}

function activationErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String((err as any)?.message ?? '');
  if (message.includes('INVALID_LICENSE_CODE')) {
    return 'كود التفعيل غير صالح أو غير معروف';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
    return 'تعذّر الاتصال بالسيرفر — تأكد من تشغيل الخادم وأعد المحاولة';
  }
  return message || 'تعذّر تفعيل النظام';
}

interface Props {
  onActivated: () => void;
}

interface ActivateResult {
  licenseType: string;
  shipmentLimit: number | null;
  deliveryLimit: number | null;
  receiptLimit: number | null;
  activatedAt: string;
}

export default function LicenseExpiredModal({ onActivated }: Props) {
  const [keyValue, setKeyValue] = useState('');
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRealKey(e.target.value);
    setKeyValue(formatted);
    setError(null);
  };

  const ready = REAL_KEY_RE.test(keyValue);

  const handleActivate = async () => {
    if (!ready) return;
    if (keyValue.toUpperCase().trim() === 'TEST1') {
      setError('لا يمكن تجديد الترخيص بمفتاح تجريبي — أدخل مفتاح تفعيل حقيقي');
      return;
    }

    setActivating(true);
    setError(null);

    try {
      const runtime = (window as any)?.runtime;
      const machineId: string = runtime?.getMachineId ? ((await runtime.getMachineId()) ?? '') : '';

      const data = await httpClient.post<ActivateResult>('/license/activate', {
        licenseCode: keyValue,
        machineId: machineId || undefined,
      });

      localStorage.setItem('app.license', JSON.stringify({
        licenseType: data.licenseType,
        activatedAt: data.activatedAt,
        shipmentLimit: data.shipmentLimit,
        deliveryLimit: data.deliveryLimit,
        receiptLimit: data.receiptLimit,
      }));

      onActivated();
    } catch (err: any) {
      const code = err?.response?.data?.code ?? err?.code ?? '';
      if (code === 'INVALID_LICENSE_CODE') {
        setError('كود التفعيل غير صالح أو غير معروف');
      } else {
        setError(activationErrorMessage(err));
      }
    } finally {
      setActivating(false);
    }
  };

  return (
    // Blocking overlay — no escape, no outside-click close
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      dir="rtl"
    >
      <div style={{
        width: '460px', background: '#120e2a',
        border: '1px solid rgba(239,68,68,.35)', borderRadius: '24px',
        padding: '36px', boxShadow: '0 40px 100px rgba(0,0,0,.8)',
        animation: 'fadeUp .3s ease both',
      }}>
        {/* Warning icon */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(239,68,68,.15)', border: '2px solid rgba(239,68,68,.4)',
            fontSize: '28px', marginBottom: '12px',
          }}>🔒</div>
          <div style={{ color: '#ef4444', fontWeight: 800, fontSize: '20px', marginBottom: '6px' }}>
            انتهت النسخة التجريبية
          </div>
          <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '13px', lineHeight: 1.6 }}>
            لقد استنفدت كامل حصة العمليات التجريبية (50).
            <br />
            يجب إدخال مفتاح تفعيل حقيقي للمتابعة.
          </div>
        </div>

        <div style={{ height: '1px', background: 'rgba(255,255,255,.08)', margin: '20px 0' }} />

        {/* Input */}
        <label style={{ display: 'block', color: 'rgba(255,255,255,.6)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
          مفتاح التفعيل
        </label>
        <input
          value={keyValue}
          onChange={handleInput}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          maxLength={19}
          autoFocus
          style={{
            width: '100%', padding: '13px 16px',
            background: 'rgba(255,255,255,.07)',
            border: `1px solid ${error ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`,
            borderRadius: '12px', color: '#fff',
            fontSize: '16px', fontFamily: 'monospace',
            letterSpacing: '2px', outline: 'none',
            textAlign: 'center', boxSizing: 'border-box',
          }}
          onFocus={(e) => Object.assign(e.currentTarget.style, { borderColor: '#7c3aed', boxShadow: '0 0 0 3px rgba(124,58,237,.25)' })}
          onBlur={(e) => Object.assign(e.currentTarget.style, { borderColor: error ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)', boxShadow: 'none' })}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready && !activating) void handleActivate(); }}
        />
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: '11px', marginTop: '6px', textAlign: 'center' }}>
          صيغة المفتاح الحقيقي: XXXX-XXXX-XXXX-XXXX
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
            background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)',
            color: '#fca5a5', fontSize: '13px',
          }}>
            ❌ {error}
          </div>
        )}

        {/* Activate button */}
        <button
          onClick={() => void handleActivate()}
          disabled={!ready || activating}
          style={{
            width: '100%', marginTop: '18px', padding: '14px',
            background: ready && !activating
              ? 'linear-gradient(135deg,#7c3aed,#4f46e5)'
              : 'rgba(255,255,255,.07)',
            border: 'none', borderRadius: '12px', color: '#fff',
            fontSize: '15px', fontWeight: 700,
            cursor: ready && !activating ? 'pointer' : 'not-allowed',
            opacity: ready && !activating ? 1 : 0.45, transition: 'opacity .2s',
          }}
        >
          {activating ? '⏳ جارٍ التحقق والتفعيل...' : '🔓 تفعيل وفتح النظام'}
        </button>

        <div style={{
          marginTop: '14px', textAlign: 'center',
          color: 'rgba(255,255,255,.25)', fontSize: '11px',
        }}>
          يجب إدخال مفتاح تفعيل حقيقي للمتابعة — المفتاح التجريبي TEST1 لا يُقبل هنا
        </div>
      </div>
    </div>
  );
}
