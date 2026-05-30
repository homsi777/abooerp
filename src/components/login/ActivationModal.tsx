import { useEffect, useRef, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIAL_KEY = 'TEST1';
const REAL_KEY_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Format input as XXXX-XXXX-XXXX-XXXX unless user is typing the trial key */
function processInput(raw: string): string {
  const upper = raw.toUpperCase();
  // Keep trial key as-is
  if (TRIAL_KEY.startsWith(upper.replace(/[^A-Z0-9]/g, ''))) {
    return upper.replace(/[^A-Z0-9]/g, '').slice(0, 5); // max "TEST1"
  }
  // Real key: auto-format to XXXX-XXXX-XXXX-XXXX
  const clean = upper.replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) parts.push(clean.slice(i, i + 4));
  return parts.join('-');
}

function isReadyToSubmit(key: string): boolean {
  return key === TRIAL_KEY || REAL_KEY_RE.test(key);
}

function activationErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String((err as any)?.message ?? '');
  if (message.includes('INVALID_LICENSE_CODE')) {
    return 'كود التفعيل غير صالح أو غير معروف';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
    return 'تعذّر الاتصال بالسيرفر — تأكد من تشغيل الخادم والمحاولة مجدداً';
  }
  return message || 'تعذّر تفعيل النظام';
}

// ── Persistent local storage ──────────────────────────────────────────────────
const STORAGE_KEY = 'app.license';

export interface StoredLicense {
  licenseType: string;
  activatedAt: string;
  shipmentLimit: number | null;
  deliveryLimit: number | null;
  receiptLimit: number | null;
}

export function getStoredLicense(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredLicense) : null;
  } catch { return null; }
}

function storeLicense(data: StoredLicense): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onActivated?: () => void;
}

interface ActivateResult {
  licenseType: string;
  cloudEnabled: boolean;
  shipmentLimit: number | null;
  deliveryLimit: number | null;
  receiptLimit: number | null;
  activatedAt: string;
  quotaRemaining: { shipments: number | null; deliveries: number | null; receipts: number | null };
}

