import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import FinancialStatementPrintButtons from '../../components/finance/FinancialStatementPrintButtons';
import { buildDetailedAccountStatementPrintHtml } from '../../lib/export/financialStatementPrint';

type JournalRow = {
  id: string;
  date: string;
  partyType: string;
  partyId: string;
  partyName: string;
  referenceType: string;
  referenceNo: string;
  shipmentNo: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  currencyCode: string;
  paymentMethod: string;
  branchName: string;
  username: string;
  notes: string;
};

const PARTY_TYPE_LABEL: Record<string, string> = {
  agent: 'وكيل',
  customer: 'عميل',
  sender_receiver: 'مرسل/مستلم',
};

const REFERENCE_TYPE_LABEL: Record<string, string> = {
  shipment: 'شحنة',
  receipt: 'سند قبض',
  payment: 'سند دفع',
  expense: 'مصروف',
  settlement: 'تسوية',
};

export default function FinanceDailyJournal() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [filters, setFilters] = useState({
    partyType: searchParams.get('partyType') || '',
    partyId: searchParams.get('partyId') || '',
    branchId: searchParams.get('branchId') || '',
    currencyCode: searchParams.get('currencyCode') || '',
    dateFrom: '',
    dateTo: '',
    referenceType: '',
    search: '',
    includeOperationalParties: false,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, branchRows] = await Promise.all([
        phase3FinanceGateway.accountStatement.getDetailed({
          partyType: (filters.partyType as 'customer' | 'sender_receiver' | 'agent') || undefined,
          partyId: filters.partyId || undefined,
          branchId: filters.branchId
            ? (filters.branchId.includes('-') ? filters.branchId : getBackendIdFromSynthetic(Number(filters.branchId)) || undefined)
            : undefined,
          currencyCode: filters.currencyCode || undefined,
          dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
          dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
          referenceType: (filters.referenceType as 'shipment' | 'receipt' | 'payment' | 'expense' | 'settlement') || undefined,
          search: filters.search || undefined,
          pageSize: 1000,
          includeOperationalParties: filters.includeOperationalParties || undefined,
        }),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setRows(result.rows as JournalRow[]);
      setBranches(branchRows.map((b) => ({ id: b.id, name: b.name })));
    } catch {
      setError('تعذر تحميل دفتر اليومية. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
    const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
    const finalBalance = rows.length ? rows[rows.length - 1].runningBalance : 0;
    return { totalDebit, totalCredit, finalBalance };
  }, [rows]);

  const exportCsv = () => {
    downloadCsv(
      `daily-journal-${new Date().toISOString().split('T')[0]}.csv`,
      ['#', 'التاريخ', 'نوع الحساب', 'اسم الحساب', 'نوع المرجع', 'رقم المرجع', 'رقم الشحنة', 'البيان', 'مدين', 'دائن', 'الرصيد الجاري', 'العملة', 'طريقة الدفع', 'الفرع', 'المستخدم', 'ملاحظات'],
      rows.map((r, i) => [
        i + 1,
        new Date(r.date).toLocaleString('ar-SY'),
        PARTY_TYPE_LABEL[r.partyType] ?? r.partyType,
        r.partyName,
        REFERENCE_TYPE_LABEL[r.referenceType] ?? r.referenceType,
        r.referenceNo,
        r.shipmentNo,
        r.description,
        r.debit,
        r.credit,
        r.runningBalance,
        r.currencyCode,
        r.paymentMethod,
        r.branchName,
        r.username,
        r.notes,
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const buildSubtitle = () => {
    const subtitleParts: string[] = [];
    if (filters.partyType) subtitleParts.push(`نوع الحساب: ${PARTY_TYPE_LABEL[filters.partyType] ?? filters.partyType}`);
    if (filters.partyId) subtitleParts.push(`معرف: ${filters.partyId}`);
    if (filters.branchId) subtitleParts.push(`الفرع: ${branches.find((b) => String(b.id) === filters.branchId)?.name ?? filters.branchId}`);
    if (filters.currencyCode) subtitleParts.push(`العملة: ${filters.currencyCode}`);
    if (filters.dateFrom || filters.dateTo) subtitleParts.push(`من ${filters.dateFrom || '—'} إلى ${filters.dateTo || '—'}`);
    if (filters.referenceType) subtitleParts.push(`المرجع: ${REFERENCE_TYPE_LABEL[filters.referenceType] ?? filters.referenceType}`);
    if (filters.search.trim()) subtitleParts.push(`بحث: ${filters.search.trim()}`);
    return subtitleParts.length ? subtitleParts.join(' | ') : undefined;
  };

  const buildPrintHtml = () =>
    buildDetailedAccountStatementPrintHtml({
      title: 'دفتر اليومية',
      subtitle: buildSubtitle(),
      rows,
      totals,
    });

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3">
        <h2 className="text-xl font-bold">دفتر اليومية</h2>
        <p className="text-sm text-gray-600">
          سجل زمني لكل الحركات المالية الموثقة (شحنات، سندات، عمولات) — يُبنى مباشرة من سجل الحركات المالية في السيرفر دون بيانات تجريبية.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3 max-w-3xl">
        <div className="stat-card"><div className="stat-value">{totals.totalDebit.toLocaleString()}</div><div className="stat-label">إجمالي المدين</div></div>
        <div className="stat-card"><div className="stat-value">{totals.totalCredit.toLocaleString()}</div><div className="stat-label">إجمالي الدائن</div></div>
        <div className="stat-card"><div className="stat-value">{totals.finalBalance.toLocaleString()}</div><div className="stat-label">الرصيد الجاري (آخر سطر)</div></div>
      </div>

      <div className="card mb-3 p-2">
        <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
          <select className="form-select" value={filters.partyType} onChange={(e) => setFilters((p) => ({ ...p, partyType: e.target.value }))}>
            <option value="">نوع الحساب</option><option value="customer">عميل</option><option value="sender_receiver">مرسل/مستلم</option><option value="agent">وكيل</option>
          </select>
          <input className="form-input" placeholder="معرف الحساب" value={filters.partyId} onChange={(e) => setFilters((p) => ({ ...p, partyId: e.target.value }))} />
          <select className="form-select" value={filters.branchId} onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}>
            <option value="">الفرع</option>{branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
          <select className="form-select" value={filters.currencyCode} onChange={(e) => setFilters((p) => ({ ...p, currencyCode: e.target.value }))}>
            <option value="">العملة</option><option value="USD">USD</option><option value="SYP">SYP</option><option value="TRY">TRY</option>
          </select>
          <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
          <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
          <select className="form-select" value={filters.referenceType} onChange={(e) => setFilters((p) => ({ ...p, referenceType: e.target.value }))}>
            <option value="">نوع المرجع</option><option value="shipment">شحنة</option><option value="receipt">سند قبض</option><option value="payment">سند دفع</option><option value="expense">مصروف</option><option value="settlement">تسوية</option>
          </select>
          <input className="form-input" placeholder="بحث في البيان أو رقم المرجع" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
          <button className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
          <button className="toolbar-btn" onClick={() => setFilters({ partyType: '', partyId: '', branchId: '', currencyCode: '', dateFrom: '', dateTo: '', referenceType: '', search: '', includeOperationalParties: false })}>إعادة ضبط</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>تصدير Excel (CSV)</button>
          <FinancialStatementPrintButtons
            disabled={loading || rows.length === 0}
            documentType="account_statement"
            pdfTitle="دفتر اليومية"
            pdfFileName={`daily-journal-${new Date().toISOString().split('T')[0]}.pdf`}
            onBuildHtml={buildPrintHtml}
            className="flex gap-2"
          />
          <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer col-span-2">
            <input
              type="checkbox"
              checked={filters.includeOperationalParties}
              onChange={(e) => setFilters((p) => ({ ...p, includeOperationalParties: e.target.checked }))}
            />
            إظهار الأطراف التشغيلية (بيانات قديمة)
          </label>
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        {error && <div className="mb-2 text-sm text-red-700">{error}</div>}
        {loading && <p className="p-4 text-gray-500">جاري تحميل الحركات...</p>}
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th><th>التاريخ</th><th>نوع الحساب</th><th>اسم الحساب</th><th>نوع المرجع</th><th>رقم المرجع</th><th>رقم الشحنة</th><th>البيان</th>
              <th className="text-left">مدين</th><th className="text-left">دائن</th><th className="text-left">الرصيد الجاري</th><th>العملة</th><th>طريقة الدفع</th><th>الفرع</th><th>المستخدم</th><th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td>{idx + 1}</td>
                <td>{new Date(row.date).toLocaleString('ar-SY')}</td>
                <td>{PARTY_TYPE_LABEL[row.partyType] ?? row.partyType}</td>
                <td>{row.partyName}</td>
                <td>{REFERENCE_TYPE_LABEL[row.referenceType] ?? row.referenceType}</td>
                <td>{row.referenceNo || '-'}</td>
                <td>{row.shipmentNo || '-'}</td>
                <td>{row.description || '-'}</td>
                <td className="text-left">{row.debit.toLocaleString()}</td>
                <td className="text-left">{row.credit.toLocaleString()}</td>
                <td className="text-left">{row.runningBalance.toLocaleString()}</td>
                <td>{row.currencyCode}</td>
                <td>{row.paymentMethod || '-'}</td>
                <td>{row.branchName || '-'}</td>
                <td>{row.username || '-'}</td>
                <td>{row.notes || '-'}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={16} className="text-center p-6 text-gray-500">لا توجد حركات مالية مطابقة للفلاتر الحالية.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8}>الإجماليات</td>
              <td className="text-left">{totals.totalDebit.toLocaleString()}</td>
              <td className="text-left">{totals.totalCredit.toLocaleString()}</td>
              <td className="text-left">{totals.finalBalance.toLocaleString()}</td>
              <td colSpan={5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
