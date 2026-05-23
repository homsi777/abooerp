import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import { useToast } from '../../components/Toast';

type ActivityRow = {
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
  actor_display_name: string | null;
  actor_username: string | null;
  actor_role_code: string | null;
  branch_name: string | null;
  agent_profile_name: string | null;
};

type UserOption = { id: string; username: string; full_name: string; user_type?: string };
type BranchOption = { id: string; name: string };

const ACTION_AR: Record<string, string> = {
  SHIPMENT_CREATED: 'إنشاء شحنة',
  SHIPMENT_UPDATED: 'تعديل شحنة',
  SHIPMENT_DELETED: 'حذف شحنة',
  SHIPMENT_CONFIRMED: 'تأكيد شحنة',
  SHIPMENT_CREATE_FAILED: 'فشل إنشاء شحنة',
  SHIPMENT_UPDATE_FAILED: 'فشل تعديل شحنة',
  SHIPMENT_STOCK_RESERVED: 'حجز مخزون للشحنة',
  SHIPMENT_STOCK_RELEASED: 'إطلاق مخزون شحنة',
  SHIPMENT_FINANCIAL_REPOSTED: 'إعادة ترحيل مالي للشحنة',
  EMPLOYEE_CREATED: 'إضافة موظف',
  EMPLOYEE_UPDATED: 'تعديل موظف',
  EMPLOYEE_DELETED: 'حذف موظف',
  SALARY_CREATED: 'تسجيل راتب',
  SALARY_UPDATED: 'تعديل راتب',
  SALARY_DELETED: 'حذف سجل راتب',
  ADVANCE_CREATED: 'سلفة موظف',
  ADVANCE_UPDATED: 'تعديل سلفة',
  ADVANCE_DELETED: 'حذف سلفة',
  LOGIN_SUCCESS: 'تسجيل دخول ناجح',
  LOGIN_FAILED: 'فشل تسجيل دخول',
  LOGOUT: 'تسجيل خروج',
  PASSWORD_CHANGED: 'تغيير كلمة مرور',
  USER_CREATED: 'إنشاء مستخدم',
  USER_UPDATED: 'تعديل مستخدم',
  USER_DELETED: 'حذف مستخدم',
  AUTH_FORBIDDEN: 'رفض صلاحية',
  BRANCH_CREATED: 'إنشاء فرع',
  BRANCH_UPDATED: 'تعديل فرع',
  BRANCH_DELETED: 'حذف فرع',
  AGENT_LOOKUP_USED: 'بحث وكلاء للوجهة',
};

const ENTITY_AR: Record<string, string> = {
  shipment: 'شحنة',
  employee: 'موظف',
  salary_record: 'سجل راتب',
  employee_advance: 'سلفة',
  user: 'مستخدم',
  branch: 'فرع',
  customer: 'عميل',
  voucher: 'سند',
  cashbox: 'صندوق',
  auth: 'جلسة',
};

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ar-SY', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function actionLabel(action: string): string {
  return ACTION_AR[action] ?? action.replace(/_/g, ' ');
}

function entityLabel(entity: string): string {
  return ENTITY_AR[entity] ?? entity;
}

