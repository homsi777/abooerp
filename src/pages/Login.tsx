import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { getLanState, httpClient } from '../lib/api/httpClient';
import ActivationModal, { getStoredLicense } from '../components/login/ActivationModal';
import LanConnectionModal from '../components/login/LanConnectionModal';
import DeviceLoginBootstrap, { resolveLoginBootstrapOverlay } from '../components/login/DeviceLoginBootstrap';

type LoginBranch = {
  id: string;
  code: string;
  name: string;
};

const features = [
  {
    icon: '🚚',
    color: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    title: 'إدارة الشحنات',
    desc: 'تتبع كامل من الإنشاء حتى التسليم',
  },
  {
    icon: '📊',
    color: 'linear-gradient(135deg,#059669,#0d9488)',
    title: 'التقارير المالية',
    desc: 'سندات وحركات مالية لحظية',
  },
  {
    icon: '🗂️',
    color: 'linear-gradient(135deg,#dc2626,#db2777)',
    title: 'البيانات المرجعية',
    desc: 'فروع وعملاء ومندوبين وتعريفات',
  },
  {
    icon: '🏢',
    color: 'linear-gradient(135deg,#d97706,#ea580c)',
    title: 'متعدد الفروع',
    desc: 'صلاحيات وعزل تام لكل فرع',
  },
];

// ─── Device status returned from registration handshake ───────────────────────
type DeviceCheckStatus = 'ok' | 'pending' | 'blocked' | 'unknown';

async function performDeviceHandshake(): Promise<DeviceCheckStatus> {
  try {
    const runtime = (window as any)?.runtime;
    let machineId = '';
    let deviceName = navigator.platform || 'Web Client';
    let osType = navigator.platform || '';

    if (runtime?.getMachineId) {
      machineId = (await runtime.getMachineId()) ?? '';
    }
    if (!machineId) return 'ok'; // no machineId = likely local/dev browser

    const resp = await httpClient.post<{ status?: string; deviceId?: string }>(
      '/system/register-device',
      {
        machineId,
        deviceName,
        osType,
      },
    ).catch((err: Error) => {
      // parse error codes from the error message
      if (err.message?.includes('DEVICE_BLOCKED')) return { _err: 'blocked' } as any;
      if (err.message?.includes('DEVICE_PENDING_APPROVAL')) return { _err: 'pending' } as any;
      return null;
    });

    if (!resp) return 'unknown';
    if ((resp as any)._err === 'blocked') return 'blocked';
    if ((resp as any)._err === 'pending') return 'pending';
    return 'ok';
  } catch {
    return 'ok'; // fail open for local environments
  }
}

