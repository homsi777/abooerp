import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpClient } from '../lib/api/httpClient';
import { COMPANY_LOGO_PATH, COMPANY_NAME_AR } from '../lib/branding/companyBrand';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import {
  canUseBrowserCamera,
  requestCameraPermissionForScan,
} from '../lib/camera/browserCameraAccess';

type TrackingResult = {
  receiptNo: string;
  date: string;
  destination: string;
  senderName: string | null;
  receiverName: string | null;
  parcelType: string;
  parcelCount: number | null;
  weightKg: string | null;
  shipmentNo: string | null;
  status: string;
  statusLabel: string;
};

function formatDate(value: string): string {
  const part = String(value ?? '').split('T')[0];
  return part || value;
}

export default function CustomerTracking() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const showCameraBtn = useRef(canUseBrowserCamera()).current;

  async function openBarcodeScanner() {
    setScannerError(null);
    const permissionError = await requestCameraPermissionForScan();
    if (permissionError) {
      setScannerError(permissionError);
      return;
    }
    setScannerOpen(true);
  }

  async function runSearch(receiptNo?: string) {
    const value = (receiptNo ?? query).trim();
    if (!value) {
      setError('أدخلي رقم الإيصال أولاً.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await httpClient.get<TrackingResult>(
        `/public/tracking?receiptNo=${encodeURIComponent(value)}`,
      );
      setResult(response);
      setSearched(true);
    } catch (err) {
      setSearched(true);
      setError(err instanceof Error ? err.message : 'لم يتم العثور على إيصال بهذا الرقم.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.root}>
      <div style={{ ...styles.blob, top: '-120px', right: '-100px', background: 'radial-gradient(circle,rgba(124,58,237,.35),transparent 70%)' }} />
      <div style={{ ...styles.blob, bottom: '-140px', left: '-120px', background: 'radial-gradient(circle,rgba(79,70,229,.3),transparent 70%)' }} />

      <button type="button" style={styles.loginBtn} onClick={() => navigate('/login')}>
        تسجيل الدخول
      </button>

      <div style={styles.content}>
        <div style={styles.brand}>
          <img src={COMPANY_LOGO_PATH} alt={COMPANY_NAME_AR} style={styles.brandLogo} />
          <div style={styles.brandName}>{COMPANY_NAME_AR}</div>
        </div>

        <h1 style={styles.headline}>
          تتبّعي شحنتك <span style={styles.headlineAccent}>بخطوة واحدة</span>
        </h1>
        <p style={styles.subline}>أدخلي رقم الإيصال لمعرفة حالة شحنتك فوراً</p>

        <div style={styles.searchRow}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder="رقم الإيصال..."
            style={styles.searchInput}
            inputMode="numeric"
          />
          {showCameraBtn ? (
            <button
              type="button"
              style={styles.cameraBtn}
              onClick={() => void openBarcodeScanner()}
              title="مسح الباركود بالكاميرا"
              aria-label="مسح الباركود بالكاميرا"
            >
              📷
            </button>
          ) : null}
          <button type="button" style={styles.searchBtn} onClick={() => void runSearch()} disabled={loading}>
            {loading ? '...' : 'بحث'}
          </button>
        </div>

        {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}
        {error ? <div style={styles.errorBox}>{error}</div> : null}

        {result ? (
          <div style={styles.resultCard}>
            <div style={styles.resultHeader}>
              <div style={styles.resultReceipt}>إيصال #{result.receiptNo}</div>
              <div style={{ ...styles.statusChip, ...statusChipStyle(result.status) }}>{result.statusLabel}</div>
            </div>
            <div style={styles.resultGrid}>
              <ResultField label="الجهة" value={result.destination} />
              <ResultField label="التاريخ" value={formatDate(result.date)} />
              <ResultField label="المرسل" value={result.senderName} />
              <ResultField label="المرسل إليه" value={result.receiverName} />
              <ResultField label="نوع البضاعة" value={result.parcelType} />
              <ResultField label="عدد الطرود" value={result.parcelCount != null ? String(result.parcelCount) : null} />
              {result.shipmentNo ? <ResultField label="رقم الشحنة" value={result.shipmentNo} /> : null}
            </div>
          </div>
        ) : searched && !loading && !error ? (
          <div style={styles.emptyBox}>لم يتم العثور على إيصال بهذا الرقم.</div>
        ) : null}
      </div>

      {scannerOpen ? (
        <BarcodeScannerModal
          onDetected={(value) => {
            setScannerOpen(false);
            setQuery(value);
            void runSearch(value);
          }}
          onClose={() => setScannerOpen(false)}
        />
      ) : null}

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

function ResultField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={styles.resultField}>
      <div style={styles.resultFieldLabel}>{label}</div>
      <div style={styles.resultFieldValue}>{value}</div>
    </div>
  );
}

function statusChipStyle(status: string): React.CSSProperties {
  if (status === 'DELIVERED' || status === 'FINANCIALLY_CLOSED') {
    return { background: 'rgba(34,197,94,.18)', color: '#86efac', borderColor: 'rgba(34,197,94,.35)' };
  }
  if (status === 'CANCELLED' || status === 'RETURNED') {
    return { background: 'rgba(239,68,68,.18)', color: '#fca5a5', borderColor: 'rgba(239,68,68,.35)' };
  }
  if (status === 'UNKNOWN' || status === 'DRAFT' || status === 'REGISTERED') {
    return { background: 'rgba(148,163,184,.18)', color: '#cbd5e1', borderColor: 'rgba(148,163,184,.35)' };
  }
  return { background: 'rgba(124,58,237,.18)', color: '#c4b5fd', borderColor: 'rgba(124,58,237,.35)' };
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg,#0d0b1e 0%,#1a1033 40%,#0e1628 100%)',
    fontFamily: "'Segoe UI',Tahoma,Arial,sans-serif",
    position: 'relative',
    overflow: 'hidden',
    padding: '24px',
  },
  blob: {
    position: 'absolute',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: 0,
  },
  loginBtn: {
    position: 'absolute',
    top: '20px',
    insetInlineStart: '20px',
    zIndex: 2,
    padding: '9px 18px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,.18)',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  content: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: '560px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    animation: 'fadeUp .6s ease both',
  },
  brand: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '28px',
  },
  brandLogo: {
    width: '64px',
    height: '64px',
    objectFit: 'contain',
    borderRadius: '50%',
    background: '#fff',
    padding: '3px',
    boxShadow: '0 4px 16px rgba(0,0,0,.25)',
  },
  brandName: {
    color: '#fff',
    fontWeight: 700,
    fontSize: '16px',
  },
  headline: {
    color: '#fff',
    fontSize: '30px',
    fontWeight: 800,
    lineHeight: 1.3,
    margin: '0 0 10px',
    letterSpacing: '-.4px',
  },
  headlineAccent: {
    background: 'linear-gradient(90deg,#a78bfa,#818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subline: {
    color: 'rgba(255,255,255,.55)',
    fontSize: '14px',
    marginBottom: '28px',
  },
  searchRow: {
    display: 'flex',
    gap: '8px',
    width: '100%',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: '14px 16px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
  },
  cameraBtn: {
    flexShrink: 0,
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.06)',
    fontSize: '20px',
    cursor: 'pointer',
  },
  searchBtn: {
    flexShrink: 0,
    padding: '0 22px',
    borderRadius: '12px',
    border: 'none',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(124,58,237,.4)',
  },
  errorBox: {
    marginTop: '16px',
    width: '100%',
    padding: '12px 16px',
    borderRadius: '10px',
    background: 'rgba(239,68,68,.12)',
    border: '1px solid rgba(239,68,68,.3)',
    color: '#fca5a5',
    fontSize: '13px',
  },
  emptyBox: {
    marginTop: '16px',
    width: '100%',
    padding: '14px 16px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,.05)',
    border: '1px solid rgba(255,255,255,.1)',
    color: 'rgba(255,255,255,.6)',
    fontSize: '13px',
  },
  resultCard: {
    marginTop: '20px',
    width: '100%',
    padding: '20px',
    borderRadius: '16px',
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.12)',
    textAlign: 'start',
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
    flexWrap: 'wrap',
    gap: '8px',
  },
  resultReceipt: {
    color: '#fff',
    fontWeight: 800,
    fontSize: '16px',
  },
  statusChip: {
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 700,
    border: '1px solid',
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
    gap: '12px',
  },
  resultField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  resultFieldLabel: {
    color: 'rgba(255,255,255,.45)',
    fontSize: '11px',
    fontWeight: 600,
  },
  resultFieldValue: {
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
  },
};
