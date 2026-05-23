import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Box,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  CreditCard,
  FileText,
  LayoutDashboard,
  Package,
  RefreshCw,
  Truck,
  Users,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { httpClient } from '../lib/api/httpClient';
import { formatCurrency } from '../lib/currency/currency';
import { useAuth } from '../context/AuthProvider';

type CurrencyRow = {
  currency_code: string;
  total_debit?: number | string;
  total_credit?: number | string;
  net_balance?: number | string;
  total_due?: number | string;
  collected?: number | string;
  remaining?: number | string;
};

type StatusRow = { status: string; count: number };
type RecentShipment = {
  id: string;
  shipment_no: string;
  created_at: string;
  status: string;
  payment_status: string | null;
  original_currency: string;
  original_amount: number | string;
  destination_city: string | null;
  branch_name: string | null;
  agent_name: string | null;
  sender_name: string | null;
  receiver_name: string | null;
};

type DashboardOverview = {
  scope: { isAgentScope: boolean };
  shipments: {
    total_shipments: number;
    today_shipments: number;
    month_shipments: number;
    open_collection_shipments: number;
    unposted_shipments: number;
  };
  statuses: StatusRow[];
  finance: CurrencyRow[];
  cod: CurrencyRow[];
  recentShipments: RecentShipment[];
  topAgents: Array<{ id: string; name: string; shipment_count: number; open_collection_count: number }>;
  operations: { branches_count: number; agents_count: number };
  generatedAt: string;
};

function n(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  REGISTERED:             { label: 'مسجلة',           cls: 'status-chip gray' },
  CONFIRMED:              { label: 'مؤكدة',           cls: 'status-chip blue' },
  READY_FOR_PICKUP:       { label: 'جاهزة للاستلام',  cls: 'status-chip cyan' },
  HANDED_TO_DRIVER:       { label: 'مع السائق',       cls: 'status-chip indigo' },
  HANDED_TO_AGENT:        { label: 'بعهدة الوكيل',   cls: 'status-chip indigo' },
  AGENT_RECEIVED:         { label: 'استلمها الوكيل',  cls: 'status-chip indigo' },
  IN_TRANSIT:             { label: 'في الطريق',       cls: 'status-chip indigo' },
  ARRIVED_AT_DESTINATION: { label: 'وصلت للوجهة',    cls: 'status-chip teal' },
  OUT_FOR_DELIVERY:       { label: 'خارجة للتسليم',   cls: 'status-chip teal' },
  DELIVERED:              { label: 'مُسلَّمة',         cls: 'status-chip green' },
  RETURN_REQUESTED:       { label: 'طلب إرجاع',       cls: 'status-chip amber' },
  RETURNED:               { label: 'مرتجعة',          cls: 'status-chip orange' },
  FINANCIALLY_CLOSED:     { label: 'مغلقة مالياً',   cls: 'status-chip slate' },
  CANCELLED:              { label: 'ملغاة',            cls: 'status-chip red' },
};

function statusChip(status: string) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'status-chip gray' };
  return <span className={meta.cls}>{meta.label}</span>;
}

function paymentChip(status: string | null) {
  if (status === 'PAID')    return <span className="status-chip green">مقبوضة</span>;
  if (status === 'PARTIAL') return <span className="status-chip amber">جزئي</span>;
  return <span className="status-chip gray">غير مقبوضة</span>;
}

function currencyVal(rows: CurrencyRow[], key: keyof CurrencyRow) {
  return rows
    .filter((r) => n(r[key]) !== 0)
    .map((r) => formatCurrency(n(r[key]), r.currency_code || 'USD'))
    .join(' / ') || formatCurrency(0, 'USD');
}

/* ─── KPI CARD ─── */
function KpiCard({
  value,
  label,
  note,
  tone,
  icon,
  href,
}: {
  value: number;
  label: string;
  note?: string;
  tone: 'blue' | 'cyan' | 'amber' | 'emerald' | 'rose';
  icon: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-card-icon">{icon}</div>
      <div className="kpi-card-body">
        <div className="kpi-card-value">{value.toLocaleString('en-US')}</div>
        <div className="kpi-card-label">{label}</div>
        {note && <div className="kpi-card-note">{note}</div>}
      </div>
    </div>
  );
  if (href) return <Link to={href} className="kpi-card-link">{inner}</Link>;
  return inner;
}

