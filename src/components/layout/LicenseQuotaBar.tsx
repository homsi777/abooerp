import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import LicenseExpiredModal from './LicenseExpiredModal';

interface LicenseStatus {
  licenseActive: boolean;
  licenseType?: string;
  shipmentLimit?: number | null;
  deliveryLimit?: number | null;
  receiptLimit?: number | null;
  usage?: {
    shipmentsUsed: number;
    deliveriesUsed: number;
    receiptsUsed: number;
  };
  quotaRemaining?: {
    shipments: number | null;
    deliveries: number | null;
    receipts: number | null;
  };
}

const TEST_TYPES = new Set(['TEST1']);

function urgencyColor(remaining: number | null, limit: number | null): string {
  if (remaining === null || limit === null) return '#6ee7b7';
  const pct = remaining / limit;
  if (pct <= 0) return '#ef4444';
  if (pct <= 0.1) return '#ef4444';
  if (pct <= 0.3) return '#f59e0b';
  return '#fbbf24';
}

function isQuotaExhausted(status: LicenseStatus): boolean {
  if (!status.licenseActive || !status.licenseType) return false;
  if (!TEST_TYPES.has(status.licenseType)) return false;
  const q = status.quotaRemaining;
  if (!q) return false;
  return (q.shipments ?? 1) <= 0 || (q.deliveries ?? 1) <= 0 || (q.receipts ?? 1) <= 0;
}

export default function LicenseQuotaBar() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await httpClient.get<LicenseStatus>('/license/status');
      setStatus(data);
    } catch {
      // silently ignore — bar just won't show
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // ── Quota-exhausted blocking modal — shown regardless of dismissed state ────
  if (status && isQuotaExhausted(status)) {
    return (
      <LicenseExpiredModal
        onActivated={() => {
          // Reload status after successful real activation
          void load();
          setDismissed(false);
        }}
      />
    );
  }

  if (
    dismissed ||
    !status?.licenseActive ||
    !status.licenseType ||
    !TEST_TYPES.has(status.licenseType) ||
    !status.usage ||
    !status.quotaRemaining
  ) {
    return null;
  }

  const { licenseType, shipmentLimit, deliveryLimit, receiptLimit, usage, quotaRemaining } = status;

  const minRemaining = Math.min(
    quotaRemaining.shipments ?? Infinity,
    quotaRemaining.deliveries ?? Infinity,
    quotaRemaining.receipts ?? Infinity,
  );
  const barColor = urgencyColor(minRemaining === Infinity ? null : minRemaining, shipmentLimit ?? null);

  const pct = (used: number, limit: number | null | undefined) =>
    limit != null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  const items = [
    { label: 'الشحنات',    used: usage.shipmentsUsed,   limit: shipmentLimit,  remaining: quotaRemaining.shipments },
    { label: 'التسليمات',  used: usage.deliveriesUsed,  limit: deliveryLimit,  remaining: quotaRemaining.deliveries },
    { label: 'السندات',    used: usage.receiptsUsed,    limit: receiptLimit,   remaining: quotaRemaining.receipts },
  ];

  return (
    <div
      dir="rtl"
      style={{
        background: 'linear-gradient(135deg, rgba(30,20,40,.97), rgba(40,15,30,.97))',
        borderTop: `2px solid ${barColor}`,
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: '16px',
        flexWrap: 'wrap', position: 'relative',
      }}
    >
      {/* License badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span style={{
          fontSize: '13px', padding: '2px 10px', borderRadius: '20px',
          background: `${barColor}22`, border: `1px solid ${barColor}55`,
          color: barColor, fontWeight: 700, letterSpacing: '.5px',
        }}>
          🔑 {licenseType}
        </span>
        <span style={{ color: 'rgba(255,255,255,.5)', fontSize: '12px' }}>نسخة تجريبية</span>
      </div>

      <div style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,.1)', flexShrink: 0 }} />

      {/* Quota meters */}
      {items.map(({ label, used, limit, remaining }) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '110px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,.55)', fontSize: '11px' }}>{label}</span>
            <span style={{
              color: (remaining ?? 0) <= 5 ? '#ef4444' : 'rgba(255,255,255,.8)',
              fontSize: '11px', fontWeight: 600,
            }}>
              {used} / {limit ?? '∞'} &nbsp;
              <span style={{ color: 'rgba(255,255,255,.4)', fontWeight: 400 }}>
                ({remaining ?? 0} متبقي)
              </span>
            </span>
          </div>
          <div style={{ height: '4px', background: 'rgba(255,255,255,.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct(used, limit)}%`,
              background: urgencyColor(remaining ?? null, limit ?? null),
              borderRadius: '2px', transition: 'width .4s ease',
            }} />
          </div>
        </div>
      ))}

      {minRemaining <= 10 && minRemaining !== Infinity && (
        <div style={{
          marginRight: 'auto', color: '#ef4444', fontSize: '12px', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          ⚠️ اقتربت من نهاية الحصة التجريبية
        </div>
      )}

      <button
        onClick={() => setDismissed(true)}
        title="إخفاء مؤقت"
        style={{
          marginRight: 'auto', background: 'none', border: 'none',
          color: 'rgba(255,255,255,.3)', cursor: 'pointer',
          fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0,
        }}
      >✕</button>
    </div>
  );
}
