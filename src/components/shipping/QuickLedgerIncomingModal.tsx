import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { httpClient } from '../../lib/api/httpClient';
import type { RemoteDailyLedgerRow } from '../../lib/shipping/dailyLedgerTypes';

/**
 * شحنات واردة إلى مدينة فرعي (فروع أخرى أدخلتها ووجهتها مدينتي) — للقراءة فقط.
 * السيرفر هو من يقرر ما يُعرض (direction=incoming): وجهة السطر = مدينة فرعي
 * ومصدره فرع آخر. لا تعديل ولا حفظ هنا عمداً: السطر يخص جلسة فرع آخر.
 */

type Props = {
  open: boolean;
  onClose: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function cell(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const raw = String(value).trim();
  return raw || '—';
}

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export default function QuickLedgerIncomingModal({ open, onClose }: Props) {
  const [dateFrom, setDateFrom] = useState(daysAgoIso(7));
  const [dateTo, setDateTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RemoteDailyLedgerRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ direction: 'incoming', dateFrom, dateTo, limit: '1000' });
      const data = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'تعذر جلب الشحنات الواردة');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const totals = useMemo(() => {
    const sum = (pick: (r: RemoteDailyLedgerRow) => string | null | undefined) =>
      rows.reduce((acc, r) => acc + (Number(pick(r)) || 0), 0);
    return {
      collect: sum((r) => r.collect_amount_usd),
      hawala: sum((r) => r.hawala_amount_usd),
      fee: sum((r) => r.transfer_service_fee_usd),
      prepaid: sum((r) => r.prepaid_amount_usd),
    };
  }, [rows]);

  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="quick-ledger-dispatch-dialog quick-ledger-duplicates-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-ledger-dispatch-dialog-header">
          <div>
            <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
            <h3 id="incoming-title">شحنات واردة إلى فرعي</h3>
            <p className="quick-ledger-dispatch-dialog-sub">
              أسطر أدخلتها فروع أخرى ووجهتها مدينة فرعك — للقراءة فقط.
            </p>
          </div>
          <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>

        <div className="quick-ledger-dispatch-dialog-body">
          <div className="quick-ledger-duplicates-filters">
            <label>
              <span>من تاريخ</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              <span>إلى تاريخ</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <div className="quick-ledger-duplicates-actions">
              <button type="button" className="primary" onClick={() => void load()} disabled={loading}>
                <Search size={16} />
                {loading ? 'جاري التحميل...' : 'تحديث'}
              </button>
            </div>
          </div>

          <div className="quick-ledger-duplicates-hint">
            {rows.length} سطر · تحصيل {money(totals.collect)} · حوالة {money(totals.hawala)} · أجرة حوالة{' '}
            {money(totals.fee)} · دفع مسبق {money(totals.prepaid)}
          </div>

          {error ? <p className="quick-ledger-global-search-error">{error}</p> : null}

          <div className="quick-ledger-duplicates-results" style={{ overflow: 'auto' }}>
            {!loading && !error && rows.length === 0 ? (
              <p className="quick-ledger-global-search-empty">لا توجد شحنات واردة إلى فرعك في هذه الفترة.</p>
            ) : (
              <table className="quick-ledger-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>من فرع</th>
                    <th>رقم الإيصال</th>
                    <th>الجهة</th>
                    <th>نوع البضاعة</th>
                    <th>العدد</th>
                    <th>المرسل</th>
                    <th>المستلم</th>
                    <th>تحصيل</th>
                    <th>حوالة</th>
                    <th>أجرة حوالة</th>
                    <th>دفع مسبق</th>
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{cell(String(r.ledger_date ?? '').slice(0, 10))}</td>
                      <td>{cell(r.source_branch_name)}</td>
                      <td>{cell(r.receipt_no)}</td>
                      <td>{cell(r.destination)}</td>
                      <td>{cell(r.parcel_type)}</td>
                      <td>{cell(r.parcel_count)}</td>
                      <td>{cell(r.sender_name)}</td>
                      <td>{cell(r.receiver_name)}</td>
                      <td>{money(r.collect_amount_usd)}</td>
                      <td>{money(r.hawala_amount_usd)}</td>
                      <td>{money(r.transfer_service_fee_usd)}</td>
                      <td>{money(r.prepaid_amount_usd)}</td>
                      <td>{cell(r.notes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
