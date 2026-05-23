import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import { useToast } from '../../components/Toast';
import { EscapeModalScrim } from '../../context/EscapeRegistryContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkedDevice {
  id: string;
  machine_id: string;
  device_name: string;
  ip_address: string | null;
  os_type: string | null;
  is_approved: boolean;
  is_blocked: boolean;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deviceStatus(d: LinkedDevice): { label: string; css: string } {
  if (d.is_blocked)  return { label: 'محظور',           css: 'bg-red-100 text-red-800' };
  if (d.is_approved) return { label: 'معتمد',           css: 'bg-green-100 text-green-800' };
  return               { label: 'بانتظار الموافقة',    css: 'bg-yellow-100 text-yellow-800' };
}

function isOnline(lastSeen: string): boolean {
  const ms = Date.now() - new Date(lastSeen).getTime();
  return ms < 3 * 60 * 1000; // within 3 minutes
}

function formatRelative(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60)  return 'الآن';
  if (sec < 3600) return `منذ ${Math.floor(sec / 60)} دقيقة`;
  if (sec < 86400) return `منذ ${Math.floor(sec / 3600)} ساعة`;
  return `منذ ${Math.floor(sec / 86400)} يوم`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LinkedDevicesPage() {
  const { showToast } = useToast();
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'blocked'>('all');
  const [renameTarget, setRenameTarget] = useState<LinkedDevice | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<LinkedDevice[]>('/system/linked-devices');
      setDevices(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الأجهزة', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
    // Auto-refresh every 30 seconds
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    return devices.filter(d => {
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (
          !d.device_name.toLowerCase().includes(q) &&
          !(d.ip_address ?? '').toLowerCase().includes(q) &&
          !d.machine_id.toLowerCase().includes(q)
        ) return false;
      }
      if (statusFilter === 'approved' && !d.is_approved) return false;
      if (statusFilter === 'blocked'  && !d.is_blocked)  return false;
      if (statusFilter === 'pending'  && (d.is_approved || d.is_blocked)) return false;
      return true;
    });
  }, [devices, searchTerm, statusFilter]);

  const stats = useMemo(() => ({
    total:    devices.length,
    approved: devices.filter(d => d.is_approved).length,
    pending:  devices.filter(d => !d.is_approved && !d.is_blocked).length,
    blocked:  devices.filter(d => d.is_blocked).length,
    online:   devices.filter(d => isOnline(d.last_seen_at) && d.is_approved).length,
  }), [devices]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const approve = async (d: LinkedDevice) => {
    setSavingId(d.id);
    try {
      await httpClient.post(`/system/linked-devices/${d.id}/approve`, {});
      showToast(`تمت الموافقة على "${d.device_name}"`, 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const block = async (d: LinkedDevice) => {
    if (!confirm(`هل تريد حظر "${d.device_name}"؟ لن يتمكن من تسجيل الدخول.`)) return;
    setSavingId(d.id);
    try {
      await httpClient.post(`/system/linked-devices/${d.id}/block`, {});
      showToast(`تم حظر "${d.device_name}"`, 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (d: LinkedDevice) => {
    if (!confirm(`هل تريد إزالة "${d.device_name}" من القائمة؟ سيحتاج لإعادة التسجيل.`)) return;
    setSavingId(d.id);
    try {
      await httpClient.delete(`/system/linked-devices/${d.id}`);
      showToast(`تم إزالة "${d.device_name}"`, 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const openRename = (d: LinkedDevice) => {
    setRenameTarget(d);
    setRenameValue(d.device_name);
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    if (!renameValue.trim()) { showToast('الاسم فارغ', 'error'); return; }
    setSavingId(renameTarget.id);
    try {
      await httpClient.put(`/system/linked-devices/${renameTarget.id}/rename`, { name: renameValue.trim() });
      showToast('تم تحديث اسم الجهاز', 'success');
      setRenameTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const osIcon = (os: string | null) => {
    if (!os) return '💻';
    const l = os.toLowerCase();
    if (l.includes('win')) return '🖥️';
    if (l.includes('mac') || l.includes('darwin')) return '🍎';
    if (l.includes('linux')) return '🐧';
    return '💻';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">الأجهزة المرتبطة</h2>
        <button type="button" className="toolbar-btn" onClick={() => void load()}>
          ↻ تحديث
        </button>
      </div>

      <p className="text-sm text-gray-600 max-w-2xl">
        كل جهاز يحاول الاتصال بالسيرفر عبر الشبكة المحلية يظهر هنا. يجب الموافقة على الجهاز قبل أن يتمكن من تسجيل الدخول.
        جهاز السيرفر الرئيسي (localhost) يُعتمد تلقائياً.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">إجمالي الأجهزة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-green-600">{stats.online}</div>
          <div className="stat-label">متصل الآن</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-green-700">{stats.approved}</div>
          <div className="stat-label">معتمد</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-yellow-600">{stats.pending}</div>
          <div className="stat-label">بانتظار الموافقة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-red-600">{stats.blocked}</div>
          <div className="stat-label">محظور</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap gap-3 items-center">
        <input
          type="text"
          className="form-input flex-1 min-w-48"
          placeholder="بحث باسم الجهاز أو IP أو Machine ID..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <div className="flex gap-1">
          {(['all', 'pending', 'approved', 'blocked'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'الكل' : s === 'pending' ? 'معلق' : s === 'approved' ? 'معتمد' : 'محظور'}
            </button>
          ))}
        </div>
      </div>

      {/* Devices Table */}
      <div className="card overflow-auto">
        {loading && devices.length === 0 ? (
          <p className="p-4 text-gray-500">جاري التحميل...</p>
        ) : (
          <table className="data-grid text-sm w-full">
            <thead>
              <tr>
                <th>الجهاز</th>
                <th>عنوان IP</th>
                <th>نظام التشغيل</th>
                <th>Machine ID</th>
                <th>أول اتصال</th>
                <th>آخر ظهور</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const st = deviceStatus(d);
                const online = isOnline(d.last_seen_at) && d.is_approved;
                const busy = savingId === d.id;
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{osIcon(d.os_type)}</span>
                        <div>
                          <div className="font-medium">{d.device_name}</div>
                          {d.approved_by_name && (
                            <div className="text-xs text-gray-400">اعتمده: {d.approved_by_name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{d.ip_address ?? '—'}</td>
                    <td className="text-xs">{d.os_type ?? '—'}</td>
                    <td>
                      <span className="font-mono text-xs text-gray-500 truncate max-w-24 block" title={d.machine_id}>
                        {d.machine_id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="text-xs text-gray-500">{new Date(d.first_seen_at).toLocaleDateString('ar')}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full inline-block ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="text-xs text-gray-500">{formatRelative(d.last_seen_at)}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${st.css}`}>{st.label}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {!d.is_approved && !d.is_blocked && (
                          <button
                            type="button"
                            className="toolbar-btn text-xs py-0.5 px-2 text-green-700 hover:bg-green-50"
                            onClick={() => approve(d)}
                            disabled={busy}
                          >
                            ✓ اعتماد
                          </button>
                        )}
                        {d.is_approved && !d.is_blocked && (
                          <button
                            type="button"
                            className="toolbar-btn text-xs py-0.5 px-2 text-red-600 hover:bg-red-50"
                            onClick={() => block(d)}
                            disabled={busy}
                          >
                            ✕ حظر
                          </button>
                        )}
                        {d.is_blocked && (
                          <button
                            type="button"
                            className="toolbar-btn text-xs py-0.5 px-2 text-green-700 hover:bg-green-50"
                            onClick={() => approve(d)}
                            disabled={busy}
                          >
                            ✓ رفع الحظر
                          </button>
                        )}
                        <button
                          type="button"
                          className="toolbar-btn text-xs py-0.5 px-2"
                          onClick={() => openRename(d)}
                          disabled={busy}
                        >
                          ✎ تسمية
                        </button>
                        <button
                          type="button"
                          className="toolbar-btn text-xs py-0.5 px-2 text-gray-500 hover:bg-gray-100"
                          onClick={() => remove(d)}
                          disabled={busy}
                          title="إزالة من القائمة"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <p className="p-6 text-center text-gray-400">
            {devices.length === 0
              ? 'لا أجهزة مسجّلة — سيظهر الجهاز تلقائياً عند أول اتصال'
              : 'لا نتائج تطابق معايير الفلترة'}
          </p>
        )}
      </div>

      {/* Rename Modal */}
      {renameTarget && (
        <EscapeModalScrim
          onClose={() => setRenameTarget(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-lg">تسمية الجهاز</h3>
            <p className="text-sm text-gray-500">الاسم الحالي: <strong>{renameTarget.device_name}</strong></p>
            <input
              type="text"
              className="form-input w-full"
              placeholder="مثال: Cashier-01 أو حاسوب المخزن"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void saveRename()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="toolbar-btn" onClick={() => setRenameTarget(null)}>إلغاء</button>
              <button
                type="button"
                className="toolbar-btn primary"
                onClick={saveRename}
                disabled={savingId === renameTarget.id || !renameValue.trim()}
              >
                حفظ
              </button>
            </div>
          </div>
        </EscapeModalScrim>
      )}

      {/* Info box */}
      <div className="card bg-blue-50 border border-blue-200 text-sm text-blue-800 space-y-1">
        <p><strong>📡 كيف يعمل النظام:</strong></p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>عند أول اتصال لجهاز جديد يُسجَّل تلقائياً بحالة "بانتظار الموافقة"</li>
          <li>جهاز السيرفر (localhost) يُعتمد تلقائياً دون الحاجة لموافقة</li>
          <li>الأجهزة المعتمدة فقط يمكنها تسجيل الدخول</li>
          <li>الأجهزة المحظورة ترى رسالة "محظور" عند محاولة تسجيل الدخول</li>
          <li>يرسل كل جهاز نبضة كل 60 ثانية لتحديث "آخر ظهور"</li>
        </ul>
      </div>
    </div>
  );
}
