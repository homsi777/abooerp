import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type SettingsMap = Record<string, unknown>;

type DiagnosticsPayload = {
  uptimeSeconds: number;
  environmentMode: string;
  networkMode: string;
  host: string;
  port: number;
  databaseStatus: string;
  baseCurrency: string;
  companyId: string;
  branchId: string | null;
  electronAvailable: boolean;
  linkedDevicesCount?: number;
  approvedDevicesCount?: number;
  pendingDevicesCount?: number;
  lan?: {
    serverHost: string;
    serverPort: number;
    lanAddresses: string[];
    realtimeConnectedClients: number;
    lanFirewallHint: string;
  };
};

type SystemConfigForm = {
  networkMode: string;
  networkHost: string;
  networkPort: number;
  networkProtocol: 'http' | 'https';
  networkPublicUrl: string;
  networkLanEnabled: boolean;
  runtimeEnvironment: string;
  runtimeOfflineMode: boolean;
  runtimeAutoReconnect: boolean;
  runtimeDeviceName: string;
  runtimeMaintenanceMode: boolean;
  diagnosticsEnabled: boolean;
  diagnosticsLevel: string;
  electronAutoLaunch: boolean;
  electronAutoUpdateEnabled: boolean;
  electronWindowMode: string;
};

const defaultForm: SystemConfigForm = {
  networkMode: 'local_only',
  networkHost: '127.0.0.1',
  networkPort: 3001,
  networkProtocol: 'http',
  networkPublicUrl: '',
  networkLanEnabled: false,
  runtimeEnvironment: 'development',
  runtimeOfflineMode: false,
  runtimeAutoReconnect: true,
  runtimeDeviceName: 'حلب-الجميلية',
  runtimeMaintenanceMode: false,
  diagnosticsEnabled: true,
  diagnosticsLevel: 'info',
  electronAutoLaunch: false,
  electronAutoUpdateEnabled: true,
  electronWindowMode: 'windowed',
};

