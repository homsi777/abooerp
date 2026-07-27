import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import { useToast } from '../../components/Toast';
import ActivityEventDetailsDialog from './ActivityEventDetailsDialog';
import type { ActivityRow, ActivityUserSummary } from '../../lib/admin/activityEventPresentation';
import {
  MODULE_OPTIONS,
  actionLabel,
  actionTone,
  actorSubtitle,
  actorTitle,
  entityLabel,
  fmtDateTime,
  roleLabel,
  summarizeActivity,
} from '../../lib/admin/activityEventPresentation';

type UserOption = { id: string; username: string; full_name: string; user_type?: string };
type BranchOption = { id: string; name: string };
type TabId = 'overview' | 'events';

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const TONE_BADGE: Record<ReturnType<typeof actionTone>, string> = {
  create: 'bg-emerald-100 text-emerald-800',
  update: 'bg-amber-100 text-amber-900',
  delete: 'bg-rose-100 text-rose-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export default function AdminEventsPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabId>('overview');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [summary, setSummary] = useState<ActivityUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(300);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromAt', new Date(`${fromDate}T00:00:00`).toISOString());
    if (toDate) params.set('toAt', new Date(`${toDate}T23:59:59`).toISOString());
    if (userId) params.set('userId', userId);
    if (branchId) params.set('branchId', branchId);
    if (entityType.trim()) params.set('entityType', entityType.trim());
    if (action.trim()) params.set('action', action.trim());
    params.set('limit', String(Math.min(500, Math.max(1, limit))));
    return params;
  }, [fromDate, toDate, userId, branchId, entityType, action, limit]);

  const loadRefs = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([
        httpClient.get<UserOption[]>('/users').catch(() => []),
        httpClient.get<BranchOption[]>('/branches?includeInactive=true').catch(() => []),
      ]);
      setUsers(u);
      setBranches(b);
    } catch {
      /* optional */
    }
  }, []);

  const load = useCallback(async (overrides?: { userId?: string }) => {
    setLoading(true);
    try {
      const params = buildParams();
      if (overrides?.userId !== undefined) {
        if (overrides.userId) params.set('userId', overrides.userId);
        else params.delete('userId');
      }
      const [events, overview] = await Promise.all([
        httpClient.get<ActivityRow[]>(`/admin/activity-events?${params.toString()}`),
        httpClient.get<ActivityUserSummary[]>(`/admin/activity-events/summary?${params.toString()}`),
      ]);
      setRows(events);
      setSummary(overview);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الأحداث', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildParams, showToast]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, row) => {
        acc.users += 1;
        acc.events += row.total_events;
        acc.created += row.created_count;
        acc.updated += row.updated_count;
        acc.deleted += row.deleted_count;
        acc.ledger += row.ledger_row_events;
        return acc;
      },
      { users: 0, events: 0, created: 0, updated: 0, deleted: 0, ledger: 0 },
    );
  }, [summary]);

  const focusUser = (id: string | null) => {
    setUserId(id ?? '');
    setTab('events');
    void load({ userId: id ?? '' });
  };

  const resetFilters = () => {
    setFromDate(defaultFromDate());
    setToDate(defaultToDate());
    setUserId('');
    setBranchId('');
    setEntityType('');
    setAction('');
    setLimit(300);
  };

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="card overflow-hidden">
        <div className="card-header flex flex-col gap-2 border-b bg-gradient-to-l from-indigo-50 to-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xl font-bold text-slate-900">مركز الأحداث</span>
              <p className="text-sm text-slate-600 font-normal mt-1 max-w-3xl">
                متابعة نشاط الموظفين والوكلاء والمحاسبين: من أدخل أو عدّل أو حذف، وفي أي قسم، مع تفاصيل كل سطر في دفتر
                الشحن وغيره حسب الصلاحيات.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={`toolbar-btn ${tab === 'overview' ? 'primary' : ''}`} onClick={() => setTab('overview')}>
                نظرة عامة
              </button>
              <button type="button" className={`toolbar-btn ${tab === 'events' ? 'primary' : ''}`} onClick={() => setTab('events')}>
                السجل التفصيلي
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 p-4 border-b bg-slate-50/80">
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-indigo-900">{totals.users}</div>
            <div className="text-xs text-slate-500">مستخدمون نشطون</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-slate-900">{totals.events}</div>
            <div className="text-xs text-slate-500">إجمالي الأحداث</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-emerald-700">{totals.created}</div>
            <div className="text-xs text-slate-500">إدخالات</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-amber-700">{totals.updated}</div>
            <div className="text-xs text-slate-500">تعديلات</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-rose-700">{totals.deleted}</div>
            <div className="text-xs text-slate-500">حذف</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold text-sky-700">{totals.ledger}</div>
            <div className="text-xs text-slate-500">أحداث دفتر الشحن</div>
          </div>
        </div>

        <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2 border-b">
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input type="date" className="form-input w-full" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input type="date" className="form-input w-full" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">الحساب / الموظف</label>
            <select className="form-input w-full" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">الكل</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.username}
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
            <label className="form-label">القسم</label>
            <select className="form-input w-full" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {MODULE_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">نوع الإجراء (رمز)</label>
            <input className="form-input w-full" value={action} onChange={(e) => setAction(e.target.value)} placeholder="مثال: DAILY_LEDGER_ROW_CREATED" />
          </div>
          <div className="form-group">
            <label className="form-label">حد السجل</label>
            <select className="form-input w-full" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
              {[100, 200, 300, 400, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-2 flex gap-2 border-b">
          <button type="button" className="toolbar-btn primary" onClick={() => void load()} disabled={loading}>
            {loading ? 'جاري التحميل…' : 'تحديث'}
          </button>
          <button type="button" className="toolbar-btn" onClick={resetFilters}>
            إعادة ضبط
          </button>
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="card overflow-auto">
          <div className="card-header">
            <span className="font-bold">نشاط المستخدمين</span>
            <span className="text-sm text-slate-500 font-normal">اضغط «عرض الأحداث» لرؤية كل ما قام به الموظف في الفترة المحددة</span>
          </div>
          <table className="data-grid text-sm w-full min-w-[920px]">
            <thead>
              <tr>
                <th>الحساب</th>
                <th>الدور / المالك</th>
                <th>إدخال</th>
                <th>تعديل</th>
                <th>حذف</th>
                <th>دفتر شحن</th>
                <th>شحنات</th>
                <th>مالية</th>
                <th>المجموع</th>
                <th>آخر نشاط</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.user_id ?? `anon-${row.actor_display_name}`}>
                  <td>
                    <div className="font-semibold">{row.actor_display_name || row.actor_username || '—'}</div>
                    {row.actor_username ? <div className="text-xs text-slate-500">@{row.actor_username}</div> : null}
                  </td>
                  <td className="text-xs">
                    <div>{roleLabel(row.actor_role_code, row.actor_user_type)}</div>
                    {row.agent_profile_name ? <div className="text-slate-500">وكيل: {row.agent_profile_name}</div> : null}
                  </td>
                  <td className="text-emerald-700 font-semibold">{row.created_count}</td>
                  <td className="text-amber-700 font-semibold">{row.updated_count}</td>
                  <td className="text-rose-700 font-semibold">{row.deleted_count}</td>
                  <td>{row.ledger_row_events}</td>
                  <td>{row.shipment_events}</td>
                  <td>{row.finance_events}</td>
                  <td className="font-bold">{row.total_events}</td>
                  <td className="text-xs whitespace-nowrap">{row.last_event_at ? fmtDateTime(row.last_event_at) : '—'}</td>
                  <td>
                    <button type="button" className="toolbar-btn text-xs py-0.5 primary" onClick={() => focusUser(row.user_id)}>
                      عرض الأحداث
                    </button>
                  </td>
                </tr>
              ))}
              {summary.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="text-center text-slate-500 py-10">
                    لا يوجد نشاط في الفترة المحددة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-auto">
          <table className="data-grid text-sm w-full min-w-[1040px]">
            <thead>
              <tr>
                <th className="w-36">الوقت</th>
                <th>الحساب والمالك</th>
                <th>الإجراء</th>
                <th>القسم</th>
                <th>الفرع</th>
                <th>ماذا تم</th>
                <th className="w-24">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tone = actionTone(row.action);
                return (
                  <tr key={row.id}>
                    <td className="text-xs whitespace-nowrap align-top">{fmtDateTime(row.created_at)}</td>
                    <td className="align-top">
                      <div className="font-semibold">{actorTitle(row)}</div>
                      <div className="text-xs text-slate-500">{actorSubtitle(row)}</div>
                    </td>
                    <td className="align-top">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded ${TONE_BADGE[tone]}`}>{actionLabel(row.action)}</span>
                    </td>
                    <td className="align-top text-sm">{entityLabel(row.entity_type)}</td>
                    <td className="align-top text-xs">{row.branch_name || '—'}</td>
                    <td className="align-top text-sm max-w-md">{summarizeActivity(row)}</td>
                    <td className="align-top">
                      <button type="button" className="toolbar-btn text-xs py-0.5 primary" onClick={() => setDetailRow(row)}>
                        تفاصيل
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500 py-10">
                    لا توجد أحداث ضمن الفلاتر الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ActivityEventDetailsDialog row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