/* ─── SECTION HEADER ─── */
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="db-section-header">
      <span className="db-section-title">{title}</span>
      {action && <span className="db-section-action">{action}</span>}
    </div>
  );
}

/* ─── MINI STAT TILE ─── */
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'amber' | 'default' }) {
  return (
    <div className={`mini-stat ${tone ?? 'default'}`}>
      <span className="mini-stat-label">{label}</span>
      <span className="mini-stat-value">{value}</span>
    </div>
  );
}

/* ─── QUICK ACTION CARD ─── */
function QuickAction({ to, icon, label, sub }: { to: string; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <Link to={to} className="quick-action-card">
      <div className="quick-action-icon">{icon}</div>
      <div>
        <div className="quick-action-label">{label}</div>
        {sub && <div className="quick-action-sub">{sub}</div>}
      </div>
      <ChevronLeft size={14} className="quick-action-chevron" />
    </Link>
  );
}

/* ─── STATUS BAR ITEM ─── */
const STATUS_BAR_COLORS: Record<string, string> = {
  CONFIRMED:              '#2563eb',
  HANDED_TO_AGENT:        '#6366f1',
  AGENT_RECEIVED:         '#7c3aed',
  IN_TRANSIT:             '#0891b2',
  OUT_FOR_DELIVERY:       '#0d9488',
  DELIVERED:              '#16a34a',
  RETURNED:               '#ea580c',
  CANCELLED:              '#dc2626',
};