export default function ActivationModal({ onClose, onActivated }: Props) {
  const [keyValue, setKeyValue] = useState('');
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; data?: ActivateResult; msg?: string } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const existing = getStoredLicense();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyValue(processInput(e.target.value));
    setResult(null);
  };

  const handleActivate = async () => {
    if (!isReadyToSubmit(keyValue)) return;

    setActivating(true);
    setResult(null);

    try {
      const runtime = (window as any)?.runtime;
      const machineId: string = runtime?.getMachineId ? ((await runtime.getMachineId()) ?? '') : '';

      const data = await httpClient.post<ActivateResult>('/license/activate', {
        licenseCode: keyValue,
        machineId: machineId || undefined,
      });

      storeLicense({
        licenseType: data.licenseType,
        activatedAt: data.activatedAt,
        shipmentLimit: data.shipmentLimit,
        deliveryLimit: data.deliveryLimit,
        receiptLimit: data.receiptLimit,
      });

      setResult({ ok: true, data });
      onActivated?.();
    } catch (err: any) {
      const code = err?.response?.data?.code ?? err?.code ?? '';
      if (code === 'INVALID_LICENSE_CODE') {
        setResult({ ok: false, msg: 'كود التفعيل غير صالح أو غير معروف' });
      } else {
        setResult({ ok: false, msg: activationErrorMessage(err) });
      }
    } finally {
      setActivating(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const ready = isReadyToSubmit(keyValue);
  const isTrial = keyValue === TRIAL_KEY;

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
        width: '420px', background: '#1e1b3a',
        border: '1px solid rgba(255,255,255,.12)', borderRadius: '20px',
        padding: '32px', boxShadow: '0 32px 80px rgba(0,0,0,.6)',
        animation: 'fadeUp .25s ease both',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '12px',
              background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
            }}>🔑</div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>تفعيل النظام</div>
              <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '12px' }}>أدخل كود التفعيل</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '4px' }}
          >✕</button>
        </div>

        {/* Currently active license */}
        {existing && !result && (
          <div style={{
            background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)',
            borderRadius: '12px', padding: '12px 16px', marginBottom: '20px',
          }}>
            <div style={{ color: '#6ee7b7', fontSize: '12px', marginBottom: '4px' }}>✅ النظام مفعّل حالياً</div>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>{existing.licenseType}</div>
            {existing.shipmentLimit != null && (
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '12px', marginTop: '2px' }}>
                الحد المسموح: {existing.shipmentLimit} شحنة / {existing.deliveryLimit} تسليم / {existing.receiptLimit} سند
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'rgba(255,255,255,.7)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
            كود التفعيل
          </label>
          <input
            value={keyValue}
            onChange={handleInput}
            placeholder="TEST1  أو  XXXX-XXXX-XXXX-XXXX"
            autoFocus
            style={{
              width: '100%', padding: '12px 14px',
              background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.15)',
              borderRadius: '10px', color: '#fff',
              fontSize: '15px', fontFamily: 'monospace',
              letterSpacing: '1.5px', outline: 'none',
              textAlign: 'center', boxSizing: 'border-box',
            }}
            onFocus={(e) => Object.assign(e.currentTarget.style, { borderColor: '#7c3aed', boxShadow: '0 0 0 3px rgba(124,58,237,.25)' })}
            onBlur={(e) => Object.assign(e.currentTarget.style, { borderColor: 'rgba(255,255,255,.15)', boxShadow: 'none' })}
          />
          {isTrial && (
            <div style={{
              marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
              background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.3)',
              color: '#fbbf24', fontSize: '12px', textAlign: 'center',
            }}>
              ⚠️ نسخة تجريبية — 50 شحنة / 50 تسليم / 50 سند فقط
            </div>
          )}
          {!isTrial && (
            <div style={{ color: 'rgba(255,255,255,.3)', fontSize: '11px', marginTop: '6px', textAlign: 'center' }}>
              مفتاح تجريبي: TEST1 &nbsp;|&nbsp; مفتاح حقيقي: XXXX-XXXX-XXXX-XXXX
            </div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div style={{
            borderRadius: '12px', padding: '14px 16px', marginBottom: '16px',
            background: result.ok ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
            border: `1px solid ${result.ok ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)'}`,
          }}>
            {result.ok && result.data ? (
              <>
                <div style={{ color: '#6ee7b7', fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                  ✅ تم التفعيل بنجاح — محفوظ في السيرفر
                </div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
                  {result.data.licenseType}
                </div>
                {result.data.shipmentLimit != null && (
                  <div style={{ color: 'rgba(255,255,255,.55)', fontSize: '12px' }}>
                    الحد: {result.data.shipmentLimit} شحنة | {result.data.deliveryLimit} تسليم | {result.data.receiptLimit} سند
                  </div>
                )}
                {result.data.shipmentLimit == null && (
                  <div style={{ color: '#6ee7b7', fontSize: '12px' }}>بلا حدود ✓</div>
                )}
              </>
            ) : (
              <div style={{ color: '#fca5a5', fontSize: '13px' }}>❌ {result.msg}</div>
            )}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={() => void handleActivate()}
            disabled={!ready || activating}
            style={{
              flex: 1, padding: '12px',
              background: ready && !activating ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : 'rgba(255,255,255,.07)',
              border: 'none', borderRadius: '10px', color: '#fff',
              fontSize: '14px', fontWeight: 600,
              cursor: ready && !activating ? 'pointer' : 'not-allowed',
              opacity: ready && !activating ? 1 : 0.5, transition: 'opacity .2s',
            }}
          >
            {activating ? '⏳ جارٍ التفعيل...' : 'تفعيل'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '12px 20px',
              background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: '10px', color: 'rgba(255,255,255,.7)',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
