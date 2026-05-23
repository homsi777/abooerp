import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { phase3FinanceGateway, type AgentCodRow, type AgentCodSummary } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { useAuth } from '../../context/AuthProvider';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, currency = ''): string {
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s} ${currency}` : s;
}

function shipmentStatusLabel(s: string): string {
  const map: Record<string, string> = {
    REGISTERED: 'مسجلة', CONFIRMED: 'مؤكدة', READY_FOR_PICKUP: 'جاهزة',
    HANDED_TO_DRIVER: 'بيد السائق', HANDED_TO_AGENT: 'بيد الوكيل',
    AGENT_RECEIVED: 'استلمها الوكيل', IN_TRANSIT: 'في الطريق',
    ARRIVED_AT_DESTINATION: 'وصلت', OUT_FOR_DELIVERY: 'خارجة للتسليم',
    DELIVERED: 'مسلمة', RETURN_REQUESTED: 'طلب إرجاع', RETURNED: 'مُرجعة',
    FINANCIALLY_CLOSED: 'مغلقة مالياً', CANCELLED: 'ملغاة',
  };
  return map[s] ?? s;
}

function paymentStatusLabel(s: string | null | undefined): string {
  if (s === 'PAID') return 'مقبوضة';
  if (s === 'PARTIAL') return 'جزئي';
  if (s === 'UNPAID' || !s) return 'غير مقبوضة';
  return s;
}

function paymentStatusClass(s: string | null | undefined): string {
  if (s === 'PAID') return 'text-green-700';
  if (s === 'PARTIAL') return 'text-amber-700';
  return 'text-red-700';
}

// ── types ─────────────────────────────────────────────────────────────────────
type Filters = {
  agentId: string;
  branchId: string;
  dateFrom: string;
  dateTo: string;
  shipmentStatus: string;
  collectionStatus: string;
  currencyCode: string;
  senderName: string;
  receiverName: string;
  shipmentNo: string;
  search: string;
};

const DEFAULT_FILTERS: Filters = {
  agentId: '', branchId: '', dateFrom: '', dateTo: '',
  shipmentStatus: '', collectionStatus: '', currencyCode: '',
  senderName: '', receiverName: '', shipmentNo: '', search: '',
};

const COLLECTION_STATUSES = [
  { value: '', label: 'كل الحالات' },
  { value: 'UNPAID', label: 'غير محصل' },
  { value: 'PARTIAL', label: 'محصل جزئياً' },
  { value: 'PAID', label: 'محصل بالكامل' },
];

const SHIPMENT_STATUSES = [
  { value: '', label: 'كل الحالات' },
  { value: 'CONFIRMED', label: 'مؤكدة' },
  { value: 'AGENT_RECEIVED', label: 'استلمها الوكيل' },
  { value: 'OUT_FOR_DELIVERY', label: 'خارجة للتسليم' },
  { value: 'DELIVERED', label: 'مسلمة' },
  { value: 'IN_TRANSIT', label: 'في الطريق' },
  { value: 'CANCELLED', label: 'ملغاة' },
];

// ── component ─────────────────────────────────────────────────────────────────
export default function AgentCodStatement() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const isAgentUser = user?.userType === 'agent';
  const initialFilters = useMemo<Filters>(() => ({
    ...DEFAULT_FILTERS,
    agentId: searchParams.get('agentId') || '',
    branchId: searchParams.get('branchId') || '',
    currencyCode: searchParams.get('currencyCode') || '',
    shipmentNo: searchParams.get('shipmentNo') || '',
  }), [searchParams]);

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [rows, setRows] = useState<AgentCodRow[]>([]);
  const [summary, setSummary] = useState<AgentCodSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  // Load reference data for admin filters
  useEffect(() => {
    if (!isAgentUser) {
      Promise.all([
        phase15Gateway.branches.getAll().catch(() => []),
      ]).then(([branchRows]) => {
        setBranches(branchRows.map((b) => ({ id: String(b.id), name: b.name })));
      });
    }
  }, [isAgentUser]);

  const load = useCallback(async (f: Filters, pg = 1) => {
    setLoading(true);
    setError('');
    try {
      // Convert synthetic branch/agent ids if needed
      const result = await phase3FinanceGateway.agentCodStatement.getStatement({
        agentId: f.agentId || undefined,
        branchId: f.branchId || undefined,
        dateFrom: f.dateFrom ? `${f.dateFrom}T00:00:00.000Z` : undefined,
        dateTo: f.dateTo ? `${f.dateTo}T23:59:59.999Z` : undefined,
        shipmentStatus: f.shipmentStatus || undefined,
        collectionStatus: f.collectionStatus || undefined,
        currencyCode: f.currencyCode || undefined,
        senderName: f.senderName || undefined,
        receiverName: f.receiverName || undefined,
        shipmentNo: f.shipmentNo || undefined,
        search: f.search || undefined,
        page: pg,
        pageSize: 200,
      });
      setRows(result.rows);
      setSummary(result.summary);
      setTotal(result.total);
      setPage(result.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل كشف مبالغ التسليم.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialFilters, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = () => {
    setApplied(filters);
    void load(filters, 1);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    void load(DEFAULT_FILTERS, 1);
  };

  const fetchAllForExport = async (f: Filters): Promise<{ rows: AgentCodRow[]; summary: AgentCodSummary[]; total: number }> => {
    const all: AgentCodRow[] = [];
    let pg = 1;
    let firstSummary: AgentCodSummary[] = [];
    let expectedTotal = 0;
    const pageSize = 200;

    for (;;) {
      const result = await phase3FinanceGateway.agentCodStatement.getStatement({
        agentId: f.agentId || undefined,
        branchId: f.branchId || undefined,
        dateFrom: f.dateFrom ? `${f.dateFrom}T00:00:00.000Z` : undefined,
        dateTo: f.dateTo ? `${f.dateTo}T23:59:59.999Z` : undefined,
        shipmentStatus: f.shipmentStatus || undefined,
        collectionStatus: f.collectionStatus || undefined,
        currencyCode: f.currencyCode || undefined,
        senderName: f.senderName || undefined,
        receiverName: f.receiverName || undefined,
        shipmentNo: f.shipmentNo || undefined,
        search: f.search || undefined,
        page: pg,
        pageSize,
      });
      if (pg === 1) {
        firstSummary = result.summary;
        expectedTotal = result.total;
      }
      all.push(...result.rows);
      if (result.rows.length === 0) break;
      if (expectedTotal > 0 && all.length >= expectedTotal) break;
      if (result.rows.length < pageSize) break;
      pg += 1;
    }

    return { rows: all, summary: firstSummary, total: expectedTotal || all.length };
  };

  const exportCsv = async () => {
    setLoading(true);
    setError('');
    try {
      const { rows: allRows } = await fetchAllForExport(applied);
      downloadCsv(
        `كشف-مبالغ-التسليم-${new Date().toISOString().split('T')[0]}.csv`,
        [
          '#', 'التاريخ', 'رقم الشحنة',
          ...(isAgentUser ? [] : ['الوكيل']),
          'الفرع', 'المرسل', 'المستلم', 'الوجهة',
          'حالة الشحنة', 'حالة التحصيل', 'العملة',
          'أجور الشحن', 'تحصيل لصالح المرسل', 'مستحقات إضافية',
          'دفع مسبق', 'نوع دفع الأجور', 'عمولة الوكيل', 'مدين للشركة', 'دائن على الشركة', 'أجرة الحوالة',
          'إجمالي المطلوب', 'المقبوض فعلياً', 'المتبقي للتحصيل',
          'المسدد للمرسل', 'المتبقي للمرسل',
          'صندوق التحصيل', 'آخر سند قبض', 'ملاحظات',
        ],
        allRows.map((r, i) => [
          i + 1,
          new Date(r.shipmentDate).toLocaleDateString('ar-SY'),
          r.shipmentNo,
          ...(isAgentUser ? [] : [r.agentName]),
          r.branchName,
          r.senderName,
          r.receiverName,
          r.destination,
          shipmentStatusLabel(r.shipmentStatus),
          paymentStatusLabel(r.paymentStatus),
          r.currencyCode,
          r.shippingFeeAmount,
          r.senderCollectionAmount,
          r.loadingDuesAmount,
          r.prepaidAmount,
          r.freightPaymentType === 'PREPAID' ? 'دفع مسبق' : 'تحصيل',
          r.agentCommissionAmount,
          r.agentOwesCompany,
          r.companyOwesAgent,
          r.transferServiceFee,
          r.totalDueOnDelivery,
          r.collectedAmount,
          r.remainingToCollect,
          r.paidToSenderAmount,
          r.remainingToSender,
          r.collectionCashboxName !== '—' ? r.collectionCashboxName : '',
          r.lastReceiptVoucherNo !== '—' ? r.lastReceiptVoucherNo : '',
          r.notes,
        ]),
      );
      showToast('تم تنزيل الملف', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تصدير CSV', 'error');
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    setLoading(true);
    setError('');
    try {
      const { rows: allRows, total: totalRows } = await fetchAllForExport(applied);
      const subtitleParts: string[] = [];
      if (applied.agentId) subtitleParts.push(`الوكيل: ${applied.agentId.slice(0, 8)}`);
      if (applied.branchId) subtitleParts.push(`الفرع: ${applied.branchId}`);
      if (applied.dateFrom || applied.dateTo) subtitleParts.push(`من ${applied.dateFrom || '—'} إلى ${applied.dateTo || '—'}`);
      if (applied.currencyCode) subtitleParts.push(`العملة: ${applied.currencyCode}`);
      subtitleParts.push(`عدد الشحنات: ${totalRows}`);

      const result = await exportPdfTable({
        title: 'كشف مبالغ عند التسليم لدى الوكيل',
        subtitle: subtitleParts.join(' | '),
        defaultFileName: `كشف-مبالغ-التسليم-${new Date().toISOString().split('T')[0]}.pdf`,
        headers: [
          '#', 'التاريخ', 'رقم الشحنة',
          ...(isAgentUser ? [] : ['الوكيل']),
          'الفرع', 'المرسل', 'المستلم', 'الوجهة',
          'حالة الشحنة', 'حالة التحصيل', 'العملة',
          'أجور الشحن', 'تحصيل المرسل', 'مستحقات إضافية', 'دفع مسبق', 'نوع دفع الأجور',
          'عمولة الوكيل', 'مدين للشركة', 'دائن على الشركة', 'أجرة الحوالة',
          'إجمالي المطلوب', 'المقبوض', 'المتبقي',
          'صندوق التحصيل', 'آخر سند قبض', 'ملاحظات',
        ],
        rows: allRows.map((r, i) => [
          i + 1,
          new Date(r.shipmentDate).toLocaleDateString('ar-SY'),
          r.shipmentNo,
          ...(isAgentUser ? [] : [r.agentName]),
          r.branchName,
          r.senderName,
          r.receiverName,
          r.destination,
          shipmentStatusLabel(r.shipmentStatus),
          paymentStatusLabel(r.paymentStatus),
          r.currencyCode,
          r.shippingFeeAmount,
          r.senderCollectionAmount,
          r.loadingDuesAmount,
          r.prepaidAmount,
          r.freightPaymentType === 'PREPAID' ? 'دفع مسبق' : 'تحصيل',
          r.agentCommissionAmount,
          r.agentOwesCompany,
          r.companyOwesAgent,
          r.transferServiceFee,
          r.totalDueOnDelivery,
          r.collectedAmount,
          r.remainingToCollect,
          r.collectionCashboxName !== '—' ? r.collectionCashboxName : '',
          r.lastReceiptVoucherNo !== '—' ? r.lastReceiptVoucherNo : '',
          r.notes,
        ]),
      });

      if (result.saved) showToast('تم حفظ ملف PDF', 'success');
      else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تصدير PDF', 'error');
    } finally {
      setLoading(false);
    }
  };

  const pageCount = Math.ceil(total / 200);

  return (
    <div className="h-full flex flex-col" dir="rtl">
      {/* ── Header ── */}
      <div className="mb-2">
        <h2 className="text-xl font-bold">كشف مبالغ عند التسليم لدى الوكيل</h2>
        <p className="text-xs text-gray-500">تفصيل مبالغ التحصيل عند التسليم حسب الوكيل والشحنة والمرسل والمستلم</p>
        {isAgentUser && (
          <p className="text-xs text-blue-600 mt-1">يعرض هذا الكشف شحناتك الخاصة فقط.</p>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="card mb-2 p-2">
        <div className="grid grid-cols-6 gap-1.5 mb-1.5">
          {!isAgentUser && (
            <input
              className="form-input text-sm"
              placeholder="رقم شحنة..."
              value={filters.shipmentNo}
              onChange={(e) => setFilters((p) => ({ ...p, shipmentNo: e.target.value }))}
            />
          )}
          {isAgentUser && (
            <input
              className="form-input text-sm"
              placeholder="رقم شحنة..."
              value={filters.shipmentNo}
              onChange={(e) => setFilters((p) => ({ ...p, shipmentNo: e.target.value }))}
            />
          )}
          <input
            className="form-input text-sm"
            placeholder="بحث عام..."
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
          />
          <input
            className="form-input text-sm"
            placeholder="اسم المرسل..."
            value={filters.senderName}
            onChange={(e) => setFilters((p) => ({ ...p, senderName: e.target.value }))}
          />
          <input
            className="form-input text-sm"
            placeholder="اسم المستلم..."
            value={filters.receiverName}
            onChange={(e) => setFilters((p) => ({ ...p, receiverName: e.target.value }))}
          />
          <select
            className="form-select text-sm"
            value={filters.collectionStatus}
            onChange={(e) => setFilters((p) => ({ ...p, collectionStatus: e.target.value }))}
          >
            {COLLECTION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            className="form-select text-sm"
            value={filters.shipmentStatus}
            onChange={(e) => setFilters((p) => ({ ...p, shipmentStatus: e.target.value }))}
          >
            {SHIPMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-6 gap-1.5 items-center">
          <input
            type="date"
            className="form-input text-sm"
            value={filters.dateFrom}
            onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))}
          />
          <input
            type="date"
            className="form-input text-sm"
            value={filters.dateTo}
            onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))}
          />
          {!isAgentUser && (
            <select
              className="form-select text-sm"
              value={filters.branchId}
              onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}
            >
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select
            className="form-select text-sm"
            value={filters.currencyCode}
            onChange={(e) => setFilters((p) => ({ ...p, currencyCode: e.target.value }))}
          >
            <option value="">كل العملات</option>
            <option value="USD">USD</option>
            <option value="SYP">SYP</option>
            <option value="TRY">TRY</option>
          </select>
          <div className="flex gap-1 col-span-2">
            <button className="toolbar-btn primary text-sm" onClick={handleApply} disabled={loading}>
              {loading ? 'جاري...' : 'تطبيق'}
            </button>
            <button className="toolbar-btn text-sm" onClick={handleReset}>إعادة ضبط</button>
            <button className="toolbar-btn text-sm" onClick={() => void exportCsv()} disabled={loading}>تصدير Excel (CSV)</button>
            <button className="toolbar-btn text-sm" onClick={() => void exportPdf()} disabled={loading}>تصدير PDF</button>
            <button className="toolbar-btn text-sm" onClick={() => window.print()} disabled={loading}>طباعة</button>
          </div>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {summary.map((s) => (
            <div key={s.currencyCode} className="flex gap-2 flex-wrap text-xs bg-blue-50 border border-blue-200 rounded px-2 py-1">
              <span className="font-semibold text-blue-800">{s.currencyCode}</span>
              <span className="text-gray-700">الشحنات: <b>{s.shipmentCount}</b></span>
              <span className="text-gray-700">أجور الشحن: <b>{fmt(s.totalShippingFees)}</b></span>
              <span className="text-gray-700">تحصيل المرسل: <b>{fmt(s.totalSenderCollections)}</b></span>
              <span className="text-gray-700">عمولة الوكيل: <b>{fmt(s.totalAgentCommission)}</b></span>
              <span className="text-amber-700">مدين للشركة: <b>{fmt(s.totalAgentOwesCompany)}</b></span>
              <span className="text-emerald-700">دائن على الشركة: <b>{fmt(s.totalCompanyOwesAgent)}</b></span>
              <span className="text-blue-800 font-semibold">إجمالي المطلوب: <b>{fmt(s.totalDueOnDelivery)}</b></span>
              <span className="text-green-700">المقبوض: <b>{fmt(s.totalCollected)}</b></span>
              <span className="text-red-700">المتبقي: <b>{fmt(s.totalRemainingToCollect)}</b></span>
              {s.totalSenderCollections > 0 && (
                <span className="text-amber-700">متبقي للمرسل: <b>{fmt(s.totalRemainingToSenders)}</b></span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto card p-0">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 1900 }}>
          <thead className="sticky top-0 bg-gray-100 z-10">
            <tr>
              {[
                '#', 'التاريخ', 'رقم الشحنة',
                ...(isAgentUser ? [] : ['الوكيل']),
                'الفرع', 'المرسل', 'المستلم', 'الوجهة',
                'حالة الشحنة', 'العملة',
                'أجور الشحن', 'تحصيل لصالح المرسل', 'مستحقات إضافية',
                'دفع مسبق', 'نوع دفع الأجور', 'عمولة الوكيل', 'مدين للشركة', 'دائن على الشركة', 'أجرة الحوالة (ربح الشركة)',
                'إجمالي المطلوب', 'المقبوض فعلياً', 'المتبقي للتحصيل',
                'المسدد للمرسل', 'المتبقي للمرسل',
                'صندوق التحصيل', 'آخر سند قبض', 'ملاحظات',
              ].map((col) => (
                <th key={col} className="px-2 py-1.5 text-right border-b border-gray-200 font-semibold whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={99} className="text-center py-8 text-gray-500">جاري التحميل...</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={99} className="text-center py-8 text-gray-400">لا توجد بيانات</td>
              </tr>
            )}
            {!loading && rows.map((row, i) => {
              const isHighlighted = row.remainingToCollect > 0;
              return (
                <tr
                  key={row.shipmentId}
                  className={`border-b border-gray-100 hover:bg-blue-50 ${isHighlighted && row.paymentStatus !== 'PAID' ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="px-2 py-1 text-gray-500">{(page - 1) * 200 + i + 1}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{new Date(row.shipmentDate).toLocaleDateString('ar-SY')}</td>
                  <td className="px-2 py-1 font-mono font-semibold text-blue-700">{row.shipmentNo}</td>
                  {!isAgentUser && <td className="px-2 py-1">{row.agentName}</td>}
                  <td className="px-2 py-1">{row.branchName}</td>
                  <td className="px-2 py-1">{row.senderName}</td>
                  <td className="px-2 py-1">{row.receiverName}</td>
                  <td className="px-2 py-1">{row.destination}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{shipmentStatusLabel(row.shipmentStatus)}</td>
                  <td className="px-2 py-1 text-center font-mono">{row.currencyCode}</td>
                  {/* Shipping fee (company revenue) */}
                  <td className="px-2 py-1 text-left font-mono text-gray-800">{fmt(row.shippingFeeAmount)}</td>
                  {/* Sender collection amount (COD for sender) */}
                  <td className="px-2 py-1 text-left font-mono text-indigo-700 font-semibold">
                    {row.senderCollectionAmount > 0 ? fmt(row.senderCollectionAmount) : '—'}
                  </td>
                  {/* Loading/extra dues */}
                  <td className="px-2 py-1 text-left font-mono">
                    {row.loadingDuesAmount > 0 ? fmt(row.loadingDuesAmount) : '—'}
                  </td>
                  {/* Prepaid */}
                  <td className="px-2 py-1 text-left font-mono text-gray-500">
                    {row.prepaidAmount > 0 ? fmt(row.prepaidAmount) : '—'}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-center">
                    {row.freightPaymentType === 'PREPAID' ? 'دفع مسبق' : 'تحصيل'}
                  </td>
                  <td className="px-2 py-1 text-left font-mono">
                    {row.agentCommissionAmount > 0 ? fmt(row.agentCommissionAmount) : '—'}
                  </td>
                  <td className="px-2 py-1 text-left font-mono text-amber-700 font-semibold">
                    {row.agentOwesCompany > 0 ? fmt(row.agentOwesCompany) : '—'}
                  </td>
                  <td className="px-2 py-1 text-left font-mono text-emerald-700 font-semibold">
                    {row.companyOwesAgent > 0 ? fmt(row.companyOwesAgent) : '—'}
                  </td>
                  <td className="px-2 py-1 text-left font-mono">
                    {row.transferServiceFee > 0 ? fmt(row.transferServiceFee, row.transferServiceFeeCurrency) : '—'}
                  </td>
                  {/* Total due on delivery — highlighted */}
                  <td className="px-2 py-1 text-left font-mono font-bold text-blue-800">
                    {fmt(row.totalDueOnDelivery)}
                  </td>
                  {/* Collected */}
                  <td className="px-2 py-1 text-left font-mono text-green-700">
                    {row.collectedAmount > 0 ? fmt(row.collectedAmount) : '—'}
                  </td>
                  {/* Remaining to collect */}
                  <td className={`px-2 py-1 text-left font-mono font-semibold ${row.remainingToCollect > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                    {row.remainingToCollect > 0 ? fmt(row.remainingToCollect) : '—'}
                  </td>
                  {/* Paid to sender */}
                  <td className="px-2 py-1 text-left font-mono text-gray-500">
                    {row.paidToSenderAmount > 0 ? fmt(row.paidToSenderAmount) : '—'}
                  </td>
                  {/* Remaining to sender */}
                  <td className={`px-2 py-1 text-left font-mono ${row.remainingToSender > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                    {row.remainingToSender > 0 ? fmt(row.remainingToSender) : '—'}
                  </td>
                  <td className="px-2 py-1 text-gray-500">{row.collectionCashboxName !== '—' ? row.collectionCashboxName : ''}</td>
                  <td className="px-2 py-1 font-mono text-gray-600">{row.lastReceiptVoucherNo !== '—' ? row.lastReceiptVoucherNo : ''}</td>
                  <td className="px-2 py-1 text-gray-500 max-w-32 truncate" title={row.notes}>{row.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {pageCount > 1 && (
        <div className="flex items-center gap-2 mt-2 text-sm">
          <button className="toolbar-btn" onClick={() => void load(applied, page - 1)} disabled={page <= 1}>السابق</button>
          <span className="text-gray-600">صفحة {page} من {pageCount} ({total} شحنة)</span>
          <button className="toolbar-btn" onClick={() => void load(applied, page + 1)} disabled={page >= pageCount}>التالي</button>
        </div>
      )}
      {pageCount <= 1 && total > 0 && (
        <div className="mt-1 text-xs text-gray-400">إجمالي: {total} شحنة</div>
      )}

      {/* ── Limitation notice ── */}
      <div className="mt-2 text-xs text-gray-400 border-t pt-2">
        ملاحظة: حقل "المسدد للمرسل" يعرض صفراً حالياً — ميزة تسوية المرسلين لم تُنفَّذ بعد.
        قيمة "المتبقي للمرسل" تساوي إجمالي تحصيل المرسل حتى يتم تسجيل المدفوع.
      </div>
    </div>
  );
}
