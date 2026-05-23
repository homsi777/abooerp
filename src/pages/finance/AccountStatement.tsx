import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type StatementRow = {
  id: string;
  date: string;
  partyType: string;
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

export default function AccountStatement() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<StatementRow[]>([]);
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
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, branchRows] = await Promise.all([
        phase3FinanceGateway.accountStatement.getDetailed({
          partyType: (filters.partyType as any) || undefined,
          partyId: filters.partyId || undefined,
          branchId: filters.branchId
            ? (filters.branchId.includes('-') ? filters.branchId : getBackendIdFromSynthetic(Number(filters.branchId)) || undefined)
            : undefined,
          currencyCode: filters.currencyCode || undefined,
          dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
          dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
          referenceType: (filters.referenceType as any) || undefined,
          search: filters.search || undefined,
          pageSize: 1000,
        }),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setRows(result.rows as StatementRow[]);
      setBranches(branchRows.map((b) => ({ id: b.id, name: b.name })));
    } catch {
      setError('تعذر تحميل كشف الحساب. يرجى المحاولة مرة أخرى.');
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
      `account-statement-${new Date().toISOString().split('T')[0]}.csv`,
      ['#', 'التاريخ', 'نوع الطرف', 'اسم الطرف', 'نوع المرجع', 'رقم المرجع', 'رقم الشحنة', 'البيان', 'مدين', 'دائن', 'الرصيد الجاري', 'العملة', 'طريقة الدفع', 'الفرع', 'المستخدم', 'ملاحظات'],
      rows.map((r, i) => [
        i + 1,
        new Date(r.date).toLocaleString('ar-SY'),
        r.partyType,
        r.partyName,
        r.referenceType,
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

  const exportPdf = async () => {
    const subtitleParts: string[] = [];
    if (filters.partyType) subtitleParts.push(`نوع الطرف: ${filters.partyType}`);
    if (filters.partyId) subtitleParts.push(`معرف: ${filters.partyId}`);
    if (filters.branchId) subtitleParts.push(`الفرع: ${branches.find((b) => String(b.id) === filters.branchId)?.name ?? filters.branchId}`);
    if (filters.currencyCode) subtitleParts.push(`العملة: ${filters.currencyCode}`);
    if (filters.dateFrom || filters.dateTo) subtitleParts.push(`من ${filters.dateFrom || '—'} إلى ${filters.dateTo || '—'}`);
    if (filters.referenceType) subtitleParts.push(`المرجع: ${filters.referenceType}`);
    if (filters.search.trim()) subtitleParts.push(`بحث: ${filters.search.trim()}`);
    const subtitle = subtitleParts.length ? subtitleParts.join(' | ') : undefined;

    const result = await exportPdfTable({
      title: 'كشف حساب تفصيلي',
      subtitle,
      defaultFileName: `account-statement-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['#', 'التاريخ', 'نوع الطرف', 'اسم الطرف', 'نوع المرجع', 'رقم المرجع', 'رقم الشحنة', 'البيان', 'مدين', 'دائن', 'الرصيد الجاري', 'العملة', 'طريقة الدفع', 'الفرع', 'المستخدم', 'ملاحظات'],
      rows: rows.map((r, i) => [
        i + 1,
        new Date(r.date).toLocaleString('ar-SY'),
        r.partyType,
        r.partyName,
        r.referenceType,
        r.referenceNo || '-',
        r.shipmentNo || '-',
        r.description || '-',
        r.debit,
        r.credit,
        r.runningBalance,
        r.currencyCode,
        r.paymentMethod || '-',
        r.branchName || '-',
        r.username || '-',
        r.notes || '-',
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3">
        <h2 className="text-xl font-bold">كشف حساب تفصيلي</h2>
        <p className="text-sm text-gray-600">عرض تفصيلي للحركات المدينة والدائنة مع الرصيد الجاري</p>
      </div>

      <div className="card mb-3 p-2">
        <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
          <select className="form-select" value={filters.partyType} onChange={(e) => setFilters((p) => ({ ...p, partyType: e.target.value }))}>
            <option value="">نوع الطرف</option><option value="customer">عميل</option><option value="sender_receiver">مرسل/مستلم</option><option value="agent">وكيل</option>
          </select>
          <input className="form-input" placeholder="معرف الطرف" value={filters.partyId} onChange={(e) => setFilters((p) => ({ ...p, partyId: e.target.value }))} />
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
          <button className="toolbar-btn" onClick={() => setFilters({ partyType: '', partyId: '', branchId: '', currencyCode: '', dateFrom: '', dateTo: '', referenceType: '', search: '' })}>إعادة ضبط</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>تصدير Excel (CSV)</button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>تصدير PDF</button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>طباعة</button>
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        {error && <div className="mb-2 text-sm text-red-700">{error}</div>}
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th><th>التاريخ</th><th>نوع الطرف</th><th>اسم الطرف</th><th>نوع المرجع</th><th>رقم المرجع</th><th>رقم الشحنة</th><th>البيان</th>
              <th className="text-left">مدين</th><th className="text-left">دائن</th><th className="text-left">الرصيد الجاري</th><th>العملة</th><th>طريقة الدفع</th><th>الفرع</th><th>المستخدم</th><th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td>{idx + 1}</td><td>{new Date(row.date).toLocaleString('ar-SY')}</td><td>{row.partyType}</td><td>{row.partyName}</td><td>{row.referenceType}</td><td>{row.referenceNo || '-'}</td>
                <td>{row.shipmentNo || '-'}</td><td>{row.description || '-'}</td><td className="text-left">{row.debit.toLocaleString()}</td><td className="text-left">{row.credit.toLocaleString()}</td>
                <td className="text-left">{row.runningBalance.toLocaleString()}</td><td>{row.currencyCode}</td><td>{row.paymentMethod || '-'}</td><td>{row.branchName || '-'}</td><td>{row.username || '-'}</td><td>{row.notes || '-'}</td>
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
