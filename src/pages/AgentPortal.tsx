import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpClient } from '../lib/api/httpClient';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../lib/shipments/shipmentStatus';
import { useAuth } from '../context/AuthProvider';

type ProfilePayload = {
  agent: {
    id: string;
    code: string;
    name: string;
    governorate?: string | null;
    city?: string | null;
    area?: string | null;
    branch_id?: string | null;
    is_active?: boolean;
  };
  branchLabel: string | null;
  username: string;
};

type WorkspaceSummary = {
  counts: Record<string, number>;
  totals: { all: number; today: number; upcoming: number };
  financeToday: { receiptVouchers: number; paymentVouchers: number };
};

type ShipmentRow = {
  id: string;
  shipment_no: string;
  created_at: string;
  sender_name?: string | null;
  receiver_name?: string | null;
  destination_city?: string | null;
  status: string;
  original_amount: number;
  original_currency: string;
  updated_at: string;
};

function strip(iso: string) {
  return iso.slice(0, 10);
}

export default function AgentPortal() {
  const { user, hasPermission } = useAuth();
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const tasks: Promise<unknown>[] = [
        httpClient.get<ShipmentRow[]>('/agent-portal/shipments').then((rows) => setShipments(rows)),
      ];
      if (hasPermission('agent_portal.view')) {
        tasks.push(httpClient.get<ProfilePayload>('/agent-portal/profile').then((p) => setProfile(p)));
        tasks.push(httpClient.get<WorkspaceSummary>('/agent-portal/workspace-summary').then((s) => setSummary(s)));
      }
      await Promise.all(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل لوحة الوكيل.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayIso = useMemo(() => strip(new Date().toISOString()), []);

  const buckets = useMemo(() => {
    const upcoming = shipments.filter((s) =>
      ['REGISTERED', 'CONFIRMED', 'READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT'].includes(
        normalizeShipmentStatus(s.status),
      ),
    );
    const pendingDelivery = shipments.filter((s) =>
      ['OUT_FOR_DELIVERY', 'ARRIVED_AT_DESTINATION', 'AGENT_RECEIVED', 'IN_TRANSIT'].includes(
        normalizeShipmentStatus(s.status),
      ),
    );
    const todayShipments = shipments.filter((s) => strip(s.created_at) === todayIso);
    return { upcoming, pendingDelivery, todayShipments };
  }, [shipments, todayIso]);

  const kpi = summary?.counts ?? {};

  const financeUnavailable =
    summary?.financeToday &&
    (summary.financeToday.receiptVouchers < 0 || summary.financeToday.paymentVouchers < 0);

  return (
    <div className="h-full flex flex-col gap-3" dir="rtl">
      <header className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">لوحة الوكيل</h1>
        <p className="text-sm text-slate-600 mt-1">
          إدارة الشحنات والتسليمات والمالية الخاصة بهذا الوكيل فقط
        </p>
        {profile ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-slate-500">اسم الوكيل:</span>{' '}
              <span className="font-semibold">{profile.agent.name}</span>
            </div>
            <div>
              <span className="text-slate-500">كود الوكيل:</span>{' '}
              <span className="font-mono">{profile.agent.code}</span>
            </div>
            <div>
              <span className="text-slate-500">الفرع:</span>{' '}
              <span>{profile.branchLabel ?? profile.agent.branch_id?.slice(0, 8) ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">المحافظة / المدينة / المنطقة:</span>{' '}
              <span>
                {[profile.agent.governorate, profile.agent.city, profile.agent.area].filter(Boolean).join(' / ') ||
                  '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">حالة الوكيل:</span>{' '}
              <span>{profile.agent.is_active === false ? 'معلق' : 'نشط'}</span>
            </div>
            <div>
              <span className="text-slate-500">المستخدم الحالي:</span>{' '}
              <span>{profile.username}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 mt-2">المستخدم: {user?.username ?? '—'}</p>
        )}
      </header>

      {hasPermission('agent_portal.view') && summary ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-700 mb-2">مؤشرات تشغيلية</div>
          <div className="flex flex-wrap gap-2">
            {[
              ['شحنات اليوم', summary.totals.today],
              ['شحنات قادمة', summary.totals.upcoming],
              ['بانتظار الاستلام', (kpi.HANDED_TO_AGENT ?? 0) + (kpi.HANDED_TO_DRIVER ?? 0)],
              ['قيد الطريق', kpi.IN_TRANSIT ?? 0],
              ['خارجة للتسليم', kpi.OUT_FOR_DELIVERY ?? 0],
              ['مسلمة', kpi.DELIVERED ?? 0],
              ['مرتجعة', (kpi.RETURN_REQUESTED ?? 0) + (kpi.RETURNED ?? 0)],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="min-w-[120px] rounded-md bg-white border border-slate-200 px-3 py-2 text-center"
              >
                <div className="text-lg font-bold text-indigo-700">{val}</div>
                <div className="text-xs text-slate-600">{label}</div>
              </div>
            ))}
            {financeUnavailable ? (
              <>
                <div className="min-w-[140px] rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  صندوق اليوم: غير متاح حالياً
                </div>
                <div className="min-w-[140px] rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  سندات اليوم: غير متاح حالياً
                </div>
              </>
            ) : (
              <>
                <div className="min-w-[120px] rounded-md bg-white border border-slate-200 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-emerald-700">{summary.financeToday.receiptVouchers}</div>
                  <div className="text-xs text-slate-600">سندات قبض اليوم</div>
                </div>
                <div className="min-w-[120px] rounded-md bg-white border border-slate-200 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-emerald-700">{summary.financeToday.paymentVouchers}</div>
                  <div className="text-xs text-slate-600">سندات دفع اليوم</div>
                </div>
                <div className="min-w-[160px] rounded-md bg-slate-100 border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600">
                  مصاريف اليوم: غير متاح حالياً — سيتم ربط المصاريف بعد اكتمال ترحيل الشحنات مالياً.
                </div>
              </>
            )}
          </div>
          {financeUnavailable ? (
            <p className="text-xs text-amber-800 mt-2">
              سيتم تفعيل الأرصدة المالية بعد ربط الشحنات بالحركات المالية.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link to="/shipment-quick-ledger" className="toolbar-btn no-underline">
          إضافة شحنة جديدة
        </Link>
        <Link to="/shipments" className="toolbar-btn no-underline">
          قائمة الشحنات
        </Link>
        <Link to="/delivery-queue/pending" className="toolbar-btn no-underline">
          التسليم
        </Link>
      </div>

      {error ? <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div> : null}
      {loading ? <div className="text-sm text-gray-600">جاري التحميل...</div> : null}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 min-h-0">
        <Panel title="شحنات قادمة للوكيل" empty={buckets.upcoming.length === 0}>
          <MiniTable rows={buckets.upcoming.slice(0, 8)} />
        </Panel>
        <Panel title="شحنات أدخلها اليوم" empty={buckets.todayShipments.length === 0}>
          <MiniTable rows={buckets.todayShipments.slice(0, 8)} />
        </Panel>
        <Panel title="بانتظار التسليم (ضمن النطاق)" empty={buckets.pendingDelivery.length === 0}>
          <MiniTable rows={buckets.pendingDelivery.slice(0, 8)} />
        </Panel>
        <Panel title="آخر الشحنات المحدثة" empty={shipments.length === 0}>
          <MiniTable
            rows={[...shipments]
              .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
              .slice(0, 8)}
          />
        </Panel>
      </div>

      {!loading && shipments.length === 0 ? (
        <div className="text-center py-8 text-slate-600 border border-dashed border-slate-300 rounded-lg">
          لا توجد شحنات ضمن نطاق هذا الوكيل حالياً.
          <div className="mt-3">
            <Link to="/shipment-quick-ledger" className="toolbar-btn no-underline inline-block">
              إضافة شحنة جديدة
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty: boolean;
}) {
  return (
    <div className="flex flex-col min-h-[200px] rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-slate-100 text-sm font-semibold border-b border-slate-200">{title}</div>
      <div className="flex-1 overflow-auto">
        {empty ? (
          <div className="p-4 text-sm text-slate-500">لا توجد بيانات في هذا القسم.</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function MiniTable({ rows }: { rows: ShipmentRow[] }) {
  return (
    <table className="data-grid text-sm">
      <thead>
        <tr>
          <th>رقم الشحنة</th>
          <th>التاريخ</th>
          <th>المرسل</th>
          <th>المستلم</th>
          <th>الوجهة</th>
          <th>الحالة</th>
          <th>المبلغ</th>
          <th>آخر تحديث</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="font-mono">{row.shipment_no}</td>
            <td>{new Date(row.created_at).toLocaleDateString('ar-SY')}</td>
            <td>{row.sender_name ?? '—'}</td>
            <td>{row.receiver_name ?? '—'}</td>
            <td>{row.destination_city ?? '—'}</td>
            <td>{shipmentStatusLabelAr(normalizeShipmentStatus(row.status))}</td>
            <td>
              {Number(row.original_amount || 0).toLocaleString()} {row.original_currency}
            </td>
            <td>{new Date(row.updated_at).toLocaleString('ar-SY')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