export default function SystemNetworkSettingsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState<SystemConfigForm>(defaultForm);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);

  const applySettings = (settings: SettingsMap) => {
    setForm({
      networkMode: String(settings['network.mode'] ?? defaultForm.networkMode),
      networkHost: String(settings['network.host'] ?? defaultForm.networkHost),
      networkPort: Number(settings['network.port'] ?? defaultForm.networkPort),
      networkProtocol: (String(settings['network.protocol'] ?? defaultForm.networkProtocol) as 'http' | 'https'),
      networkPublicUrl: String(settings['network.publicUrl'] ?? defaultForm.networkPublicUrl),
      networkLanEnabled: Boolean(settings['network.lanEnabled'] ?? defaultForm.networkLanEnabled),
      runtimeEnvironment: String(settings['runtime.environment'] ?? defaultForm.runtimeEnvironment),
      runtimeOfflineMode: Boolean(settings['runtime.offlineMode'] ?? defaultForm.runtimeOfflineMode),
      runtimeAutoReconnect: Boolean(settings['runtime.autoReconnect'] ?? defaultForm.runtimeAutoReconnect),
      runtimeDeviceName: String(settings['runtime.deviceName'] ?? defaultForm.runtimeDeviceName),
      runtimeMaintenanceMode: Boolean(settings['runtime.maintenanceMode'] ?? defaultForm.runtimeMaintenanceMode),
      diagnosticsEnabled: Boolean(settings['diagnostics.enabled'] ?? defaultForm.diagnosticsEnabled),
      diagnosticsLevel: String(settings['diagnostics.level'] ?? defaultForm.diagnosticsLevel),
      electronAutoLaunch: Boolean(settings['electron.autoLaunch'] ?? defaultForm.electronAutoLaunch),
      electronAutoUpdateEnabled: Boolean(settings['electron.autoUpdateEnabled'] ?? defaultForm.electronAutoUpdateEnabled),
      electronWindowMode: String(settings['electron.windowMode'] ?? defaultForm.electronWindowMode),
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<{ settings: SettingsMap }>('/system-settings');
      applySettings(data.settings);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل إعدادات النظام', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchDiagnostics = async () => {
    setChecking(true);
    try {
      const data = await httpClient.get<DiagnosticsPayload>('/system/diagnostics');
      setDiagnostics(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل التشخيص', 'error');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void load();
    void fetchDiagnostics();
  }, []);

  const save = async () => {
    setSaving(true);
    const entries: Array<[string, unknown]> = [
      ['network.mode', form.networkMode],
      ['network.host', form.networkHost],
      ['network.port', Number(form.networkPort)],
      ['network.protocol', form.networkProtocol],
      ['network.publicUrl', form.networkPublicUrl.trim()],
      ['network.lanEnabled', form.networkLanEnabled],
      ['runtime.environment', form.runtimeEnvironment],
      ['runtime.offlineMode', form.runtimeOfflineMode],
      ['runtime.autoReconnect', form.runtimeAutoReconnect],
      ['runtime.deviceName', form.runtimeDeviceName.trim()],
      ['runtime.maintenanceMode', form.runtimeMaintenanceMode],
      ['diagnostics.enabled', form.diagnosticsEnabled],
      ['diagnostics.level', form.diagnosticsLevel],
      ['electron.autoLaunch', form.electronAutoLaunch],
      ['electron.autoUpdateEnabled', form.electronAutoUpdateEnabled],
      ['electron.windowMode', form.electronWindowMode],
    ];
    try {
      await Promise.all(
        entries.map(([key, value]) => httpClient.put(`/system-settings/${encodeURIComponent(key)}`, { value }))
      );
      showToast('تم حفظ إعدادات النظام والشبكة', 'success');
      await fetchDiagnostics();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ إعدادات النظام', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-4">
      <div className="card-header">النظام والشبكة</div>

      <div className="grid grid-cols-3 gap-3">
        <div className="form-group">
          <label className="form-label">نمط الشبكة</label>
          <select className="form-select w-full" value={form.networkMode} onChange={(e) => setForm((p) => ({ ...p, networkMode: e.target.value }))}>
            <option value="local_only">محلي فقط</option>
            <option value="lan_branch">فرع / شبكة داخلية</option>
            <option value="cloud_ready">جاهز للسحابة</option>
            <option value="hybrid_ready">نمط مختلط</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">المضيف</label>
          <input className="form-input w-full" value={form.networkHost} onChange={(e) => setForm((p) => ({ ...p, networkHost: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">المنفذ</label>
          <input type="number" className="form-input w-full" min={1} max={65535} value={form.networkPort} onChange={(e) => setForm((p) => ({ ...p, networkPort: Number(e.target.value) || 3001 }))} />
        </div>
        <div className="form-group">
          <label className="form-label">البروتوكول</label>
          <select className="form-select w-full" value={form.networkProtocol} onChange={(e) => setForm((p) => ({ ...p, networkProtocol: e.target.value as 'http' | 'https' }))}>
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">الرابط العام</label>
          <input className="form-input w-full" value={form.networkPublicUrl} onChange={(e) => setForm((p) => ({ ...p, networkPublicUrl: e.target.value }))} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.networkLanEnabled} onChange={(e) => setForm((p) => ({ ...p, networkLanEnabled: e.target.checked }))} />
        تفعيل نشر الشبكة الداخلية
      </label>

      <div className="grid grid-cols-4 gap-3">
        <div className="form-group">
          <label className="form-label">بيئة التشغيل</label>
          <select className="form-select w-full" value={form.runtimeEnvironment} onChange={(e) => setForm((p) => ({ ...p, runtimeEnvironment: e.target.value }))}>
            <option value="development">تطوير</option>
            <option value="staging">تجريبي</option>
            <option value="production">إنتاج</option>
            <option value="test">اختبار</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">اسم الجهاز</label>
          <input className="form-input w-full" value={form.runtimeDeviceName} onChange={(e) => setForm((p) => ({ ...p, runtimeDeviceName: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">مستوى التشخيص</label>
          <select className="form-select w-full" value={form.diagnosticsLevel} onChange={(e) => setForm((p) => ({ ...p, diagnosticsLevel: e.target.value }))}>
            <option value="error">خطأ</option>
            <option value="warn">تنبيه</option>
            <option value="info">معلومات</option>
            <option value="debug">تفصيلي</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">وضع نافذة التطبيق</label>
          <select className="form-select w-full" value={form.electronWindowMode} onChange={(e) => setForm((p) => ({ ...p, electronWindowMode: e.target.value }))}>
            <option value="windowed">عادية</option>
            <option value="maximized">مكبّرة</option>
            <option value="fullscreen">ملء الشاشة</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.runtimeOfflineMode} onChange={(e) => setForm((p) => ({ ...p, runtimeOfflineMode: e.target.checked }))} />
          وضع دون اتصال
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.runtimeAutoReconnect} onChange={(e) => setForm((p) => ({ ...p, runtimeAutoReconnect: e.target.checked }))} />
          إعادة الاتصال تلقائياً
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.runtimeMaintenanceMode} onChange={(e) => setForm((p) => ({ ...p, runtimeMaintenanceMode: e.target.checked }))} />
          وضع الصيانة
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.diagnosticsEnabled} onChange={(e) => setForm((p) => ({ ...p, diagnosticsEnabled: e.target.checked }))} />
          تفعيل التشخيص
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.electronAutoLaunch} onChange={(e) => setForm((p) => ({ ...p, electronAutoLaunch: e.target.checked }))} />
          تشغيل تلقائي للتطبيق
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.electronAutoUpdateEnabled} onChange={(e) => setForm((p) => ({ ...p, electronAutoUpdateEnabled: e.target.checked }))} />
          تحديث تلقائي
        </label>
      </div>

      <div className="flex gap-2">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving || loading}>
          حفظ إعدادات النظام
        </button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>
          إعادة تحميل
        </button>
        <button className="toolbar-btn" onClick={() => void fetchDiagnostics()} disabled={checking}>
          {checking ? 'جار الفحص...' : 'فحص التشخيص'}
        </button>
      </div>

      {diagnostics && (
        <div className="space-y-3 text-sm">
          {/* General diagnostics */}
          <div className="card bg-gray-50">
            <div className="font-semibold mb-2">تشخيص التشغيل</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>مدة التشغيل: <strong>{diagnostics.uptimeSeconds}</strong> ث</div>
              <div>البيئة: <strong>{diagnostics.environmentMode}</strong></div>
              <div>الشبكة: <strong>{diagnostics.networkMode}</strong> ({diagnostics.host}:{diagnostics.port})</div>
              <div>قاعدة البيانات: <strong style={{ color: diagnostics.databaseStatus === 'connected' ? '#059669' : '#dc2626' }}>{diagnostics.databaseStatus}</strong></div>
              <div>العملة الأساس: <strong>{diagnostics.baseCurrency}</strong></div>
              <div>تطبيق سطح المكتب: <strong>{diagnostics.electronAvailable ? 'نعم' : 'لا'}</strong></div>
              {diagnostics.linkedDevicesCount !== undefined && (
                <div>الأجهزة المربوطة: <strong>{diagnostics.approvedDevicesCount}/{diagnostics.linkedDevicesCount}</strong> معتمدة ({diagnostics.pendingDevicesCount} معلقة)</div>
              )}
            </div>
          </div>

          {/* LAN Runtime panel */}
          {diagnostics.lan && (
            <div className="card" style={{ background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.2)' }}>
              <div className="font-semibold mb-2" style={{ color: '#0ea5e9' }}>🌐 حالة شبكة LAN</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>مضيف الخادم: <strong style={{ fontFamily: 'monospace' }}>{diagnostics.lan.serverHost}:{diagnostics.lan.serverPort}</strong></div>
                <div>عملاء Realtime متصلون: <strong style={{ color: diagnostics.lan.realtimeConnectedClients > 0 ? '#059669' : '#6b7280' }}>{diagnostics.lan.realtimeConnectedClients}</strong></div>
              </div>
              <div className="mt-2">
                <div className="font-medium mb-1">عناوين LAN المكتشفة:</div>
                {diagnostics.lan.lanAddresses.length === 0 ? (
                  <div style={{ color: '#9ca3af' }}>لم يتم اكتشاف عناوين LAN — تحقق من اتصال الشبكة</div>
                ) : (
                  diagnostics.lan.lanAddresses.map(ip => (
                    <div key={ip} style={{ fontFamily: 'monospace', color: '#10b981', fontSize: 13 }}>
                      ✅ http://{ip}:{diagnostics.lan!.serverPort}
                    </div>
                  ))
                )}
              </div>
              <div className="mt-2" style={{ color: '#6b7280', fontSize: 11 }}>
                💡 {diagnostics.lan.lanFirewallHint}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