function StatusBarRow({ status, count, total }: { status: string; count: number; total: number }) {
  const meta = STATUS_META[status] ?? { label: status, cls: '' };
  const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
  const color = STATUS_BAR_COLORS[status] ?? '#94a3b8';
  return (
    <div className="status-bar-row">
      <div className="status-bar-label">
        <span>{meta.label}</span>
        <b>{count}</b>
      </div>
      <div className="status-bar-track">
        <div className="status-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════ DASHBOARD ═══════════════════════════════════════════════ */

export default function Dashboard() {
  const { user, hasPermission } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canViewFinance =
    hasPermission('finance.view') ||
    hasPermission('finance.read') ||
    hasPermission('finance.vouchers.read') ||
    user?.role === 'admin';

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const overview = await httpClient.get<DashboardOverview>('/dashboard/overview');
      setData(overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الشاشة الرئيسية.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDashboard(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const orderedStatuses = useMemo(() => {
    const priority = ['CONFIRMED', 'HANDED_TO_AGENT', 'AGENT_RECEIVED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    return [...(data?.statuses ?? [])].sort((a, b) => {
      const ai = priority.indexOf(a.status);
      const bi = priority.indexOf(b.status);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return b.count - a.count;
    });
  }, [data?.statuses]);

  const shipments = data?.shipments;
  const isAgentScope = data?.scope?.isAgentScope || user?.userType === 'agent';
  const totalShipments = Math.max(shipments?.total_shipments ?? 0, 1);

  if (loading) {
    return (
      <div className="db-loading">
        <div className="db-loading-spinner" />
        <span>جاري تحميل مؤشرات التشغيل…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
        <div style={{ color: '#b91c1c', fontWeight: 700, marginBottom: 6 }}>تعذر فتح الشاشة الرئيسية</div>
        <p style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>{error}</p>
        <button className="toolbar-btn primary" onClick={() => void loadDashboard()}>إعادة المحاولة</button>
      </div>
    );
  }

  /* ── net balance sign helper ── */
  const netSign = (() => {
    const net = (data?.finance ?? []).reduce((s, r) => s + n(r.net_balance), 0);
    return net > 0 ? 'green' as const : net < 0 ? 'red' as const : 'default' as const;
  })();

  return (
    <div className="db-root" dir="rtl">

      {/* ─── HEADER ─── */}
      <header className="db-header">
        <div className="db-header-title">
          <div className="db-header-eyebrow">
            <LayoutDashboard size={13} />
            <span>{isAgentScope ? 'بوابة الوكيل' : 'لوحة القيادة التنفيذية'}</span>
          </div>
          <h1 className="db-header-h1">{isAgentScope ? 'شاشة الوكيل الرئيسية' : 'الشاشة الرئيسية'}</h1>
          <p className="db-header-sub">
            مؤشرات مباشرة عن الشحن والتحصيل والوكلاء والحالة المالية
            {data?.generatedAt && (
              <span className="db-header-ts"> — آخر تحديث {new Date(data.generatedAt).toLocaleString('ar-SY')}</span>
            )}
          </p>
        </div>
        <div className="db-header-actions">
          <button className="toolbar-btn" onClick={() => void loadDashboard()}>
            <RefreshCw size={14} /> تحديث
          </button>
          <Link className="toolbar-btn" to={isAgentScope ? '/agent-portal' : '/shipment-quick-ledger'}>
            <FileText size={14} /> دفتر الشحن
          </Link>
          <Link className="toolbar-btn primary" to={isAgentScope ? '/agent-portal' : '/shipment-entry'}>
            <Package size={14} /> {isAgentScope ? 'بوابة الوكيل' : 'إدخال شحنة'}
          </Link>
        </div>
      </header>

      {/* ─── KPI STRIP ─── */}
      <section className="db-kpi-strip">
        <KpiCard
          value={shipments?.today_shipments ?? 0}
          label="شحنات اليوم"
          note="الشحنات المُدخلة اليوم"
          tone="blue"
          icon={<CalendarDays size={20} />}
          href="/shipments"
        />
        <KpiCard
          value={shipments?.month_shipments ?? 0}
          label="شحنات الشهر"
          note="إجمالي الشهر الجاري"
          tone="cyan"
          icon={<CalendarRange size={20} />}
          href="/shipments"
        />
        <KpiCard
          value={shipments?.open_collection_shipments ?? 0}
          label="بانتظار التحصيل"
          note="لم تُستوفَ بعد"
          tone="amber"
          icon={<WalletCards size={20} />}
        />
        <KpiCard
          value={data?.operations.agents_count ?? 0}
          label={isAgentScope ? 'رصيد الوكيل' : 'الوكلاء النشطون'}
          note={isAgentScope ? 'نطاق حسابك' : 'إجمالي الوكلاء'}
          tone="emerald"
          icon={<Users size={20} />}
          href={isAgentScope ? undefined : '/agents'}
        />
        <KpiCard
          value={shipments?.unposted_shipments ?? 0}
          label="غير مرحلة مالياً"
          note={shipments?.unposted_shipments ? 'تحتاج مراجعة' : 'لا توجد تنبيهات'}
          tone="rose"
          icon={<AlertTriangle size={20} />}
        />
      </section>

      {/* ─── SECTION 1: OPERATIONAL SNAPSHOT ─── */}
      <section className="db-grid-2-1">

        {/* RECENT SHIPMENTS */}
        <div className="db-card db-card-table">
          <SectionHeader
            title="آخر الشحنات"
            action={<Link to={isAgentScope ? '/agent-portal' : '/shipments'}>عرض الكل <ChevronLeft size={12} /></Link>}
          />
          <div className="db-table-scroll">
            <table className="db-table">
              <thead>
                <tr>
                  <th>رقم الشحنة</th>
                  <th>التاريخ</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>الوجهة</th>
                  {!isAgentScope && <th>الوكيل</th>}
                  <th>الحالة</th>
                  <th>التحصيل</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentShipments ?? []).map((row) => (
                  <tr key={row.id}>
                    <td><span className="db-shipment-no">{row.shipment_no}</span></td>
                    <td className="db-cell-muted">{new Date(row.created_at).toLocaleDateString('ar-SY')}</td>
                    <td>{row.sender_name || '—'}</td>
                    <td>{row.receiver_name || '—'}</td>
                    <td className="db-cell-muted">{row.destination_city || '—'}</td>
                    {!isAgentScope && <td>{row.agent_name || '—'}</td>}
                    <td>{statusChip(row.status)}</td>
                    <td>{paymentChip(row.payment_status)}</td>
                  </tr>
                ))}
                {(data?.recentShipments ?? []).length === 0 && (
                  <tr><td colSpan={8} className="db-empty-row">لا توجد شحنات ضمن النطاق الحالي</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="db-side-col">

          {/* SHIPMENT STATUS CHART */}
          <div className="db-card">
            <SectionHeader title="حالات الشحن" />
            <div className="db-status-list">
              {orderedStatuses.slice(0, 8).map((row) => (
                <StatusBarRow key={row.status} status={row.status} count={row.count} total={totalShipments} />
              ))}
              {orderedStatuses.length === 0 && (
                <div className="db-empty-msg">لا توجد حالات شحن بعد</div>
              )}
            </div>
          </div>

          {/* TOP AGENTS */}
          {!isAgentScope && (
            <div className="db-card">
              <SectionHeader
                title="الوكلاء الأكثر حركة"
                action={<Link to="/agents">الكل</Link>}
              />
              <div className="db-agents-list">
                {(data?.topAgents ?? []).map((agent, i) => (
                  <div key={agent.id} className="db-agent-row">
                    <span className="db-agent-rank">{i + 1}</span>
                    <div className="db-agent-info">
                      <strong>{agent.name}</strong>
                      <span>بانتظار التحصيل: {agent.open_collection_count}</span>
                    </div>
                    <div className="db-agent-count">{agent.shipment_count}</div>
                  </div>
                ))}
                {(data?.topAgents ?? []).length === 0 && (
                  <div className="db-empty-msg">لا توجد بيانات وكلاء بعد</div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── SECTION 2: FINANCIAL SNAPSHOT ─── */}
      <section className="db-grid-2-1">

        {/* COD */}
        <div className="db-card">
          <SectionHeader
            title="مبالغ عند التسليم"
            action={canViewFinance ? <Link to="/finance/agent-cod-statement">فتح الكشف التفصيلي</Link> : undefined}
          />
          <div className="db-mini-stats">
            <MiniStat label="إجمالي المطلوب" value={currencyVal(data?.cod ?? [], 'total_due')} />
            <MiniStat label="المقبوض فعلياً" value={currencyVal(data?.cod ?? [], 'collected')} tone="green" />
            <MiniStat label="المتبقي للتحصيل" value={currencyVal(data?.cod ?? [], 'remaining')} tone="red" />
          </div>
        </div>

        {/* DEBIT/CREDIT */}
        {canViewFinance ? (
          <div className="db-card">
            <SectionHeader
              title="الذمم المالية"
              action={<Link to="/finance/debit-credit">فتح مركز الدائن والمدين</Link>}
            />
            <div className="db-mini-stats db-mini-stats-3">
              <MiniStat label="إجمالي المدين" value={currencyVal(data?.finance ?? [], 'total_debit')} tone="red" />
              <MiniStat label="إجمالي الدائن" value={currencyVal(data?.finance ?? [], 'total_credit')} tone="green" />
              <MiniStat label="صافي الرصيد" value={currencyVal(data?.finance ?? [], 'net_balance')} tone={netSign} />
            </div>
          </div>
        ) : (
          <div className="db-card db-card-restricted">
            <div className="db-restricted-icon"><CreditCard size={22} /></div>
            <div className="db-restricted-msg">الذمم المالية — غير متاحة لصلاحياتك الحالية</div>
          </div>
        )}
      </section>

      {/* ─── SECTION 3: QUICK OPERATIONAL ACTIONS ─── */}
      <section className="db-card">
        <SectionHeader title="الروابط التشغيلية السريعة" />
        <div className="db-quick-actions">
          <QuickAction to="/shipments" icon={<Package size={18} />} label="الشحنات" sub="عرض وإدارة كل الشحنات" />
          <QuickAction to="/delivery" icon={<Truck size={18} />} label="التسليم" sub="متابعة حركات التسليم" />
          {!isAgentScope && <QuickAction to="/agents" icon={<Users size={18} />} label="الوكلاء" sub="إدارة الوكلاء والمحافظات" />}
          {!isAgentScope && <QuickAction to="/customers" icon={<Box size={18} />} label="العملاء" sub="العملاء الدائمون والحسابيون" />}
          {!isAgentScope && <QuickAction to="/branches" icon={<Building2 size={18} />} label="الفروع" sub="إدارة الفروع والمناطق" />}
          {canViewFinance && <QuickAction to="/finance/cashboxes" icon={<Wallet size={18} />} label="الصناديق" sub="مراقبة الأرصدة والحركات" />}
          {canViewFinance && <QuickAction to="/finance/debit-credit" icon={<ArrowLeftRight size={18} />} label="الدائن والمدين" sub="مركز المراجعة المالية" />}
          {canViewFinance && <QuickAction to="/finance/account-statement" icon={<FileText size={18} />} label="كشف الحساب" sub="كشوف حساب الأطراف" />}
          {!isAgentScope && <QuickAction to="/reports" icon={<BarChart3 size={18} />} label="التقارير" sub="تحليلات وإحصاءات" />}
        </div>
      </section>
    </div>
  );
}