export default function Login() {
  const navigate = useNavigate();
  const { login, sessionExpiredMessage, clearSessionExpiredMessage, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [branches, setBranches] = useState<LoginBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceCheckStatus>('ok');
  const [deviceChecking, setDeviceChecking] = useState(false);

  // Gear menu & modals
  const [gearOpen, setGearOpen] = useState(false);
  const [showActivation, setShowActivation] = useState(false);
  const [showLan, setShowLan] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  const [lanState, setLanState] = useState(() => getLanState());
  const [licenseActive, setLicenseActive] = useState(() => !!getStoredLicense());
  const [localConnected, setLocalConnected] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(() => navigator.onLine);

  /** تطبيق إنتاجي: بطاقة اختيار رئيسي / فرعي / وكيل قبل الدخول */
  const [deviceBootstrap, setDeviceBootstrap] = useState<'loading' | 'wizard' | 'agent' | 'off'>('loading');

  useEffect(() => {
    void resolveLoginBootstrapOverlay().then((r) => {
      if (r === 'show-wizard') setDeviceBootstrap('wizard');
      else if (r === 'show-agent') setDeviceBootstrap('agent');
      else setDeviceBootstrap('off');
    });
  }, []);

  const loginBootstrapReady = deviceBootstrap === 'off';

  useEffect(() => {
    if (!loginBootstrapReady) return;
    if (user) {
      navigate('/dashboard');
      return;
    }

    // Run device handshake + branch load in parallel
    setDeviceChecking(true);
    void performDeviceHandshake().then(status => {
      setDeviceStatus(status);
      setDeviceChecking(false);
      if (status === 'pending' || status === 'blocked') {
        setError(
          status === 'blocked'
            ? 'هذا الجهاز محظور من قِبل المسؤول — تواصل مع مسؤول النظام.'
            : 'الجهاز في انتظار موافقة المسؤول — يُرجى التواصل مع مسؤول النظام.',
        );
      }
    });

    httpClient
      .get<LoginBranch[]>('/auth/branches')
      .then((rows) => {
        setBranches(rows);
        setSelectedBranchId('');
      })
      .catch(() => setError('تعذر تحميل قائمة الفروع'));
  }, [navigate, user, loginBootstrapReady]);

  // Heartbeat every 60 seconds when device is approved
  useEffect(() => {
    if (!loginBootstrapReady) return;
    if (deviceStatus !== 'ok') return;
    const runtime = (window as any)?.runtime;
    if (!runtime?.getMachineId) return;

    const beat = async () => {
      try {
        const machineId = await runtime.getMachineId();
        if (machineId) {
          await httpClient.post('/system/device-heartbeat', { machineId }).catch(() => {});
        }
      } catch {}
    };

    const timer = setInterval(() => void beat(), 60_000);
    return () => clearInterval(timer);
  }, [deviceStatus, loginBootstrapReady]);

  // Close gear dropdown on outside click
  useEffect(() => {
    if (!gearOpen) return;
    const handler = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gearOpen]);

  useEffect(() => {
    const onConnectivity = (event: Event) => {
      const customEvent = event as CustomEvent<{ online?: boolean }>;
      setLocalConnected(Boolean(customEvent.detail?.online));
    };
    const onOnline = () => setCloudConnected(true);
    const onOffline = () => setCloudConnected(false);

    window.addEventListener('erp:runtime-connectivity', onConnectivity as EventListener);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('erp:runtime-connectivity', onConnectivity as EventListener);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadBranches = () => {
    httpClient
      .get<LoginBranch[]>('/auth/branches')
      .then((rows) => {
        setBranches(rows);
        setSelectedBranchId('');
      })
      .catch(() => {});
  };

  const branchOptions = useMemo(() => branches, [branches]);

  const isDeviceBlocked = deviceStatus === 'blocked';
  const isDevicePending = deviceStatus === 'pending';
  // يُقفل النظام إذا لم يكن مُفعَّلاً بعد — يجب التفعيل عبر ⚙️ أولاً
  const loginDisabled   = isDeviceBlocked || isDevicePending || deviceChecking || !licenseActive;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginDisabled) return;
    setError('');
    setLoading(true);
    try {
      if (username.trim() && password.trim()) {
        const loggedInUser = await login(username.trim(), password, selectedBranchId || undefined);
        navigate(loggedInUser.userType === 'agent' ? '/agent-portal' : '/dashboard');
      } else {
        setError('اسم المستخدم أو كلمة المرور فارغة');
      }
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('DEVICE_BLOCKED')) {
        setDeviceStatus('blocked');
        setError('هذا الجهاز محظور من قِبل المسؤول.');
      } else if (msg.includes('DEVICE_PENDING_APPROVAL')) {
        setDeviceStatus('pending');
        setError('الجهاز في انتظار موافقة المسؤول.');
      } else if (msg.includes('Selected branch is not allowed') || msg.includes('الفرع المحدد غير مسموح') || msg.includes('branch_not_allowed')) {
        setError('الفرع المحدد غير مسموح لهذا المستخدم. اختر "تلقائي حسب المستخدم" أو فرعاً ضمن صلاحياته.');
      } else if (msg.includes('No branch scope') || msg.includes('لا يوجد نطاق فرع')) {
        setError('لا يوجد نطاق فرع مرتبط بهذا المستخدم. راجع مركز الصلاحيات وحدد الفروع المسموحة.');
      } else if (msg.includes('inactive') || msg.includes('not active') || msg.includes('غير مفعّل') || msg.includes('حالة المستخدم')) {
        setError('هذا المستخدم غير مفعّل أو حالته لا تسمح بتسجيل الدخول.');
      } else {
        setError(msg || 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={styles.root}>
      {deviceBootstrap === 'wizard' && (
        <DeviceLoginBootstrap
          key="wizard"
          startAt="choose"
          onAgentBack={() => setDeviceBootstrap('wizard')}
        />
      )}
      {deviceBootstrap === 'agent' && (
        <DeviceLoginBootstrap
          key="agent"
          startAt="agent-msg"
          onAgentBack={() => setDeviceBootstrap('wizard')}
        />
      )}

      {/* decorative blobs */}
      <div style={{ ...styles.blob, top: '-120px', right: '-80px', background: 'radial-gradient(circle,rgba(124,58,237,.35) 0%,transparent 70%)' }} />
      <div style={{ ...styles.blob, bottom: '-100px', left: '-60px', background: 'radial-gradient(circle,rgba(79,70,229,.3) 0%,transparent 70%)' }} />

      {/* ── HELP BUTTON (?) — بجانب زر الإعدادات ── */}
      <button
        onClick={() => setShowHelp(true)}
        title="دليل التثبيت وإعداد النظام"
        style={{
          position: 'absolute', top: '20px', left: '72px', zIndex: 50,
          width: '42px', height: '42px', borderRadius: '12px',
          background: 'rgba(255,255,255,.1)',
          border: '1px solid rgba(255,255,255,.15)',
          color: '#fff', fontSize: '18px', fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)', transition: 'background .2s',
        }}
        onMouseEnter={e => Object.assign(e.currentTarget.style, { background: 'rgba(124,58,237,.35)' })}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,.1)' })}
      >
        ?
      </button>

      {/* ── GEAR BUTTON (top-left corner) ── */}
      <div ref={gearRef} style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 50 }}>
        <button
          onClick={() => setGearOpen((v) => !v)}
          title="إعدادات النظام"
          style={{
            width: '42px', height: '42px', borderRadius: '12px',
            background: gearOpen ? 'rgba(124,58,237,.35)' : 'rgba(255,255,255,.1)',
            border: '1px solid rgba(255,255,255,.15)',
            color: '#fff', fontSize: '20px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)', transition: 'background .2s',
          }}
        >
          ⚙️
        </button>

        {gearOpen && (
          <div style={{
            position: 'absolute', top: '50px', left: 0,
            width: '200px', background: '#1e1b3a',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '14px', padding: '8px',
            boxShadow: '0 16px 40px rgba(0,0,0,.5)',
            animation: 'fadeUp .15s ease both',
          }}>
            {/* تفعيل النظام */}
            <button
              onClick={() => { setGearOpen(false); setShowActivation(true); }}
              style={{
                width: '100%', padding: '10px 14px', background: 'none',
                border: 'none', borderRadius: '8px', color: '#f1f5f9',
                fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                textAlign: 'right',
              }}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,.08)' })}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: 'none' })}
            >
              <span>🔑</span>
              <span style={{ flex: 1 }}>تفعيل النظام</span>
              {licenseActive && <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,.15)', padding: '2px 6px', borderRadius: '20px' }}>مفعّل</span>}
            </button>

            {/* ربط محلي */}
            <button
              onClick={() => { setGearOpen(false); setShowLan(true); }}
              style={{
                width: '100%', padding: '10px 14px', background: 'none',
                border: 'none', borderRadius: '8px', color: '#f1f5f9',
                fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                textAlign: 'right',
              }}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,.08)' })}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: 'none' })}
            >
              <span>🌐</span>
              <span style={{ flex: 1 }}>ربط محلي</span>
              {lanState.serverIp && <span style={{ fontSize: '10px', color: '#38bdf8', background: 'rgba(14,165,233,.15)', padding: '2px 6px', borderRadius: '20px' }}>{lanState.serverIp}</span>}
            </button>

            {/* ربط سحابي — disabled */}
            <div
              title="هذه الميزة متاحة لاحقاً ضمن التفعيل السحابي"
              style={{
                width: '100%', padding: '10px 14px',
                borderRadius: '8px', color: 'rgba(255,255,255,.3)',
                fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px',
                cursor: 'not-allowed',
              }}
            >
              <span>☁️</span>
              <span style={{ flex: 1 }}>ربط سحابي</span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.05)', padding: '2px 6px', borderRadius: '20px' }}>قريباً</span>
            </div>
          </div>
        )}
      </div>

      {/* ── CONNECTION STATUS BADGES (top-right) ── */}
      <div style={{
        position: 'absolute', top: '20px', right: '20px', zIndex: 50,
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '7px 14px', borderRadius: '20px',
          background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: localConnected ? '#10b981' : 'rgba(255,255,255,.3)',
            boxShadow: localConnected ? '0 0 6px #10b981' : 'none',
          }} />
          <span style={{ color: localConnected ? '#6ee7b7' : 'rgba(255,255,255,.45)', fontSize: '12px', fontWeight: 600 }}>
            متصل محلي
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '7px 14px', borderRadius: '20px',
          background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: cloudConnected ? '#22c55e' : 'rgba(255,255,255,.3)',
            boxShadow: cloudConnected ? '0 0 6px #22c55e' : 'none',
          }} />
          <span style={{ color: cloudConnected ? '#86efac' : 'rgba(255,255,255,.45)', fontSize: '12px', fontWeight: 600 }}>
            متصل سحابي
          </span>
        </div>
      </div>

      {/* ── HELP / INSTALL GUIDE MODAL ── */}
      {showHelp && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
          <div dir="rtl" style={{
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 680,
            maxHeight: '90vh', overflow: 'auto',
            boxShadow: '0 32px 80px rgba(0,0,0,.4)',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
              padding: '22px 28px', borderRadius: '16px 16px 0 0',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <h2 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 800 }}>
                  📖 دليل التثبيت والإعداد
                </h2>
                <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.7)', fontSize: 12 }}>
                  خطوات تثبيت النظام من الصفر على جهاز ويندوز
                </p>
              </div>
              <button onClick={() => setShowHelp(false)} style={{
                background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)',
                color: '#fff', borderRadius: 8, width: 34, height: 34,
                cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
            </div>

            {/* Content */}
            <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* STEP 1 — PostgreSQL */}
              <div style={{ border: '1px solid #e5e7eb', borderRight: '4px solid #0ea5e9', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#eff6ff', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#0ea5e9',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 14, flexShrink: 0 }}>1</span>
                  <span style={{ fontWeight: 700, color: '#0369a1', fontSize: 14 }}>
                    تثبيت قاعدة البيانات PostgreSQL
                  </span>
                  <span style={{ marginRight: 'auto', background: '#dbeafe', color: '#1e40af',
                    fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>مطلوب أولاً</span>
                </div>
                <div style={{ padding: '16px 18px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                    قم بتنزيل PostgreSQL نسخة 15 أو أحدث من الرابط الرسمي:
                  </p>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
                    padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#166534', direction: 'ltr' }}>
                    https://www.postgresql.org/download/windows/
                  </div>
                  <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontWeight: 700, color: '#92400e', fontSize: 13, marginBottom: 8 }}>
                      ⚠️ إعدادات التثبيت المطلوبة — لا تغيّر هذه الإعدادات:
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <tbody>
                        {[
                          ['اسم المستخدم', 'postgres', '#166534'],
                          ['كلمة المرور', '12345678', '#991b1b'],
                          ['المنفذ (Port)', '5432', '#1e40af'],
                          ['Locale', 'Arabic, Saudi Arabia', '#374151'],
                        ].map(([label, value, color]) => (
                          <tr key={label} style={{ borderBottom: '1px solid #fde68a' }}>
                            <td style={{ padding: '6px 0', fontWeight: 600, color: '#92400e', width: '40%' }}>{label}</td>
                            <td style={{ padding: '6px 0' }}>
                              <code style={{ background: '#fff', border: `1px solid ${color}33`,
                                color, padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>{value}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                    ✅ عند الانتهاء من التثبيت، سيقوم النظام بإنشاء قاعدة البيانات تلقائياً عند أول تشغيل.
                  </p>
                </div>
              </div>

              {/* STEP 2 — Install App */}
              <div style={{ border: '1px solid #e5e7eb', borderRight: '4px solid #8b5cf6', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#f5f3ff', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#8b5cf6',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 14, flexShrink: 0 }}>2</span>
                  <span style={{ fontWeight: 700, color: '#6d28d9', fontSize: 14 }}>تثبيت نظام شركة عبو المحمود لنقل والخدمات الوجستية</span>
                </div>
                <div style={{ padding: '16px 18px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { icon: '📁', text: 'شغّل ملف التثبيت: شركة عبو المحمود لنقل والخدمات الوجستية Setup 1.0.1.exe' },
                    { icon: '✅', text: 'اضغط "نعم" على رسالة التحكم بحساب المستخدم (UAC)' },
                    { icon: '📂', text: 'اختر مجلد التثبيت (المجلد الافتراضي موصى به)' },
                    { icon: '⏳', text: 'انتظر اكتمال التثبيت — يستغرق دقيقة إلى دقيقتين' },
                    { icon: '🚀', text: 'اضغط على اختصار "شركة عبو المحمود لنقل والخدمات الوجستية" على سطح المكتب لتشغيل البرنامج' },
                  ].map(({ icon, text }) => (
                    <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <span style={{ fontSize: 13, color: '#374151' }}>{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* STEP 3 — First Run */}
              <div style={{ border: '1px solid #e5e7eb', borderRight: '4px solid #10b981', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#f0fdf4', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 14, flexShrink: 0 }}>3</span>
                  <span style={{ fontWeight: 700, color: '#065f46', fontSize: 14 }}>أول تشغيل — بيانات الدخول الافتراضية</span>
                </div>
                <div style={{ padding: '16px 18px', background: '#fff' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#374151' }}>
                    عند أول تشغيل يُعدّ النظام قاعدة البيانات تلقائياً، ثم يظهر هذا الشاشة. أدخل:
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      ['اسم المستخدم', 'admin'],
                      ['كلمة المرور', 'admin123'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ background: '#f9fafb', border: '1px solid #e5e7eb',
                        borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
                        <code style={{ fontSize: 14, fontWeight: 700, color: '#1f2937' }}>{value}</code>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: '12px 0 0', fontSize: 12, color: '#6b7280' }}>
                    💡 غيّر كلمة المرور فور الدخول من: الإعدادات ← المستخدمون
                  </p>
                </div>
              </div>

              {/* STEP 4 — Activation */}
              <div style={{ border: '1px solid #e5e7eb', borderRight: '4px solid #f59e0b', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#fffbeb', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#f59e0b',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 14, flexShrink: 0 }}>4</span>
                  <span style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>تفعيل النظام (اختياري للتجربة)</span>
                </div>
                <div style={{ padding: '16px 18px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                    اضغط على زر ⚙️ في الزاوية ← "تفعيل النظام" ← أدخل مفتاح التفعيل:
                  </p>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ background: '#fefce8', border: '2px solid #f59e0b', borderRadius: 8,
                      padding: '8px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#92400e', marginBottom: 2 }}>مفتاح التجربة</div>
                      <code style={{ fontSize: 18, fontWeight: 800, color: '#dc2626', letterSpacing: 2 }}>TEST1</code>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      ← 50 شحنة/تسليم/سند مجانية<br/>
                      للحصول على ترخيص كامل تواصل مع المورد
                    </div>
                  </div>
                </div>
              </div>

              {/* LAN Setup */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontWeight: 700, color: '#475569', fontSize: 13, marginBottom: 10,
                  display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🌐</span> ربط أجهزة إضافية على نفس الشبكة (LAN) — اختياري
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#64748b' }}>
                  <span>① على الجهاز الرئيسي: اضغط ⚙️ ← "ربط محلي" ← سجّل IP الجهاز الرئيسي</span>
                  <span>② على الجهاز الثانوي: افتح المتصفح ← <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: 4 }}>http://[IP-الجهاز-الرئيسي]:5188</code></span>
                  <span>③ أو شغّل نسخة شركة عبو المحمود لنقل والخدمات الوجستية وأدخل IP الجهاز الرئيسي في "ربط محلي"</span>
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>شركة عبو المحمود لنقل والخدمات الوجستية — نظام إدارة شركات الشحن</span>
                <button onClick={() => setShowHelp(false)} style={{
                  background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                  color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>فهمت ✓</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showActivation && (
        <ActivationModal
          onClose={() => { setShowActivation(false); setLicenseActive(!!getStoredLicense()); }}
        />
      )}
      {showLan && (
        <LanConnectionModal
          onClose={() => { setShowLan(false); setLanState(getLanState()); }}
          onConnected={(_serverIp, connBranches) => {
            setLanState(getLanState());
            if (connBranches.length) {
              setBranches(connBranches);
              setSelectedBranchId('');
            } else {
              loadBranches();
            }
          }}
        />
      )}

      {/* ── LEFT PANEL ── */}
      <div style={styles.left}>
        <div style={styles.brand}>
          <div style={styles.brandIcon}>📦</div>
          <div>
            <div style={styles.brandName}>شامل</div>
            <div style={styles.brandSub}>نظام إدارة الشحن والمحاسبة</div>
          </div>
        </div>

        <h1 style={styles.headline}>
          أدر شحناتك<br />
          <span style={styles.headlineAccent}>بكفاءة واحترافية</span>
        </h1>
        <p style={styles.subline}>منصة متكاملة للشحن والمتابعة المالية والتقارير</p>

        <div style={styles.featureList}>
          {features.map((f) => (
            <div key={f.title} style={styles.featureCard}>
              <div style={{ ...styles.featureIconBox, background: f.color }}>
                <span style={{ fontSize: '18px' }}>{f.icon}</span>
              </div>
              <div>
                <div style={styles.featureTitle}>{f.title}</div>
                <div style={styles.featureDesc}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={styles.right}>
        <div style={styles.card}>
          {/* card header */}
          <div style={styles.cardHeader}>
            <div style={styles.cardIconWrap}>
              <span style={{ fontSize: '22px' }}>📦</span>
            </div>
            <div style={styles.cardTitle}>شركة عبو المحمود لنقل والخدمات الوجستية</div>
            <div style={styles.cardTagline}>نظام الشحن المتكامل</div>
          </div>

          <h2 style={styles.welcomeTitle}>👋 مرحباً بعودتك</h2>
          <p style={styles.welcomeSub}>سجّل دخولك لإدارة منظومتك</p>

          {/* ── ACTIVATION REQUIRED BANNER ── */}
          {!licenseActive && (
            <div style={{
              background: 'linear-gradient(135deg,rgba(234,88,12,.25),rgba(220,38,38,.2))',
              border: '1px solid rgba(234,88,12,.5)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🔒</div>
              <div style={{ color: '#fed7aa', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                النظام بحاجة إلى التفعيل
              </div>
              <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
                اضغط على زر ⚙️ في الزاوية اليسرى<br />
                ثم اختر <strong style={{ color: '#fed7aa' }}>"تفعيل النظام"</strong> وأدخل المفتاح
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(0,0,0,.3)', border: '1px solid rgba(245,158,11,.4)',
                borderRadius: 8, padding: '6px 14px',
              }}>
                <span style={{ color: '#fde68a', fontSize: 11 }}>مفتاح التجربة:</span>
                <code style={{ color: '#fbbf24', fontWeight: 900, fontSize: 16, letterSpacing: 2 }}>TEST1</code>
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowActivation(true)}
                  style={{
                    background: 'linear-gradient(135deg,#f59e0b,#ea580c)',
                    border: 'none', borderRadius: 8, color: '#fff',
                    padding: '9px 22px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(245,158,11,.4)',
                  }}
                >
                  🔑 تفعيل النظام الآن
                </button>
              </div>
            </div>
          )}

          {/* session expired banner */}
          {sessionExpiredMessage && (
            <div style={styles.sessionBanner}>
              <span>{sessionExpiredMessage}</span>
              <button type="button" onClick={clearSessionExpiredMessage} style={styles.sessionDismiss}>✕</button>
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off" style={{ opacity: licenseActive ? 1 : 0.4, pointerEvents: licenseActive ? 'auto' : 'none', transition: 'opacity .3s' }}>
            {/* username */}
            <div style={styles.field}>
              <label style={styles.label}>اسم المستخدم</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم"
                autoFocus={licenseActive}
                disabled={!licenseActive}
                style={styles.input}
                onFocus={(e) => Object.assign(e.currentTarget.style, styles.inputFocus)}
                onBlur={(e) => Object.assign(e.currentTarget.style, { boxShadow: 'none', borderColor: 'rgba(255,255,255,.12)' })}
              />
            </div>

            {/* password */}
            <div style={styles.field}>
              <label style={styles.label}>كلمة المرور</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={!licenseActive}
                  style={{ ...styles.input, paddingLeft: '40px' }}
                  onFocus={(e) => Object.assign(e.currentTarget.style, styles.inputFocus)}
                  onBlur={(e) => Object.assign(e.currentTarget.style, { boxShadow: 'none', borderColor: 'rgba(255,255,255,.12)', paddingLeft: '40px' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  style={styles.eyeBtn}
                  tabIndex={-1}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* branch */}
            {branchOptions.length > 1 && (
              <div style={styles.field}>
                <label style={styles.label}>الفرع</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  style={styles.select}
                >
                  <option value="">تلقائي حسب المستخدم</option>
                  {branchOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Device status banners */}
            {deviceChecking && (
              <div style={{ ...styles.errorBox, background: 'rgba(59,130,246,.15)', borderColor: 'rgba(59,130,246,.4)', color: '#93c5fd', marginBottom: '12px' }}>
                🔄 جارٍ التحقق من هوية الجهاز...
              </div>
            )}
            {isDevicePending && (
              <div style={{ ...styles.errorBox, background: 'rgba(234,179,8,.15)', borderColor: 'rgba(234,179,8,.4)', color: '#fde68a', marginBottom: '12px' }}>
                ⏳ الجهاز في انتظار موافقة المسؤول — يُرجى التواصل مع مسؤول النظام.
              </div>
            )}
            {isDeviceBlocked && (
              <div style={{ ...styles.errorBox, marginBottom: '12px' }}>
                🚫 هذا الجهاز محظور — تواصل مع مسؤول النظام.
              </div>
            )}

            {/* error */}
            {error && !isDevicePending && !isDeviceBlocked && (
              <div style={styles.errorBox}>{error}</div>
            )}

            {/* submit */}
            <button
              type="submit"
              disabled={loading || loginDisabled}
              style={{ ...styles.submitBtn, ...((loading || loginDisabled) ? styles.submitBtnLoading : {}) }}
            >
              {loading ? (
                <span style={styles.spinner} />
              ) : (
                <span style={{ marginLeft: '6px' }}>←</span>
              )}
              {deviceChecking ? 'جارٍ التحقق...' : loading ? 'جارٍ تسجيل الدخول...' : isDevicePending ? 'بانتظار الموافقة' : isDeviceBlocked ? 'الجهاز محظور' : 'تسجيل الدخول'}
            </button>
          </form>

          <div style={styles.hint}>
            يُرجى طلب بيانات الدخول من مسؤول النظام
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        input::placeholder { color: rgba(255,255,255,.3); }
        select option { background: #1e1b4b; color: #e5e7eb; }
      `}</style>
    </div>
  );
}

/* ── Styles ── */
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    background: 'linear-gradient(135deg,#0d0b1e 0%,#1a1033 40%,#0e1628 100%)',
    fontFamily: "'Segoe UI',Tahoma,Arial,sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: 0,
  },

  /* left */
  left: {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '60px 48px',
    zIndex: 1,
    animation: 'fadeUp .6s ease both',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '48px',
  },
  brandIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    boxShadow: '0 4px 16px rgba(124,58,237,.4)',
  },
  brandName: {
    color: '#fff',
    fontWeight: 700,
    fontSize: '18px',
    letterSpacing: '-.3px',
  },
  brandSub: {
    color: 'rgba(255,255,255,.45)',
    fontSize: '12px',
  },
  headline: {
    color: '#fff',
    fontSize: '38px',
    fontWeight: 800,
    lineHeight: 1.25,
    margin: '0 0 12px',
    letterSpacing: '-.5px',
  },
  headlineAccent: {
    background: 'linear-gradient(90deg,#a78bfa,#818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subline: {
    color: 'rgba(255,255,255,.5)',
    fontSize: '15px',
    marginBottom: '40px',
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  featureCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '14px 18px',
    borderRadius: '14px',
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.07)',
    backdropFilter: 'blur(8px)',
    transition: 'background .2s',
  },
  featureIconBox: {
    width: '42px',
    height: '42px',
    borderRadius: '12px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,.3)',
  },
  featureTitle: {
    color: '#f1f5f9',
    fontWeight: 600,
    fontSize: '14px',
    marginBottom: '2px',
  },
  featureDesc: {
    color: 'rgba(255,255,255,.4)',
    fontSize: '12px',
  },

  /* right */
  right: {
    width: '440px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 32px',
    zIndex: 1,
  },
  card: {
    width: '100%',
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: '24px',
    padding: '36px 32px',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 24px 64px rgba(0,0,0,.5)',
    animation: 'fadeUp .7s ease both',
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '24px',
  },
  cardIconWrap: {
    width: '52px',
    height: '52px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '10px',
    boxShadow: '0 8px 24px rgba(124,58,237,.45)',
  },
  cardTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: '16px',
  },
  cardTagline: {
    color: 'rgba(255,255,255,.4)',
    fontSize: '12px',
    marginTop: '2px',
  },
  welcomeTitle: {
    color: '#fff',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 6px',
    textAlign: 'center',
  },
  welcomeSub: {
    color: 'rgba(255,255,255,.45)',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '24px',
  },

  /* form */
  field: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    color: 'rgba(255,255,255,.7)',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    background: 'rgba(255,255,255,.08)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color .2s,box-shadow .2s',
  },
  inputFocus: {
    borderColor: '#7c3aed',
    boxShadow: '0 0 0 3px rgba(124,58,237,.25)',
  },
  select: {
    width: '100%',
    padding: '11px 14px',
    background: 'rgba(255,255,255,.08)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'auto',
  },
  eyeBtn: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    padding: '2px',
    opacity: 0.7,
  },

  /* session / error */
  sessionBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(217,119,6,.15)',
    border: '1px solid rgba(217,119,6,.3)',
    borderRadius: '10px',
    padding: '10px 14px',
    color: '#fbbf24',
    fontSize: '13px',
    marginBottom: '16px',
  },
  sessionDismiss: {
    background: 'none',
    border: 'none',
    color: '#fbbf24',
    cursor: 'pointer',
    fontSize: '14px',
    padding: 0,
    marginRight: '8px',
  },
  errorBox: {
    background: 'rgba(239,68,68,.12)',
    border: '1px solid rgba(239,68,68,.3)',
    borderRadius: '10px',
    padding: '10px 14px',
    color: '#fca5a5',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '16px',
  },

  /* button */
  submitBtn: {
    width: '100%',
    padding: '13px',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: '0 6px 20px rgba(124,58,237,.45)',
    transition: 'opacity .2s,transform .1s',
    marginBottom: '4px',
  },
  submitBtnLoading: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  spinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid rgba(255,255,255,.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin .7s linear infinite',
  },

  /* hint */
  hint: {
    color: 'rgba(255,255,255,.3)',
    fontSize: '12px',
    textAlign: 'center',
    marginTop: '20px',
  },
};
