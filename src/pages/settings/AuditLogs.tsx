import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type AuditLogRecord = {
  id: string;
  company_id: string;
  branch_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type Filters = {
  fromAt: string;
  toAt: string;
  userId: string;
  entityType: string;
  action: string;
  branchId: string;
};

const initialFilters: Filters = {
  fromAt: '',
  toAt: '',
  userId: '',
  entityType: '',
  action: '',
  branchId: '',
};

export default function AuditLogsSettingsPage() {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selected, setSelected] = useState<AuditLogRecord | null>(null);
  const [loading, setLoading] = useState(false);

  const userOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.user_id).filter(Boolean))) as string[], [logs]);
  const actionOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);
  const entityOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.entity_type))).sort(), [logs]);
  const branchOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.branch_id).filter(Boolean))) as string[],
    [logs],
  );

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.fromAt) params.set('fromAt', new Date(`${filters.fromAt}T00:00:00`).toISOString());
      if (filters.toAt) params.set('toAt', new Date(`${filters.toAt}T23:59:59`).toISOString());
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.action) params.set('action', filters.action);
      if (filters.branchId) params.set('branchId', filters.branchId);
      params.set('limit', '200');
      const path = params.toString() ? `/audit-logs?${params.toString()}` : '/audit-logs';
      const rows = await httpClient.get<AuditLogRecord[]>(path);
      setLogs(rows);
      if (selected) {
        setSelected(rows.find((row) => row.id === selected.id) ?? null);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل سجل التدقيق', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="card">
      <div className="card-header">سجل التدقيق (Audit Logs)</div>
      <div className="grid grid-cols-6 gap-2 mb-3">
        <div className="form-group">
          <label className="form-label">من تاريخ</label>
          <input type="date" className="form-input w-full" value={filters.fromAt} onChange={(e) => setFilters((p) => ({ ...p, fromAt: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">إلى تاريخ</label>
          <input type="date" className="form-input w-full" value={filters.toAt} onChange={(e) => setFilters((p) => ({ ...p, toAt: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">User</label>
          <select className="form-select w-full" value={filters.userId} onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}>
            <option value="">الكل</option>
            {userOptions.map((userId) => (
              <option key={userId} value={userId}>{userId}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Action</label>
          <select className="form-select w-full" value={filters.action} onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}>
            <option value="">الكل</option>
            {actionOptions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Entity</label>
          <select className="form-select w-full" value={filters.entityType} onChange={(e) => setFilters((p) => ({ ...p, entityType: e.target.value }))}>
            <option value="">الكل</option>
            {entityOptions.map((entityType) => (
              <option key={entityType} value={entityType}>{entityType}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Branch</label>
          <select className="form-select w-full" value={filters.branchId} onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}>
            <option value="">الكل</option>
            {branchOptions.map((branchId) => (
              <option key={branchId} value={branchId}>{branchId}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button className="toolbar-btn primary" onClick={() => void load()} disabled={loading}>تطبيق الفلاتر</button>
        <button
          className="toolbar-btn"
          onClick={() => {
            setFilters(initialFilters);
            setTimeout(() => {
              void load();
            }, 0);
          }}
        >
          إعادة ضبط
        </button>
      </div>

      <table className="data-grid">
        <thead>
          <tr>
            <th>الوقت</th>
            <th>الإجراء</th>
            <th>الكيان</th>
            <th>المستخدم</th>
            <th>الفرع</th>
            <th>تفاصيل</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className={selected?.id === log.id ? 'selected' : ''} onClick={() => setSelected(log)}>
              <td>{log.created_at}</td>
              <td>{log.action}</td>
              <td>{log.entity_type}</td>
              <td>{log.user_id ?? '-'}</td>
              <td>{log.branch_id ?? '-'}</td>
              <td>{Object.keys(log.metadata || {}).join(', ') || '-'}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-gray-500">لا توجد بيانات ضمن الفلاتر الحالية</td>
            </tr>
          )}
        </tbody>
      </table>

      {selected && (
        <div className="card mt-3">
          <div className="card-header">تفاصيل الحدث</div>
          <div className="text-sm space-y-1">
            <div><strong>ID:</strong> {selected.id}</div>
            <div><strong>Action:</strong> {selected.action}</div>
            <div><strong>Entity:</strong> {selected.entity_type} / {selected.entity_id ?? '-'}</div>
            <div><strong>User:</strong> {selected.user_id ?? '-'}</div>
            <div><strong>Branch:</strong> {selected.branch_id ?? '-'}</div>
            <div><strong>IP:</strong> {selected.ip_address ?? '-'}</div>
            <div><strong>User Agent:</strong> {selected.user_agent ?? '-'}</div>
            <pre className="mt-2 bg-gray-100 p-2 rounded overflow-auto">{JSON.stringify(selected.metadata ?? {}, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
