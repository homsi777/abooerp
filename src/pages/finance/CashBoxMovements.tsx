import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxMovementRow, type BackendCashboxStatement } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type TransactionTypeFilter = '' | 'inflow' | 'outflow';

export default function CashBoxMovements() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [statement, setStatement] = useState<BackendCashboxStatement | null>(null);
  const [rows, setRows] = useState<BackendCashboxMovementRow[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionTypeFilter>('');
  const [loading, setLoading] = useState(true);

  const currency = (statement?.cashbox.currency_code ?? 'USD') as CurrencyCode;
  const cashboxName = statement?.cashbox.name ?? '';

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const payload = await phase3FinanceGateway.cashbox.getStatement(id, {
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
        transactionType: transactionType || undefined,
      });
      setStatement(payload);
      setRows(payload.rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل كشف الصندوق', 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, id, showToast, transactionType]);

  useEffect(() => {
    void load();
  }, [load]);

  const referenceLabel = (r: BackendCashboxMovementRow) => {
    const voucherType = r.source_voucher_type === 'receipt' ? 'قبض' : 'دفع';
    return r.reference_no ? `${voucherType} / ${r.reference_no}` : `${voucherType} / ${r.source_voucher_id.slice(0, 8)}...`;
  };

  const sourceLabel = (r: BackendCashboxMovementRow) => {
    if (r.source_label === 'expense') return 'مصروف';
    if (r.source_label === 'salary_record') return 'راتب موظف';
    if (r.source_label === 'cashbox_transfer') return 'مناقلة صندوق';
    if (r.related_entity_type === 'manual_party') return 'جهة يدوية';
    if (r.source_label === 'receipt_voucher') return 'سند قبض';
    if (r.source_label === 'payment_voucher') return 'سند دفع';
    return r.source_voucher_type === 'receipt' ? 'سند قبض' : 'سند دفع';
  };

  const descriptionLabel = (r: BackendCashboxMovementRow) => {
    const parts = [sourceLabel(r), r.party_display_name, r.notes].filter((part) => String(part ?? '').trim());
    return parts.length ? parts.join(' - ') : '-';
  };

  const exportCsv = () => {
    downloadCsv(
      `cashbox-statement-${id}-${new Date().toISOString().split('T')[0]}.csv`,
      ['#', 'التاريخ', 'النوع', 'المصدر', 'الطرف/الجهة', 'المرجع', 'البيان', 'وارد', 'صادر', 'الرصيد', 'المستخدم', 'الحالة'],
      rows.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        r.transaction_type === 'inflow' ? 'وارد' : 'صادر',
        sourceLabel(r),
        r.party_display_name ?? '',
        referenceLabel(r),
        descriptionLabel(r),
        r.debit_in || '',
        r.credit_out || '',
        r.running_balance ?? '',
        r.created_by_username ?? '',
        r.status ?? '',
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const result = await exportPdfTable({
      title: 'كشف الصندوق',
      subtitle: `${cashboxName || '-'} - ${currency}`,
      defaultFileName: `cashbox-statement-${id}-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['#', 'التاريخ', 'النوع', 'المصدر', 'الطرف/الجهة', 'المرجع', 'البيان', 'وارد', 'صادر', 'الرصيد', 'المستخدم', 'الحالة'],
      rows: rows.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        r.transaction_type === 'inflow' ? 'وارد' : 'صادر',
        sourceLabel(r),
        r.party_display_name ?? '-',
        referenceLabel(r),
        descriptionLabel(r),
        r.debit_in ? formatCurrency(r.debit_in, currency) : '-',
        r.credit_out ? formatCurrency(r.credit_out, currency) : '-',
        formatCurrency(r.running_balance ?? 0, currency),
        r.created_by_username ?? '-',
        r.status ?? '-',
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (!id) {
    return <div className="p-4">معرف الصندوق غير صالح</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">كشف الصندوق</h2>
          <p className="text-sm text-gray-600 mt-1">
            {cashboxName || '-'} - {currency}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/finance/cashboxes" className="toolbar-btn">رجوع للصناديق</Link>
          <button type="button" className="toolbar-btn" onClick={() => void load()}>تحديث</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>تصدير Excel (CSV)</button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>تصدير PDF</button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>طباعة</button>
        </div>
      </div>

      <div className="card flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">من تاريخ</label>
          <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">إلى تاريخ</label>
          <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">النوع</label>
          <select className="form-input" value={transactionType} onChange={(e) => setTransactionType(e.target.value as TransactionTypeFilter)}>
            <option value="">كل الحركات</option>
            <option value="inflow">وارد</option>
            <option value="outflow">صادر</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(statement?.summary.openingBalance ?? 0, currency)}</div>
          <div className="stat-label">الرصيد الافتتاحي</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-green-700">{formatCurrency(statement?.summary.totalIncoming ?? 0, currency)}</div>
          <div className="stat-label">إجمالي المقبوضات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-red-700">{formatCurrency(statement?.summary.totalOutgoing ?? 0, currency)}</div>
          <div className="stat-label">إجمالي المدفوعات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(statement?.summary.closingBalance ?? 0, currency)}</div>
          <div className="stat-label">الرصيد الختامي</div>
        </div>
      </div>

      <div className="card overflow-auto">
        {loading ? (
          <div className="p-6 text-center">جاري التحميل...</div>
        ) : (
          <table className="data-grid">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>المصدر</th>
                <th>الطرف/الجهة</th>
                <th>المرجع</th>
                <th>البيان</th>
                <th>وارد</th>
                <th>صادر</th>
                <th>الرصيد</th>
                <th>المستخدم</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.created_at.split('T')[0]}</td>
                  <td>{r.transaction_type === 'inflow' ? 'وارد' : 'صادر'}</td>
                  <td>{sourceLabel(r)}</td>
                  <td>{r.party_display_name ?? '-'}</td>
                  <td>{referenceLabel(r)}</td>
                  <td>{descriptionLabel(r)}</td>
                  <td className="text-left text-green-700">{r.debit_in ? formatCurrency(r.debit_in, currency) : '-'}</td>
                  <td className="text-left text-red-700">{r.credit_out ? formatCurrency(r.credit_out, currency) : '-'}</td>
                  <td className="text-left font-medium">{formatCurrency(r.running_balance ?? 0, currency)}</td>
                  <td>{r.created_by_username ?? '-'}</td>
                  <td>{r.status ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rows.length === 0 && <p className="p-4 text-gray-500">لا توجد حركات ضمن الفلاتر المحددة.</p>}
      </div>
    </div>
  );
}
