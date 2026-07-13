import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Search, X } from 'lucide-react';
import {
  duplicateKindLabel,
  fetchDuplicateReceipts,
  type DuplicateReceiptGroup,
  type DuplicateReceiptsReport,
} from '../../lib/shipping/dailyLedgerDuplicateReceiptsGateway';
import { printDuplicateReceiptsReport } from '../../lib/shipping/dailyLedgerDuplicateReceiptsPrint';
import type { RemoteDailyLedgerRow } from '../../lib/shipping/dailyLedgerTypes';

type Props = {
  open: boolean;
  onClose: () => void;
  branchId?: string;
  allBranches?: boolean;
  defaultDateFrom?: string;
  defaultDateTo?: string;
  onSelectRow?: (row: RemoteDailyLedgerRow) => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return (match?.[1] ?? raw) || '—';
}

function fmtCell(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const raw = String(value).trim();
  return raw || '—';
}

function fmtMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function rowStatus(row: DuplicateReceiptGroup['rows'][number]): string {
  if (row.loaded_at) return 'محمّل';
  if (row.posted_shipment_id) return 'مُرحَّل';
  return 'غير مُرحَّل';
}

function toRemoteRow(row: DuplicateReceiptGroup['rows'][number]): RemoteDailyLedgerRow {
  return {
    id: row.id,
    row_no: row.row_no,
    receipt_no: row.receipt_no,
    destination: row.destination ?? '',
    parcel_type: row.parcel_type ?? '',
    parcel_count: row.parcel_count,
    weight_kg: row.weight_kg,
    sender_name: row.sender_name ?? '',
    receiver_name: row.receiver_name ?? '',
    collect_amount_usd: row.collect_amount_usd ?? '0',
    prepaid_amount_usd: row.prepaid_amount_usd ?? '0',
    hawala_amount_usd: row.hawala_amount_usd ?? '0',
    fees_amount_usd: row.fees_amount_usd ?? '0',
    transfer_service_fee_usd: row.transfer_service_fee_usd ?? '0',
    notes: row.notes,
    posted_shipment_id: row.posted_shipment_id,
    posted_at: null,
    loaded_manifest_id: null,
    loaded_at: row.loaded_at,
    created_at: row.created_at,
    updated_at: row.created_at,
    branch_id: row.branch_id,
    ledger_date: row.ledger_date,
    line_label: row.line_label,
    origin_label: '',
    trip_no: null,
    vehicle_label: null,
    driver_label: row.driver_label,
    dispatch_no: row.dispatch_no,
  };
}

