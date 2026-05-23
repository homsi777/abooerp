import { useEffect, useState } from 'react';
import { clearLanConnection, getLanPort, saveLanConnection } from '../../lib/api/httpClient';

export const DEVICE_BOOTSTRAP_STORAGE_KEY = 'erp.deviceBootstrap.v1';

type Step = 'choose' | 'branch-ip' | 'agent-msg';

function validateIp(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim());
}

async function isPackagedElectron(): Promise<boolean> {
  try {
    const runtime = (window as any)?.runtime;
    if (!runtime?.getEnv) return false;
    return (await runtime.getEnv()) === 'production';
  } catch {
    return false;
  }
}

export function readDeviceBootstrap(): '' | 'primary' | 'branch' | 'agent' {
  const v = localStorage.getItem(DEVICE_BOOTSTRAP_STORAGE_KEY);
  if (v === 'primary' || v === 'branch' || v === 'agent') return v;
  return '';
}

export async function resolveLoginBootstrapOverlay(): Promise<'show-wizard' | 'show-agent' | 'hide'> {
  const packaged = await isPackagedElectron();
  if (!packaged) return 'hide';
  const v = readDeviceBootstrap();
  if (v === '') return 'show-wizard';
  if (v === 'agent') return 'show-agent';
  return 'hide';
}

type Props = {
  startAt: 'choose' | 'agent-msg';
  onAgentBack?: () => void;
};

/**
 * قبل تسجيل الدخول (تطبيق سطح مكتب إنتاجي): اختيار رئيسي / فرعي / وكيل.
 */
