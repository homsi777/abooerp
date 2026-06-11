import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import FinanceCurrencySelect from '../../components/finance/FinanceCurrencySelect';
import {
  financeBalanceDirectionLabel,
  financeCurrencyLabel,
  financePartyTypeLabel,
} from '../../lib/finance/financeArabicLabels';
import { formatWesternDateTime, formatWesternNumber } from '../../lib/format/westernDigits';
import { buildDebitCreditPrintHtml } from '../../lib/export/financialStatementPrint';

type Row = {
  partyType: string;
  partyId: string;
  partyCode: string;
  partyName: string;
  branchName: string;
  currencyCode: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  balanceDirection: string;
  lastMovementAt: string | null;
  movementCount: number;
};

export default function GeneralLedger() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    partyType: searchParams.get('partyType') || '',
    branchId: searchParams.get('branchId') || '',
    currencyCode: '',
    dateFrom: '',
    dateTo: '',
    balanceDirection: '',
    includeOperationalParties: false,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [result, branchRows] = await Promise.all([
        phase3FinanceGateway.debitCredit.getSummary({
          search: filters.search || undefined,
          partyType: (filters.partyType as 'customer' | 'sender_receiver' | 'agent') || undefined,
          branchId: filters.branchId
            ? (filters.branchId.includes('-') ? filters.branchId : getBackendIdFromSynthetic(Number(filters.branchId)) || undefined)
            : undefined,
          currencyCode: filters.currencyCode || undefined,
          dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
          dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
          balanceDirection: (filters.balanceDirection as 'debit' | 'credit' | 'balanced') || undefined,
          pageSize: 500,
          includeOperationalParties: filters.includeOperationalParties || undefined,
        }),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setRows(result.rows as Row[]);
      setBranches(branchRows.map((b) => ({ id: b.id, name: b.name })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل دفتر الأستاذ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const totalDebit = rows.reduce((sum, row) => sum + row.totalDebit, 0);
    const totalCredit = rows.reduce((sum, row) => sum + row.totalCredit, 0);
    return {
      totalDebit,
      totalCredit,
      net: totalDebit - totalCredit,
      parties: rows.length,
    };
  }, [rows]);

  const openDailyJournal = (row: Row) => {
    const query = new URLSearchParams({
      partyType: row.partyType,
      partyId: row.partyId,
      currencyCode: row.currencyCode,
    });
    navigate(`/finance/daily-journal?${query.toString()}`);
  };

  const openAgentCodStatement = (row: Row) => {
    const query = new URLSearchParams({
      agentId: row.partyId,
      currencyCode: row.currencyCode,
    });
    navigate(`/finance/agent-cod-statement?${query.toString()}`);
  };

  const exportCsv = () => {
    downloadCsv(
      `general-ledger-${new Date().toISOString().split('T')[0]}.csv`,
      ['#', 'كود الحساب', 'اسم الحساب', 'نوع الحساب', 'الفرع', 'العملة', 'إجمالي مدين', 'إجمالي دائن', 'الرصيد', 'اتجاه الرصيد', 'آخر حركة', 'عدد الحركات'],
      rows.map((r, i) => [
        i + 1,
        r.partyCode,
        r.partyName,
        financePartyTypeLabel(r.partyType),
        r.branchName,
        financeCurrencyLabel(r.currencyCode),
        r.totalDebit,
        r.totalCredit,
        r.balance,
        financeBalanceDirectionLabel(r.balanceDirection),
        r.lastMovementAt ? formatWesternDateTime(r.lastMovementAt) : '',
        r.movementCount,
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const buildSubtitle = () => {
    const subtitleParts: string[] = [];
    if (filters.search.trim()) subtitleParts.push(`بحث: ${filters.search.trim()}`);
    if (filters.partyType) subtitleParts.push(`نوع الحساب: ${financePartyTypeLabel(filters.partyType)}`);
    if (filters.branchId) subtitleParts.push(`الفرع: ${branches.find((b) => String(b.id) === filters.branchId)?.name ?? filters.branchId}`);
    if (filters.currencyCode) subtitleParts.push(`العملة: ${financeCurrencyLabel(filters.currencyCode)}`);
    if (filters.dateFrom || filters.dateTo) subtitleParts.push(`من ${filters.dateFrom || '—'} إلى ${filters.dateTo || '—'}`);
    return subtitleParts.length ? subtitleParts.join(' | ') : undefined;
  };

  const buildPrintHtml = () =>
    buildDebitCreditPrintHtml({
      subtitle: buildSubtitle(),
      rows,
      totals,
    });

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3">
        <h2 className="text-xl font-bold">دفتر الأستاذ</h2>
        <p className="text-sm text-gray-600">
          أرصدة الحسابات المالية (وكلاء وعملاء) مُجمّعة من الحركات الموثقة في السيرفر — المصدر المحاسبي الرئيسي للذمم في النظام.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="stat-card"><div className="stat-value">{formatWesternNumber(totals.totalDebit)}</div><div className="stat-label">إجمالي المدين</div></div>
        <div className="stat-card"><div className="stat-value">{formatWesternNumber(totals.totalCredit)}</div><div className="stat-label">إجمالي الدائن</div></div>
        <div className="stat-card"><div className="stat-value">{formatWesternNumber(totals.net)}</div><div className="stat-label">صافي الرصيد</div></div>
        <div className="stat-card"><div className="stat-value">{totals.parties}</div><div className="stat-label">عدد الحسابات</div></div>
      </div>

      <div className="card mb-3 p-2">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <input className="form-input" placeholder="بحث عام" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
          <select className="form-select" value={filters.partyType} onChange={(e) => setFilters((p) => ({ ...p, partyType: e.target.value }))}>
            <option value="">كل الحسابات</option><option value="customer">عميل</option><option value="sender_receiver">مرسل/مستلم</option><option value="agent">وكيل</option>
          </select>
          <select className="form-select" value={filters.branchId} onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}>
            <option value="">الفرع</option>
            {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
          <FinanceCurrencySelect
            allowEmpty
            emptyLabel="العملة"
            value={filters.currencyCode}
            onChange={(currencyCode) => setFilters((p) => ({ ...p, currencyCode }))}
          />
          <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
          <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
          <select className="form-select" value={filters.balanceDirection} onChange={(e) => setFilters((p) => ({ ...p, balanceDirection: e.target.value }))}>
            <option value="">حالة الرصيد</option><option value="debit">مدين لنا</option><option value="credit">دائن علينا</option><option value="balanced">متوازن</option>
          </select>
          <div className="flex gap-1 items-center">
            <button className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
            <button className="toolbar-btn" onClick={() => setFilters({ search: '', partyType: '', branchId: '', currencyCode: '', dateFrom: '', dateTo: '', balanceDirection: '', includeOperationalParties: false })}>إعادة ضبط</button>
            <FinanceExportToolbar
              disabled={loading || rows.length === 0}
              csvFileName={`general-ledger-${new Date().toISOString().split('T')[0]}.csv`}
              csvHeaders={['#', 'كود', 'اسم', 'نوع', 'فرع', 'عملة', 'مدين', 'دائن', 'رصيد']}
              csvRows={rows.map((r, i) => [
                String(i + 1),
                r.partyCode,
                r.partyName,
                financePartyTypeLabel(r.partyType),
                r.branchName,
                financeCurrencyLabel(r.currencyCode),
                String(r.totalDebit),
                String(r.totalCredit),
                String(r.balance),
              ])}
              documentType="general_ledger"
              pdfTitle="دفتر الأستاذ"
              pdfFileName={`general-ledger-${new Date().toISOString().split('T')[0]}.pdf`}
              onBuildPrintHtml={buildPrintHtml}
              className="flex gap-2"
            />
          </div>
          <div className="col-span-2 md:col-span-4 xl:col-span-8 flex items-center gap-2 text-sm text-gray-600 border-t pt-2 mt-1">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeOperationalParties}
                onChange={(e) => setFilters((p) => ({ ...p, includeOperationalParties: e.target.checked }))}
              />
              إظهار الأطراف التشغيلية (المرسل/المستلم) — بيانات قديمة
            </label>
          </div>
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        {error && <div className="mb-2 text-sm text-red-700">{error}</div>}
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th><th>كود الحساب</th><th>اسم الحساب</th><th>نوع الحساب</th><th>الفرع</th><th>العملة</th>
              <th className="text-left">إجمالي مدين</th><th className="text-left">إجمالي دائن</th><th className="text-left">الرصيد</th>
              <th>اتجاه الرصيد</th><th>آخر حركة</th><th>عدد الحركات</th><th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.partyType}-${row.partyId}-${row.currencyCode}`}>
                <td>{idx + 1}</td>
                <td>{row.partyCode}</td>
                <td>{row.partyName}</td>
                <td>{financePartyTypeLabel(row.partyType)}</td>
                <td>{row.branchName || '—'}</td>
                <td>{financeCurrencyLabel(row.currencyCode)}</td>
                <td className="text-left">{formatWesternNumber(row.totalDebit)}</td>
                <td className="text-left">{formatWesternNumber(row.totalCredit)}</td>
                <td className="text-left">{formatWesternNumber(row.balance)}</td>
                <td>{financeBalanceDirectionLabel(row.balanceDirection)}</td>
                <td>{row.lastMovementAt ? formatWesternDateTime(row.lastMovementAt) : '—'}</td>
                <td>{row.movementCount}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="toolbar-btn text-xs" onClick={() => openDailyJournal(row)}>
                      فتح دفتر اليومية
                    </button>
                    {row.partyType === 'agent' && (
                      <button type="button" className="toolbar-btn text-xs" onClick={() => openAgentCodStatement(row)}>
                        كشف مبالغ التسليم
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={13} className="text-center p-6 text-gray-500">لا توجد حسابات مطابقة للفلاتر الحالية.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>الإجمالي</td>
              <td className="text-left">{formatWesternNumber(totals.totalDebit)}</td>
              <td className="text-left">{formatWesternNumber(totals.totalCredit)}</td>
              <td className="text-left">{formatWesternNumber(totals.net)}</td>
              <td colSpan={4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
