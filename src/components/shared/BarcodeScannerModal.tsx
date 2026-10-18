import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { cameraEnvironmentMessage } from '../../lib/camera/browserCameraAccess';

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

const SCANNER_CONFIG = {
  fps: 10,
  qrbox: { width: 260, height: 160 },
  formatsToSupport: SCAN_FORMATS,
} as const;

let containerSeq = 0;

async function pickCameraTarget(): Promise<string | MediaTrackConstraints> {
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (cameras.length === 0) {
      return { facingMode: 'environment' };
    }
    const back = cameras.find((c) => /back|rear|environment|خلف/i.test(c.label));
    if (back) return back.id;
    if (cameras.length === 1) return cameras[0].id;
    return cameras[cameras.length - 1].id;
  } catch {
    return { facingMode: 'environment' };
  }
}

async function startHtml5Scanner(
  scanner: Html5Qrcode,
  onDetected: (value: string) => void,
): Promise<void> {
  const onSuccess = (decodedText: string) => {
    onDetected(decodedText);
  };

  const attempts: Array<string | MediaTrackConstraints> = [
    { facingMode: 'environment' },
    await pickCameraTarget(),
    { facingMode: 'user' },
  ];

  let lastError: unknown;
  const seen = new Set<string>();
  for (const cameraIdOrConfig of attempts) {
    const key = typeof cameraIdOrConfig === 'string' ? cameraIdOrConfig : JSON.stringify(cameraIdOrConfig);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await scanner.start(cameraIdOrConfig, SCANNER_CONFIG, onSuccess, undefined);
      return;
    } catch (err) {
      lastError = err;
      try {
        await scanner.stop();
      } catch {
        /* not running yet */
      }
    }
  }
  throw lastError ?? new Error('camera start failed');
}

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
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [scanError, setScanError] = useState<string | null>(() => cameraEnvironmentMessage());
  const [starting, setStarting] = useState(false);

  const runStart = useCallback(async () => {
    const env = cameraEnvironmentMessage();
    if (env) {
      setScanError(env);
      return;
    }

    setStarting(true);
    setScanError(null);

    let scanner = scannerRef.current;
    if (!scanner) {
      scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
    } else {
      try {
        await scanner.stop();
      } catch {
        /* idle */
      }
    }

    try {
      await startHtml5Scanner(scanner, (value) => onDetectedRef.current(value));
    } catch {
      setScanError(
        'تعذر تشغيل الكاميرا. اضغطي «تشغيل الكاميرا» أدناه، أو فعّلي الإذن من إعدادات الموقع في المتصفح.',
      );
    } finally {
      setStarting(false);
    }
  }, [containerId]);

  useEffect(() => {
    void runStart();
    return () => {
      const active = scannerRef.current;
      if (active) {
        active
          .stop()
          .then(() => active.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [runStart]);

  return (
    <div style={styles.backdrop} role="presentation" onClick={onClose}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span>{title}</span>
          <button type="button" style={styles.close} onClick={onClose} aria-label="إغلاق">
            ✕
          </button>
        </div>
        <div id={containerId} style={styles.viewport} />
        {starting ? <div style={styles.hint}>جاري تشغيل الكاميرا…</div> : null}
        {scanError ? (
          <div style={styles.errorBox}>
            {scanError}
            <button type="button" style={styles.retryBtn} onClick={() => void runStart()} disabled={starting}>
              تشغيل الكاميرا
            </button>
          </div>
        ) : null}
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
    background: '#000',
  },
  hint: {
    marginTop: '10px',
    color: 'rgba(255,255,255,.65)',
    fontSize: '13px',
    textAlign: 'center',
  },
  errorBox: {
    marginTop: '10px',
    background: 'rgba(239,68,68,.15)',
    border: '1px solid rgba(239,68,68,.4)',
    color: '#fecaca',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  retryBtn: {
    alignSelf: 'stretch',
    padding: '10px 14px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '14px',
  },
};