export default function DeviceLoginBootstrap({ startAt, onAgentBack }: Props) {
  const [step, setStep] = useState<Step>(startAt === 'agent-msg' ? 'agent-msg' : 'choose');
  const [port, setPort] = useState(4010);
  const [ip, setIp] = useState('');
  const [branchStatus, setBranchStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [branchErr, setBranchErr] = useState('');

  useEffect(() => {
    setStep(startAt === 'agent-msg' ? 'agent-msg' : 'choose');
  }, [startAt]);

  useEffect(() => {
    const loadPort = async () => {
      try {
        const runtime = (window as any)?.runtime;
        if (runtime?.getConfig) {
          const cfg = await runtime.getConfig();
          if (cfg?.backendPort) setPort(Number(cfg.backendPort) || 4010);
        }
      } catch {
        setPort(getLanPort());
      }
    };
    void loadPort();
  }, []);

  const persistPrimary = async () => {
    const fsApi = (window as any)?.fs;
    clearLanConnection();
    if (fsApi?.writeConfig) {
      await fsApi.writeConfig({
        backendResolutionMode: 'localhost',
        manualLanHost: '',
        backendPort: port,
      });
    }
    if (fsApi?.enableLocalPackagedServer) {
      await fsApi.enableLocalPackagedServer();
    }
    localStorage.setItem(DEVICE_BOOTSTRAP_STORAGE_KEY, 'primary');
    window.location.reload();
  };

  const testBranchConnection = async () => {
    if (!validateIp(ip)) {
      setBranchErr('عنوان IP غير صالح — مثال: 192.168.1.100');
      setBranchStatus('fail');
      return;
    }
    setBranchStatus('testing');
    setBranchErr('');
    const base = `http://${ip.trim()}:${port}/api/v1`;
    try {
      const healthRes = await fetch(`${base}/system/lan-health`, { signal: AbortSignal.timeout(8000) });
      if (!healthRes.ok) throw new Error(`lan-health HTTP ${healthRes.status}`);
      const healthPayload = await healthRes.json();
      if (!healthPayload?.ok) throw new Error('lan-health returned ok=false');

      const branchRes = await fetch(`${base}/auth/branches`, { signal: AbortSignal.timeout(8000) });
      if (!branchRes.ok) throw new Error(`branches HTTP ${branchRes.status}`);

      setBranchStatus('success');
    } catch {
      setBranchStatus('fail');
      setBranchErr(`تعذر الاتصال بالرئيسي — تحقق من IP والشبكة والمنفذ (${port}).`);
    }
  };

  const saveBranchAndFinish = async () => {
    const fsApi = (window as any)?.fs;
    saveLanConnection(ip.trim(), port);
    if (fsApi?.writeConfig) {
      await fsApi.writeConfig({
        backendResolutionMode: 'manual_lan',
        manualLanHost: ip.trim(),
        backendPort: port,
      });
    }
    localStorage.setItem(DEVICE_BOOTSTRAP_STORAGE_KEY, 'branch');
    window.location.reload();
  };

  const chooseAgent = () => {
    localStorage.setItem(DEVICE_BOOTSTRAP_STORAGE_KEY, 'agent');
    setStep('agent-msg');
  };

  const agentBack = () => {
    localStorage.removeItem(DEVICE_BOOTSTRAP_STORAGE_KEY);
    setStep('choose');
    onAgentBack?.();
  };

  if (step === 'agent-msg') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 500,
          background: 'rgba(0,0,0,.72)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
        dir="rtl"
      >
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            background: '#1e1b3a',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 20,
            padding: '28px 26px',
            boxShadow: '0 32px 80px rgba(0,0,0,.55)',
          }}
        >
          <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🛠️</div>
          <h2 style={{ margin: '0 0 12px', color: '#fff', fontSize: 18, fontWeight: 800, textAlign: 'center' }}>
            وضع الوكيل
          </h2>
          <p style={{ margin: '0 0 20px', color: 'rgba(255,255,255,.75)', fontSize: 14, lineHeight: 1.75, textAlign: 'center' }}>
            هذه الخدمة قيد التطوير حالياً، وسيتم تفعيلها قريباً بعد إتمام التجارب اللازمة لإنجاز المهمة بنجاح.
            <br />
            <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 13 }}>نشكر صبركم.</span>
          </p>
          <button
            type="button"
            onClick={agentBack}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,.2)',
              background: 'rgba(255,255,255,.08)',
              color: '#e2e8f0',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            العودة لاختيار نوع الجهاز
          </button>
        </div>
      </div>
    );
  }

  if (step === 'branch-ip') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 500,
          background: 'rgba(0,0,0,.72)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
        dir="rtl"
      >
        <div
          style={{
            width: '100%',
            maxWidth: 440,
            background: '#1e1b3a',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 20,
            padding: '28px 26px',
            boxShadow: '0 32px 80px rgba(0,0,0,.55)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>جهاز فرعي — عنوان الرئيسي</div>
            <button
              type="button"
              onClick={() => setStep('choose')}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontSize: 18 }}
            >
              ✕
            </button>
          </div>
          <p style={{ margin: '0 0 16px', color: 'rgba(255,255,255,.55)', fontSize: 13, lineHeight: 1.6 }}>
            أدخل IP الجهاز الرئيسي (الذي يعمل عليه PostgreSQL والخادم)، ثم اختبر الاتصال ثم احفظ.
          </p>
          <label style={{ display: 'block', color: 'rgba(255,255,255,.65)', fontSize: 12, marginBottom: 6 }}>IP الرئيسي</label>
          <input
            value={ip}
            onChange={(e) => {
              setIp(e.target.value);
              setBranchStatus('idle');
              setBranchErr('');
            }}
            placeholder="192.168.1.100"
            dir="ltr"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px 14px',
              marginBottom: 12,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,.15)',
              background: 'rgba(255,255,255,.07)',
              color: '#fff',
              fontSize: 15,
              fontFamily: 'monospace',
            }}
          />
          <div style={{ color: 'rgba(255,255,255,.35)', fontSize: 11, marginBottom: 14 }}>المنفذ: {port}</div>

          {branchErr && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(239,68,68,.12)',
                border: '1px solid rgba(239,68,68,.35)',
                color: '#fca5a5',
                fontSize: 13,
              }}
            >
              {branchErr}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void testBranchConnection()}
              disabled={!validateIp(ip) || branchStatus === 'testing'}
              style={{
                flex: 1,
                minWidth: 120,
                padding: 12,
                borderRadius: 10,
                border: 'none',
                fontWeight: 700,
                fontSize: 14,
                cursor: validateIp(ip) && branchStatus !== 'testing' ? 'pointer' : 'not-allowed',
                opacity: validateIp(ip) && branchStatus !== 'testing' ? 1 : 0.55,
                background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
                color: '#fff',
              }}
            >
              {branchStatus === 'testing' ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
            </button>
            <button
              type="button"
              onClick={() => void saveBranchAndFinish()}
              disabled={branchStatus !== 'success'}
              style={{
                flex: 1,
                minWidth: 120,
                padding: 12,
                borderRadius: 10,
                border: 'none',
                fontWeight: 700,
                fontSize: 14,
                cursor: branchStatus === 'success' ? 'pointer' : 'not-allowed',
                opacity: branchStatus === 'success' ? 1 : 0.5,
                background: 'linear-gradient(135deg,#059669,#10b981)',
                color: '#fff',
              }}
            >
              حفظ والمتابعة
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      dir="rtl"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#1e1b3a',
          border: '1px solid rgba(255,255,255,.12)',
          borderRadius: 22,
          padding: '28px 24px 24px',
          boxShadow: '0 32px 80px rgba(0,0,0,.55)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 36 }}>🖥️</span>
        </div>
        <h2 style={{ margin: '0 0 8px', color: '#fff', fontSize: 18, fontWeight: 800, textAlign: 'center' }}>
          نوع هذا الجهاز
        </h2>
        <p style={{ margin: '0 0 22px', color: 'rgba(255,255,255,.55)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
          اختر مرة واحدة بعد التثبيت. يمكن لاحقاً تعديل الربط من ⚙️ إن لزم.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => void persistPrimary()}
            style={{
              textAlign: 'right',
              padding: '16px 18px',
              borderRadius: 14,
              border: '1px solid rgba(124,58,237,.4)',
              background: 'linear-gradient(135deg,rgba(124,58,237,.25),rgba(79,70,229,.15))',
              color: '#f1f5f9',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 26 }}>🏢</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>رئيسي</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>هذا الجهاز يستضيف قاعدة البيانات والخادم محلياً</div>
            </div>
            <span style={{ opacity: 0.5 }}>←</span>
          </button>

          <button
            type="button"
            onClick={() => setStep('branch-ip')}
            style={{
              textAlign: 'right',
              padding: '16px 18px',
              borderRadius: 14,
              border: '1px solid rgba(14,165,233,.35)',
              background: 'rgba(14,165,233,.12)',
              color: '#f1f5f9',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 26 }}>🌐</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>فرعي</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>الاتصال بجهاز رئيسي على الشبكة (بدون قاعدة بيانات محلية)</div>
            </div>
            <span style={{ opacity: 0.5 }}>←</span>
          </button>

          <button
            type="button"
            onClick={chooseAgent}
            style={{
              textAlign: 'right',
              padding: '16px 18px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.05)',
              color: '#cbd5e1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 26 }}>🚚</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>وكيل</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)' }}>وضع تشغيل مخصص للوكلاء — قريباً</div>
            </div>
            <span style={{ opacity: 0.5 }}>←</span>
          </button>
        </div>
      </div>
    </div>
  );
}
