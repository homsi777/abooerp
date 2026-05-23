import { ReactNode, useEffect, useState } from 'react';
import TopMegaNavigation from '../components/navigation/TopMegaNavigation';
import LicenseQuotaBar from '../components/layout/LicenseQuotaBar';
import PrimaryRemoteUpdateBanner from '../components/layout/PrimaryRemoteUpdateBanner';
import { getLanPort, getLanState, getResolvedApiBaseUrl } from '../lib/api/httpClient';

interface LayoutProps {
  children: ReactNode;
  user: {
    name: string;
    branchId: string | null;
  };
  onLogout: () => void;
}

type ServerLanInfo = {
  ip: string;
  port: number;
  addresses: string[];
};

type LanHealthPayload = {
  ok?: boolean;
  port?: number;
  lanAddresses?: string[];
};

function hostFromUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function isLocalLanIp(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts[0] !== '192' || parts[1] !== '168' || parts[2] !== '1') return false;
  const lastOctet = Number(parts[3]);
  return Number.isInteger(lastOctet) && lastOctet >= 1 && lastOctet <= 254;
}

function onlyLocalLanIps(addresses: string[]): string[] {
  return addresses.filter(isLocalLanIp);
}

async function resolveServerLanInfo(): Promise<ServerLanInfo | null> {
  const runtime = typeof window !== 'undefined' ? window.runtime : undefined;
  const cfg = runtime?.getConfig ? await runtime.getConfig().catch(() => null) : null;
  const configuredHost = hostFromUrl(cfg?.apiBaseUrl);
  const configuredPort = Number(cfg?.backendPort ?? getLanPort()) || 4010;

  if (isLocalLanIp(configuredHost)) {
    return { ip: configuredHost, port: configuredPort, addresses: [configuredHost] };
  }

  const saved = getLanState();
  if (isLocalLanIp(saved.serverIp)) {
    return { ip: saved.serverIp, port: getLanPort(), addresses: [saved.serverIp] };
  }

  if (runtime?.getLanAddresses) {
    const addresses = onlyLocalLanIps(await runtime.getLanAddresses().catch(() => []));
    if (addresses.length > 0) {
      return { ip: addresses[0], port: configuredPort, addresses };
    }
  }

  try {
    const baseUrl = await getResolvedApiBaseUrl();
    const response = await fetch(`${baseUrl}/system/lan-health`, { signal: AbortSignal.timeout(4000) });
    const payload = (await response.json().catch(() => null)) as LanHealthPayload | null;
    const addresses = onlyLocalLanIps(Array.isArray(payload?.lanAddresses) ? payload.lanAddresses : []);
    if (payload?.ok && addresses.length > 0) {
      return { ip: addresses[0], port: Number(payload.port ?? configuredPort) || configuredPort, addresses };
    }
  } catch {
    // Best-effort header indicator; keep the main layout usable offline.
  }

  return null;
}

export default function Layout({ children, user, onLogout }: LayoutProps) {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [serverLanInfo, setServerLanInfo] = useState<ServerLanInfo | null>(null);

  useEffect(() => {
    const onConn = (ev: Event) => {
      const d = (ev as CustomEvent<{ online?: boolean }>).detail;
      if (typeof d?.online === 'boolean') setApiOnline(d.online);
    };
    window.addEventListener('erp:runtime-connectivity', onConn);
    return () => window.removeEventListener('erp:runtime-connectivity', onConn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const info = await resolveServerLanInfo();
      if (!cancelled) setServerLanInfo(info);
    };
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const today = new Date().toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const branchName = user.branchId ? `#${user.branchId.slice(0, 8)}` : 'غير محدد';

  return (
    <div className="app-container" dir="rtl">
      {/* ── Top header ── */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', flexShrink: 0,
          }}>📦</div>
          <h1 style={{ fontSize: '15px', fontWeight: 700 }}>شركة عبو المحمود لنقل والخدمات الوجستية — نظام إدارة الشحن والمحاسبة</h1>
        </div>
        <div className="flex items-center gap-4 text-sm" style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
          <span style={{ opacity: 0.7 }}>{today}</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ opacity: 0.7 }}>الفرع: {branchName}</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ opacity: 0.7 }}>المستخدم: {user.name}</span>
          {serverLanInfo ? (
            <>
              <span style={{ opacity: 0.3 }}>|</span>
              <span
                title={serverLanInfo.addresses.map((ip) => `http://${ip}:${serverLanInfo.port}`).join('\n')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  direction: 'ltr',
                  background: 'rgba(255,255,255,.14)',
                  border: '1px solid rgba(255,255,255,.22)',
                  borderRadius: '999px',
                  padding: '3px 9px',
                  fontFamily: 'Consolas, monospace',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#e0f2fe',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ direction: 'rtl', fontFamily: 'Tahoma, Arial, sans-serif', fontWeight: 600 }}>IP الرئيسي</span>
                <span>{serverLanInfo.ip}:{serverLanInfo.port}</span>
              </span>
            </>
          ) : null}
          <button
            onClick={onLogout}
            style={{
              marginRight: '8px', padding: '5px 14px', borderRadius: '6px',
              background: '#dc2626', color: 'white', border: 'none',
              fontSize: '13px', cursor: 'pointer', fontWeight: 600,
            }}
          >
            تسجيل خروج
          </button>
        </div>
      </header>

      {/* ── Top horizontal navigation ── */}
      <TopMegaNavigation />

      <PrimaryRemoteUpdateBanner />

      {/* ── Main content (full width, no sidebar) ── */}
      <main className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="content-area" style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {children}
        </div>

        {/* ── License quota warning bar (TEST licenses only) ── */}
        <LicenseQuotaBar />

        <footer className="app-footer">
          <div className="flex items-center gap-4" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>
              الاتصال:{' '}
              {apiOnline === null ? 'ويب' : apiOnline ? '✅ جاهز' : '❌ غير متوفر'}
            </span>
            <span style={{ opacity: 0.3 }}>|</span>
            <span>وضع العميل: {typeof window !== 'undefined' && (window as any).runtime ? 'سطح مكتب' : 'متصفح'}</span>
          </div>
          <div className="flex items-center gap-4" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>Ctrl+N: جديد</span>
            <span>Ctrl+S: حفظ</span>
            <span>Ctrl+P: طباعة</span>
            <span>F5: تحديث</span>
            <span>Esc: رجوع</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