function summarizeLine(row: ActivityRow): string {
  const m = row.metadata || {};
  const bits: string[] = [];
  const pick = (k: string, label: string) => {
    const v = m[k];
    if (v !== undefined && v !== null && String(v) !== '') bits.push(`${label}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  };
  pick('shipmentNo', 'رقم الشحنة');
  pick('destinationCity', 'الوجهة');
  pick('newStatus', 'الحالة');
  pick('status', 'الحالة');
  pick('originalAmount', 'المبلغ');
  pick('originalCurrency', 'العملة');
  pick('reason', 'السبب');
  pick('employeeId', 'موظف');
  pick('period', 'الفترة');
  pick('amount', 'المبلغ');
  pick('changedFields', 'حقول معدّلة');
  pick('updatedFields', 'حقول معدّلة');
  pick('username', 'اسم مستخدم');
  pick('correlationId', 'معرّف الطلب');
  if (bits.length) return bits.join(' — ');
  const keys = Object.keys(m);
  if (!keys.length) return '—';
  return `${keys.length} حقل في البيانات التفصيلية (انظر الأسفل)`;
}

export default function AdminEventsPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<UserOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(200);

  const loadRefs = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([
        httpClient.get<UserOption[]>('/users').catch(() => []),
        httpClient.get<BranchOption[]>('/branches?includeInactive=true').catch(() => []),
      ]);
      setUsers(u);
      setBranches(b);
    } catch {
      /* اختياري */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromAt', new Date(`${fromDate}T00:00:00`).toISOString());
      if (toDate) params.set('toAt', new Date(`${toDate}T23:59:59`).toISOString());
      if (userId) params.set('userId', userId);
      if (branchId) params.set('branchId', branchId);
      if (entityType.trim()) params.set('entityType', entityType.trim());
      if (action.trim()) params.set('action', action.trim());
      params.set('limit', String(Math.min(500, Math.max(1, limit))));
      const path = params.toString() ? `/admin/activity-events?${params.toString()}` : `/admin/activity-events?limit=${limit}`;
      const data = await httpClient.get<ActivityRow[]>(path);
      setRows(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الأحداث', 'error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, userId, branchId, entityType, action, limit, showToast]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void load();
    // تحميل أولي فقط؛ التحديث عبر زر «تحديث» لتجنب طلبات متكررة أثناء تعديل الفلاتر
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.entity_type))).sort(), [rows]);
  const actionOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="card">
        <div className="card-header flex flex-col gap-1">
          <span className="text-lg font-bold">سجل الأحداث</span>
          <span className="text-sm text-slate-600 font-normal">
            يظهر هذا القسم فقط لحساب يملك صلاحية «المدير العام» (<code className="text-xs">admin.events.read</code>). يُسجَّل كل إجراء مهم
            (شحن، مالية، مستخدمون، …) مع التاريخ والوقت والتفاصيل.
          </span>
        </div>

        <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-2 border-b">
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input type="date" className="form-input w-full" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input type="date" className="form-input w-full" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">المستخدم</label>
            <select className="form-input w-full" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">الكل</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.username} ({u.user_type ?? '—'})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">الفرع</label>
            <select className="form-input w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">الكل</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">نوع الكيان</label>
            <input list="evt-entity" className="form-input w-full" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="مثال: shipment" />
            <datalist id="evt-entity">
              {entityOptions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label className="form-label">الإجراء (رمز)</label>
            <input list="evt-action" className="form-input w-full" value={action} onChange={(e) => setAction(e.target.value)} placeholder="مثال: SHIPMENT_CREATED" />
            <datalist id="evt-action">
              {actionOptions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label className="form-label">عدد السطور</label>
            <select className="form-input w-full" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
              {[100, 200, 300, 400, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-2 flex gap-2">
          <button type="button" className="toolbar-btn primary" onClick={() => void load()} disabled={loading}>
            {loading ? 'جاري التحميل…' : 'تحديث'}
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => {
              setFromDate('');
              setToDate('');
              setUserId('');
              setBranchId('');
              setEntityType('');
              setAction('');
              setLimit(200);
            }}
          >
            إعادة ضبط الفلاتر
          </button>
        </div>
      </div>

      <div className="card overflow-auto">
        <table className="data-grid text-sm w-full min-w-[960px]">
          <thead>
            <tr>
              <th className="w-48">التاريخ والوقت</th>
              <th>الفاعل</th>
              <th>الإجراء</th>
              <th>الكيان</th>
              <th>الفرع</th>
              <th>ملخص ما تم</th>
              <th className="w-24">تفصيل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = expanded.has(row.id);
              const actor =
                row.actor_display_name ||
                row.actor_username ||
                row.user_id ||
                '— (نظام أو جلسة بدون مستخدم)';
              const agentLine = row.agent_profile_name ? ` — وكيل: ${row.agent_profile_name}` : '';
              const roleLine = row.actor_role_code ? ` [${row.actor_role_code}]` : '';
              return (
                <Fragment key={row.id}>
                  <tr className={open ? 'bg-slate-50' : ''}>
                    <td className="whitespace-nowrap align-top text-xs">{fmtDateTime(row.created_at)}</td>
                    <td className="align-top">
                      <div className="font-medium">{actor}</div>
                      <div className="text-xs text-slate-500">
                        {row.actor_username && row.actor_display_name !== row.actor_username ? `@${row.actor_username}` : null}
                        {roleLine}
                        {agentLine}
                      </div>
                      {row.ip_address ? <div className="text-[11px] text-slate-400 mt-0.5">IP: {row.ip_address}</div> : null}
                    </td>
                    <td className="align-top">
                      <div className="font-semibold text-indigo-900">{actionLabel(row.action)}</div>
                      <div className="text-[11px] font-mono text-slate-500">{row.action}</div>
                    </td>
                    <td className="align-top">
                      <div>{entityLabel(row.entity_type)}</div>
                      <div className="text-xs font-mono text-slate-500">{row.entity_type}</div>
                      {row.entity_id ? <div className="text-[11px] break-all">id: {row.entity_id}</div> : null}
                    </td>
                    <td className="align-top text-xs">{row.branch_name || row.branch_id || '—'}</td>
                    <td className="align-top text-xs text-slate-800 max-w-md">{summarizeLine(row)}</td>
                    <td className="align-top">
                      <button type="button" className="toolbar-btn text-xs py-0.5" onClick={() => toggle(row.id)}>
                        {open ? 'إخفاء' : 'عرض'}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="p-3">
                        <div className="text-xs font-semibold text-slate-700 mb-1">البيانات التفصيلية (JSON)</div>
                        <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-80 whitespace-pre-wrap break-all">
                          {JSON.stringify(row.metadata ?? {}, null, 2)}
                        </pre>
                        {row.user_agent ? (
                          <div className="text-[11px] text-slate-500 mt-2 break-all">User-Agent: {row.user_agent}</div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-8">
                  لا توجد أحداث ضمن الفلاتر الحالية.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
