import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxMovementRow, type BackendCashboxStatement } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type TransactionTypeFilter = '' | 'inflow' | 'outflow';

// بدون فلتر افتراضي كانت الشاشة تعرض كامل تاريخ الصندوق منذ إنشائه، فتظهر
// حركات قديمة جداً لا أهمية لها يومياً وسط الحركات الحديثة. لا نحذف أو
// "نؤرشف" أي سند فعلياً (يبقى كاملاً في السجل المحاسبي ويظهر فوراً عند
// توسيع الفلتر) — فقط نفتح الشاشة افتراضياً على الشهر الحالي.
function startOfCurrentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function CashBoxMovements() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [statement, setStatement] = useState<BackendCashboxStatement | null>(null);
  const [rows, setRows] = useState<BackendCashboxMovementRow[]>([]);
  const [dateFrom, setDateFrom] = useState(startOfCurrentMonthIso());
  const [dateTo, setDateTo] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionTypeFilter>('');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      ['#', 'التاريخ', 'النوع', 'المصدر', 'الطرف/الجهة', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد', 'المستخدم', 'الحالة'],
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
      headers: ['#', 'التاريخ', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد'],
      rows: rows.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        descriptionLabel(r),
        referenceLabel(r),
        r.debit_in ? formatCurrency(r.debit_in, currency) : '-',
        r.credit_out ? formatCurrency(r.credit_out, currency) : '-',
        formatCurrency(r.running_balance ?? 0, currency),
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (!id) {
    return <div style={{ padding: '16px' }}>معرف الصندوق غير صالح</div>;
  }

  const opening = statement?.summary.openingBalance ?? 0;
  const totalIn = statement?.summary.totalIncoming ?? 0;
  const totalOut = statement?.summary.totalOutgoing ?? 0;
  const closing = statement?.summary.closingBalance ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '24px' }}>
      {/* ───────── Header ───────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <Link to="/finance/cashboxes" style={{ fontSize: '13px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
            ← رجوع للصناديق
          </Link>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', margin: '6px 0 2px' }}>كشف حساب — {cashboxName || '-'}</h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>العملة: {currency}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button type="button" className="toolbar-btn" onClick={() => void load()}>تحديث</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>CSV</button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>PDF</button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>طباعة</button>
        </div>
      </div>

      {/* ───────── Filters (collapsible) ───────── */}
      <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '10px 14px' }}>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontSize: '13px',
            fontWeight: 700,
            color: '#374151',
          }}
        >
          <span>تصفية الحركات</span>
          <span style={{ color: '#9ca3af', fontSize: '12px' }}>{filtersOpen ? '▲' : '▼'}</span>
        </button>
        {filtersOpen && (
          <div className="flex flex-wrap gap-3" style={{ marginTop: '12px' }}>
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
                <option value="inflow">مدين (وارد)</option>
                <option value="outflow">دائن (صادر)</option>
              </select>
            </div>
            {(dateFrom || dateTo || transactionType) && (
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="toolbar-btn text-sm"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setTransactionType('');
                  }}
                >
                  إعادة ضبط
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────── Ledger table ───────── */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>جاري التحميل...</div>
      ) : (
        <div style={{ border: '1px solid #9ca3af', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #9ca3af' }}>
                  <th style={thStyle('right')}>التاريخ</th>
                  <th style={thStyle('right')}>البيان</th>
                  <th style={thStyle('right')}>المرجع</th>
                  <th style={thStyle('left')}>مدين</th>
                  <th style={thStyle('left')}>دائن</th>
                  <th style={thStyle('left')}>الرصيد</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
                  <td style={tdStyle('right')} colSpan={5}>
                    <strong>رصيد افتتاحي</strong>
                  </td>
                  <td style={{ ...tdStyle('left'), fontWeight: 700 }}>{formatCurrency(opening, currency)}</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={tdStyle('right')}>{r.created_at.split('T')[0]}</td>
                    <td style={tdStyle('right')}>{descriptionLabel(r)}</td>
                    <td style={{ ...tdStyle('right'), color: '#6b7280', fontFamily: 'monospace', fontSize: '12px' }}>
                      {referenceLabel(r)}
                    </td>
                    <td style={{ ...tdStyle('left'), color: '#166534' }}>{r.debit_in ? formatCurrency(r.debit_in, currency) : ''}</td>
                    <td style={{ ...tdStyle('left'), color: '#991b1b' }}>{r.credit_out ? formatCurrency(r.credit_out, currency) : ''}</td>
                    <td style={{ ...tdStyle('left'), fontWeight: 600 }}>{formatCurrency(r.running_balance ?? 0, currency)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                      لا توجد حركات ضمن الفلاتر المحددة.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #9ca3af', background: '#f3f4f6', fontWeight: 700 }}>
                  <td style={tdStyle('right')} colSpan={3}>
                    الإجمالي
                  </td>
                  <td style={{ ...tdStyle('left'), color: '#166534' }}>{formatCurrency(totalIn, currency)}</td>
                  <td style={{ ...tdStyle('left'), color: '#991b1b' }}>{formatCurrency(totalOut, currency)}</td>
                  <td style={tdStyle('left')}>{formatCurrency(closing, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function thStyle(align: 'right' | 'left'): React.CSSProperties {
  return {
    textAlign: align,
    padding: '9px 14px',
    fontWeight: 700,
    color: '#374151',
    whiteSpace: 'nowrap',
  };
}

function tdStyle(align: 'right' | 'left'): React.CSSProperties {
  return {
    textAlign: align,
    padding: '8px 14px',
    whiteSpace: 'nowrap',
    color: '#1f2937',
  };
}
