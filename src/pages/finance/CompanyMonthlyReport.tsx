import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxMovementRow, type BackendCashboxRecord, type BackendCashboxStatement } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

const MONTH_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export default function CompanyMonthlyReport() {
  const { showToast } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [cashbox, setCashbox] = useState<BackendCashboxRecord | null>(null);
  const [statement, setStatement] = useState<BackendCashboxStatement | null>(null);
  const [rows, setRows] = useState<BackendCashboxMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const currency = (statement?.cashbox.currency_code ?? 'USD') as CurrencyCode;

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      let box = cashbox;
      if (!box) {
        const all = await phase3FinanceGateway.cashbox.listMaster({ type: 'COMPANY' });
        box = all.find((c) => c.code === 'CASH-GENERAL-USD') ?? all[0] ?? null;
        setCashbox(box);
      }
      if (!box) {
        setNotFound(true);
        setStatement(null);
        setRows([]);
        return;
      }
      const { from, to } = monthRange(year, month);
      const payload = await phase3FinanceGateway.cashbox.getStatement(box.id, {
        dateFrom: `${from}T00:00:00.000Z`,
        dateTo: `${to}T23:59:59.999Z`,
      });
      setStatement(payload);
      setRows(payload.rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل التقرير الشهري', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

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

  const monthLabel = `${MONTH_AR[month]} ${year}`;

  const years = useMemo(() => {
    const base = now.getFullYear();
    return [base - 2, base - 1, base, base + 1];
  }, [now]);

  const exportCsv = () => {
    downloadCsv(
      `company-monthly-report-${year}-${month + 1}.csv`,
      ['#', 'التاريخ', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد'],
      rows.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        descriptionLabel(r),
        referenceLabel(r),
        r.debit_in || '',
        r.credit_out || '',
        r.running_balance ?? '',
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const result = await exportPdfTable({
      title: 'التقرير الشهري — الصندوق العام',
      subtitle: monthLabel,
      defaultFileName: `company-monthly-report-${year}-${month + 1}.pdf`,
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

  const opening = statement?.summary.openingBalance ?? 0;
  const totalIn = statement?.summary.totalIncoming ?? 0;
  const totalOut = statement?.summary.totalOutgoing ?? 0;
  const closing = statement?.summary.closingBalance ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '24px' }}>
      {/* ───────── Header ───────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <Link to="/finance" style={{ fontSize: '13px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
            ← الذمم والمالية
          </Link>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', margin: '6px 0 2px' }}>
            التقرير الشهري — {cashbox?.name ?? 'الصندوق العام'}
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>{monthLabel}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <select className="form-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_AR.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select className="form-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="button" className="toolbar-btn" onClick={() => void load()}>تحديث</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv} disabled={!rows.length}>CSV</button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()} disabled={!rows.length}>PDF</button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>طباعة</button>
        </div>
      </div>

      {notFound ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#991b1b' }}>
          لا يوجد صندوق شركة (COMPANY) معرّف في النظام حالياً. يرجى مراجعة إعدادات الصناديق.
        </div>
      ) : loading ? (
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
                    <strong>رصيد افتتاحي ({monthLabel})</strong>
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
                      لا توجد حركات خلال {monthLabel}.
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
  return { textAlign: align, padding: '9px 14px', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' };
}

function tdStyle(align: 'right' | 'left'): React.CSSProperties {
  return { textAlign: align, padding: '8px 14px', whiteSpace: 'nowrap', color: '#1f2937' };
}
