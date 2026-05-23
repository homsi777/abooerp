import { useMemo, useState } from 'react';
import ReportControlBar from '../../components/ReportControlBar';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

interface RecordRow {
  id: number;
  recordNo: string;
  date: string;
  recordType: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  branchName: string;
  userName: string;
  currency: CurrencyCode;
}

const recordTypes = ['سند قبض', 'سند دفع', 'مصروف', 'راتب', 'سلف', 'تحويل'];

export default function FinanceRecords() {
  const rates = getExchangeRatesToUsd();
  const { showToast } = useToast();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    searchTerm: '',
    typeFilter: '',
    branchFilter: '',
    dateFrom: '',
    dateTo: '',
  });
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);

  const loadRecords = async (range: { from: string; to: string }) => {
    try {
      const fromAt = range.from
        ? new Date(`${range.from}T00:00:00Z`).toISOString()
        : undefined;
      const toAt = range.to
        ? new Date(`${range.to}T23:59:59Z`).toISOString()
        : undefined;
      const rows = await phase3FinanceGateway.statements.getEntries({
        fromAt,
        toAt,
      });
      const mapped: RecordRow[] = rows.map((row, idx) => {
        const amount = Number(row.original_amount || 0);
        const signedBase = Number(row.signed_base_amount_usd || 0);
        const isDebit = signedBase >= 0;
        return {
          id: idx + 1,
          recordNo: `MOV-${String(idx + 1).padStart(4, '0')}`,
          date: row.created_at.split('T')[0],
          recordType: row.movement_type === 'voucher_receipt' ? 'سند قبض' : 'سند دفع',
          reference: row.voucher_id,
          description: `${row.voucher_type} / ${row.party_type}`,
          debit: isDebit ? amount : 0,
          credit: isDebit ? 0 : amount,
          balance: signedBase,
          branchName: 'نطاق المستخدم',
          userName: row.party_type,
          currency: row.original_currency as CurrencyCode,
        };
      });
      setRecords(mapped);
    } catch {
      showToast('تعذر تحميل السجلات المالية', 'error');
    }
  };

  const totalDebit = records.reduce((sum, r) => sum + convertToUsd(r.debit, r.currency, rates), 0);
  const totalCredit = records.reduce((sum, r) => sum + convertToUsd(r.credit, r.currency, rates), 0);
  const finalBalance = records.reduce((sum, r) => sum + convertToUsd(r.balance, r.currency, rates), 0);

  const filteredRecords = records.filter(r => {
    if (appliedFilters.searchTerm && !r.description.includes(appliedFilters.searchTerm) && !r.recordNo.includes(appliedFilters.searchTerm)) return false;
    if (appliedFilters.typeFilter && r.recordType !== appliedFilters.typeFilter) return false;
    if (appliedFilters.dateFrom && r.date < appliedFilters.dateFrom) return false;
    if (appliedFilters.dateTo && r.date > appliedFilters.dateTo) return false;
    return true;
  });

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, page]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const clearFilters = () => {
    setSearchTerm('');
    setTypeFilter('');
    setBranchFilter('');
    setDateFrom('');
    setDateTo('');
    setHasAppliedFilters(false);
    setPage(1);
  };

  const applyFilters = () => {
    setAppliedFilters({
      searchTerm,
      typeFilter,
      branchFilter: '',
      dateFrom,
      dateTo,
    });
    setHasAppliedFilters(true);
    setPage(1);
    void loadRecords({ from: dateFrom, to: dateTo });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">السجلات المالية</h2>
      </div>

      {hasAppliedFilters && (
        <div className="grid grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#16a34d' }}>{totalDebit.toLocaleString()}</div>
            <div className="stat-label">إجمالي المدين (USD)</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#dc2626' }}>{totalCredit.toLocaleString()}</div>
            <div className="stat-label">إجمالي الدائن (USD)</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{finalBalance.toLocaleString()}</div>
            <div className="stat-label">الرصيد النهائي (USD)</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{records.length}</div>
            <div className="stat-label">إجمالي السجلات</div>
          </div>
        </div>
      )}

      <ReportControlBar
        onExecute={applyFilters}
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          {
            id: 'export',
            label: 'تصدير Excel (CSV)',
            onClick: () => {
              if (!hasAppliedFilters) {
                showToast('اعرض الكشف أولاً', 'info');
                return;
              }
              downloadCsv(
                `finance-records-${appliedFilters.dateFrom || 'all'}-${appliedFilters.dateTo || 'all'}.csv`,
                ['recordNo', 'date', 'type', 'ref', 'description', 'currency', 'debit', 'credit', 'balance', 'balanceUsd', 'branch', 'user'],
                filteredRecords.map((r) => [
                  r.recordNo,
                  r.date,
                  r.recordType,
                  r.reference,
                  r.description,
                  r.currency,
                  r.debit,
                  r.credit,
                  r.balance,
                  convertToUsd(r.balance, r.currency, rates),
                  r.branchName,
                  r.userName,
                ]),
              );
              showToast('تم تنزيل الملف', 'success');
            },
          },
          {
            id: 'export-pdf',
            label: 'تصدير PDF',
            onClick: async () => {
              if (!hasAppliedFilters) {
                showToast('اعرض الكشف أولاً', 'info');
                return;
              }
              const fromLabel = appliedFilters.dateFrom || 'بلا-بداية';
              const toLabel = appliedFilters.dateTo || 'بلا-نهاية';
              const result = await exportPdfTable({
                title: 'السجلات المالية',
                subtitle: `من ${fromLabel} إلى ${toLabel}`,
                defaultFileName: `finance-records-${fromLabel}-${toLabel}.pdf`,
                headers: ['رقم السجل', 'التاريخ', 'النوع', 'المرجع', 'الوصف', 'العملة', 'مدين', 'دائن', 'الرصيد', 'الرصيد USD'],
                rows: filteredRecords.map((r) => [
                  r.recordNo,
                  r.date,
                  r.recordType,
                  r.reference,
                  r.description,
                  r.currency,
                  r.debit,
                  r.credit,
                  r.balance,
                  convertToUsd(r.balance, r.currency, rates),
                ]),
              });
              if (result.saved) showToast('تم حفظ ملف PDF', 'success');
              else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
            },
          },
          { id: 'clear', label: 'مسح الفلاتر', onClick: clearFilters },
        ]}
        filters={
          <>
            <div className="form-group">
              <label className="form-label">بحث</label>
              <input type="text" placeholder="بحث بالوصف أو الرقم..." className="form-input min-w-[220px]" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">النوع</label>
              <select className="form-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="">كل الأنواع</option>
                {recordTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">من تاريخ</label>
              <input type="date" className="form-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">إلى تاريخ</label>
              <input type="date" className="form-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </>
        }
      />

      {/* Records Table */}
      <div className="card overflow-auto">
        {hasAppliedFilters ? (
          <>
          <table className="data-grid">
          <thead>
            <tr>
              <th>رقم السجل</th>
              <th>التاريخ</th>
              <th>نوع السجل</th>
              <th>المرجع</th>
              <th>الوصف</th>
              <th>العملة</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>الرصيد</th>
              <th>الرصيد USD</th>
              <th>الفرع</th>
              <th>المستخدم</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.map(record => (
              <tr key={record.id}>
                <td>{record.recordNo}</td>
                <td>{record.date}</td>
                <td>{record.recordType}</td>
                <td>{record.reference}</td>
                <td>{record.description}</td>
                <td>{record.currency}</td>
                <td className="text-left" style={{ color: record.debit > 0 ? '#16a34d' : undefined }}>{record.debit > 0 ? formatCurrency(record.debit, record.currency) : '-'}</td>
                <td className="text-left" style={{ color: record.credit > 0 ? '#dc2626' : undefined }}>{record.credit > 0 ? formatCurrency(record.credit, record.currency) : '-'}</td>
                <td className="text-left" style={{ fontWeight: 600 }}>{formatCurrency(record.balance, record.currency)}</td>
                <td className="text-left" style={{ fontWeight: 600 }}>{formatCurrency(convertToUsd(record.balance, record.currency, rates), 'USD')}</td>
                <td>{record.branchName}</td>
                <td>{record.userName}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f3f4f6' }}>
              <td colSpan={6} className="text-left">الإجمالي (USD)</td>
              <td className="text-left" style={{ color: '#16a34d' }}>{formatCurrency(totalDebit, 'USD')}</td>
              <td className="text-left" style={{ color: '#dc2626' }}>{formatCurrency(totalCredit, 'USD')}</td>
              <td className="text-left">{formatCurrency(finalBalance, 'USD')}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
          </table>
          <div className="flex items-center justify-between p-3 border-t">
            <span className="text-sm text-gray-600">صفحة {page} من {totalPages}</span>
            <div className="flex gap-2">
              <button className="toolbar-btn" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>السابق</button>
              <button className="toolbar-btn" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>التالي</button>
            </div>
          </div>
          </>
        ) : (
          <div className="text-center p-4 text-gray-600">اختر الفلاتر ثم اضغط "عرض الكشف"</div>
        )}
      </div>
    </div>
  );
}