export default function QuickLedgerDuplicateRowsModal({
  open,
  onClose,
  branchId,
  allBranches = false,
  defaultDateFrom,
  defaultDateTo,
  onSelectRow,
}: Props) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom ?? daysAgoIso(90));
  const [dateTo, setDateTo] = useState(defaultDateTo ?? todayIso());
  const [scopeMode, setScopeMode] = useState<'all' | 'same_day' | 'cross_date'>('all');
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DuplicateReceiptsReport | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDateFrom(defaultDateFrom ?? daysAgoIso(90));
    setDateTo(defaultDateTo ?? todayIso());
    setScopeMode('all');
    setReport(null);
    setSearched(false);
    setError(null);
    setExpandedId(null);
  }, [open, defaultDateFrom, defaultDateTo]);

  const scopeLabel = allBranches ? 'كل الفروع' : 'الفرع الحالي';

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDuplicateReceipts({
        branchId,
        allBranches,
        dateFrom,
        dateTo,
        scopeMode,
        limit: 200,
      });
      setReport(data);
      setSearched(true);
      setExpandedId(data.groups[0] ? `${data.groups[0].kind}:${data.groups[0].receipt_no}` : null);
    } catch (searchError) {
      setReport(null);
      setSearched(true);
      setError(searchError instanceof Error ? searchError.message : 'تعذر فحص الأسطر المكررة');
    } finally {
      setLoading(false);
    }
  }, [allBranches, branchId, dateFrom, dateTo, scopeMode]);

  useEffect(() => {
    if (!open) return;
    void runSearch();
  }, [open, runSearch]);

  const handlePrint = useCallback(async () => {
    if (!report) return;
    setPrinting(true);
    setError(null);
    try {
      const outcome = await printDuplicateReceiptsReport({
        report,
        dateFrom,
        dateTo,
        scopeLabel,
      });
      if (outcome === 'error') {
        setError('تعذر إرسال الطباعة — تحقق من الطابعة أو جرّب من المتصفح.');
      }
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'تعذر طباعة التقرير');
    } finally {
      setPrinting(false);
    }
  }, [dateFrom, dateTo, report, scopeLabel]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const groups = report?.groups ?? [];
  const summary = report?.summary;

  const summaryText = useMemo(() => {
    if (!summary) return '';
    return `${summary.sameDayGroups} نفس اليوم · ${summary.crossDateGroups} عبر التواريخ · ${summary.totalDuplicateRows} سطر`;
  }, [summary]);

  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="quick-ledger-dispatch-dialog quick-ledger-duplicates-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicates-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-ledger-dispatch-dialog-header">
          <div>
            <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
            <h3 id="duplicates-title">أسطر مكررة — تفاصيل</h3>
            <p className="quick-ledger-dispatch-dialog-sub">
              فحص إيصالات مكررة (نفس اليوم أو عبر التواريخ) مع تفاصيل كل سطر وطباعة التقرير.
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
            <label>
              <span>نوع التكرار</span>
              <select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as typeof scopeMode)}>
                <option value="all">الكل</option>
                <option value="same_day">نفس اليوم والخط</option>
                <option value="cross_date">عبر تواريخ مختلفة</option>
              </select>
            </label>
            <div className="quick-ledger-duplicates-actions">
              <button type="button" className="primary" onClick={() => void runSearch()} disabled={loading}>
                <Search size={16} />
                {loading ? 'جاري الفحص...' : 'فحص'}
              </button>
              <button
                type="button"
                className="quick-ledger-duplicates-print-btn"
                onClick={() => void handlePrint()}
                disabled={!report || printing || groups.length === 0}
              >
                <Printer size={16} />
                {printing ? 'جاري الطباعة...' : 'طباعة التقرير'}
              </button>
            </div>
          </div>

          <div className="quick-ledger-duplicates-hint">
            نطاق: {scopeLabel}
            {summaryText ? ` · ${summaryText}` : ''}
          </div>

          {error ? <p className="quick-ledger-global-search-error">{error}</p> : null}

          <div className="quick-ledger-duplicates-results">
            {!searched || loading ? (
              <p className="quick-ledger-global-search-empty">
                {loading ? 'جاري فحص الأسطر المكررة...' : 'اضغط «فحص» لعرض النتائج.'}
              </p>
            ) : groups.length === 0 ? (
              <p className="quick-ledger-global-search-empty">لا توجد أسطر مكررة ضمن النطاق المحدد.</p>
            ) : (
              groups.map((group) => {
                const key = `${group.kind}:${group.receipt_no}:${group.rows[0]?.ledger_date ?? ''}:${group.rows[0]?.line_label ?? ''}`;
                const expanded = expandedId === key;
                return (
                  <article key={key} className={`quick-ledger-duplicates-group${expanded ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="quick-ledger-duplicates-group-head"
                      onClick={() => setExpandedId(expanded ? null : key)}
                    >
                      <div>
                        <strong>إيصال {group.receipt_no}</strong>
                        <span className={`quick-ledger-duplicates-kind is-${group.kind}`}>
                          {duplicateKindLabel(group.kind)}
                        </span>
                      </div>
                      <div className="quick-ledger-duplicates-group-meta">
                        <span>{group.count} سطر</span>
                        <span>تحصيل {fmtMoney(group.collect_sum)}</span>
                        <span>حوالة {fmtMoney(group.hawala_sum)}</span>
                        <span>أجرة {fmtMoney(group.transfer_fee_sum)}</span>
                      </div>
                    </button>
                    {expanded ? (
                      <div className="quick-ledger-duplicates-group-body">
                        <table>
                          <thead>
                            <tr>
                              <th>التاريخ</th>
                              <th>فرع / خط</th>
                              <th>نوع البضاعة</th>
                              <th>عدد</th>
                              <th>وزن</th>
                              <th>تحصيل $</th>
                              <th>حوالة</th>
                              <th>أجرة</th>
                              <th>مسبق</th>
                              <th>المرسل</th>
                              <th>المرسل إليه</th>
                              <th>الجهة</th>
                              <th>الحالة</th>
                              <th>ملاحظات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => (
                              <tr
                                key={row.id}
                                className={onSelectRow ? 'is-clickable' : undefined}
                                onClick={() => onSelectRow?.(toRemoteRow(row))}
                                title={onSelectRow ? 'اضغط للانتقال إلى السطر في الدفتر' : undefined}
                              >
                                <td>{fmtDate(row.ledger_date)}</td>
                                <td>
                                  <div>{fmtCell(row.branch_name)}</div>
                                  <div className="quick-ledger-global-search-muted">{fmtCell(row.line_label)}</div>
                                </td>
                                <td>{fmtCell(row.parcel_type)}</td>
                                <td>{fmtCell(row.parcel_count)}</td>
                                <td>{fmtCell(row.weight_kg)}</td>
                                <td>{fmtMoney(Number(row.collect_amount_usd) + Number(row.fees_amount_usd))}</td>
                                <td>{fmtMoney(row.hawala_amount_usd)}</td>
                                <td>{fmtMoney(row.transfer_service_fee_usd)}</td>
                                <td>{fmtMoney(row.prepaid_amount_usd)}</td>
                                <td>{fmtCell(row.sender_name)}</td>
                                <td>{fmtCell(row.receiver_name)}</td>
                                <td>{fmtCell(row.destination)}</td>
                                <td>
                                  <span
                                    className={`quick-ledger-global-search-status is-${
                                      row.loaded_at ? 'loaded' : row.posted_shipment_id ? 'posted' : 'draft'
                                    }`}
                                  >
                                    {rowStatus(row)}
                                  </span>
                                </td>
                                <td>{fmtCell(row.notes)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
