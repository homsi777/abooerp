import { useEffect, useRef, useState } from 'react';

// ماسح باركود/QR عام بالكاميرا، يُعاد استخدامه في أي شاشة بحث برقم إيصال
// (شاشة تتبّع الزبون العامة، والبحث الشامل الداخلي). يعتمد html5-qrcode
// (مُثبَّتة مسبقاً في المشروع) ويطلب الكاميرا وقت التشغيل الفعلي فقط —
// فلا يظهر أي طلب إذن إلا عند فتح هذه النافذة تحديداً.

let containerSeq = 0;

export default function BarcodeScannerModal({
  onDetected,
  onClose,
  title = 'وجّهي الكاميرا نحو الباركود',
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const containerId = useRef(`barcode-scanner-${++containerSeq}`).current;
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    void (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (decodedText) => {
            onDetected(decodedText);
          },
          undefined,
        );
      } catch {
        if (!cancelled) setScanError('تعذر تشغيل الكاميرا — تأكدي من السماح بالوصول إليها من إعدادات الموقع في المتصفح.');
      }
    })();

    return () => {
      cancelled = true;
      const active = scannerRef.current;
      if (active) {
        active.stop().then(() => active.clear()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={styles.backdrop} role="presentation" onClick={onClose}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span>{title}</span>
          <button type="button" style={styles.close} onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div id={containerId} style={styles.viewport} />
        {scanError ? <div style={styles.errorBox}>{scanError}</div> : null}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10200,
    padding: '16px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: '#13102a',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,.12)',
    padding: '16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
  },
  viewport: {
    width: '100%',
    borderRadius: '10px',
    overflow: 'hidden',
    minHeight: '260px',
  },
  errorBox: {
    marginTop: '10px',
    background: 'rgba(239,68,68,.15)',
    border: '1px solid rgba(239,68,68,.4)',
    color: '#fecaca',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
  },
};
