import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Printer, RotateCcw, Search, X } from 'lucide-react';
import { useToast } from '../Toast';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import {
  getDispatchSaveLog,
  listDispatchSaveLogs,
  markDispatchSavePrinted,
  outcomeLabel,
  previewDispatchSaveUndo,
  saveModeLabel,
  undoDispatchSave,
  undoStatusLabel,
  type DispatchSaveLogDetail,
  type DispatchSaveLogSummary,
  type DispatchUndoPreview,
} from '../../lib/shipping/dailyLedgerDispatchSaveGateway';
import type { Branch, Driver } from '../../types';

function fmtMoney(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtWeightKg(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  const tons = n / 1000;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} كغ (${tons.toLocaleString('en-US', { maximumFractionDigits: 3 })} طن)`;
}

function fmtDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const ymd = match?.[1] ?? raw;
  try {
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('ar-SY', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return ymd;
  }
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-SY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function isUndoableRow(row: DispatchSaveLogSummary): boolean {
  return Boolean(row.can_undo) && !row.cancelled_at && row.undo_status !== 'undone';
}

function undoDisabledReason(row: DispatchSaveLogSummary): string {
  if (row.cancelled_at || row.undo_status === 'undone') return 'تم إلغاء هذا الحفظ مسبقاً';
  if (row.operation_id && row.undo_status === 'not_undoable') return 'عملية الحفظ غير مكتملة — لا يمكن الإلغاء';
  if (!row.operation_id) return 'هذا السجل سابق لنظام الاستعادة — الإلغاء متاح للحفظ الجديد فقط';
  return 'غير قابل للإلغاء حالياً';
}

type Props = {
  open: boolean;
  onClose: () => void;
  defaultBranchId?: string;
  defaultDateFrom?: string;
  defaultDateTo?: string;
  onReprint: (detail: DispatchSaveLogDetail) => Promise<void>;
  onUndone?: () => void;
};

export default function QuickLedgerDispatchSaveLogPanel({
  open,
  onClose,
  defaultBranchId,
  defaultDateFrom,
  defaultDateTo,
  onReprint,
  onUndone,
}: Props) {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(
    defaultDateFrom ?? new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(defaultDateTo ?? new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState(defaultBranchId ?? '');
  const [driverId, setDriverId] = useState('');
  const [destination, setDestination] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rows, setRows] = useState<DispatchSaveLogSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DispatchSaveLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoConfirmId, setUndoConfirmId] = useState<string | null>(null);
  const [undoPreview, setUndoPreview] = useState<DispatchUndoPreview | null>(null);
  const [undoPreviewLoading, setUndoPreviewLoading] = useState(false);
  const [undoReason, setUndoReason] = useState('');

  useEffect(() => {
    if (!open) return;
    if (defaultBranchId) setBranchId(defaultBranchId);
    if (defaultDateFrom) setDateFrom(defaultDateFrom);
    if (defaultDateTo) setDateTo(defaultDateTo);
  }, [open, defaultBranchId, defaultDateFrom, defaultDateTo]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([phase15Gateway.branches.getAll(), phase15Gateway.drivers.getAll()])
      .then(([branchRows, driverRows]) => {
        setBranches(branchRows);
        setDrivers(driverRows.filter((d) => d.isActive));
      })
      .catch(() => {
        setBranches([]);
        setDrivers([]);
      });
  }, [open]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDispatchSaveLogs({
        dateFrom,
        dateTo,
        branchId: branchId || undefined,
        driverId: driverId || undefined,
        destination: destination.trim() || undefined,
        searchQuery: searchQuery.trim() || undefined,
        limit: 200,
      });
      setRows(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل سجل الإرساليات', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, dateFrom, dateTo, destination, driverId, searchQuery, showToast]);

  useEffect(() => {
    if (!open) return;
    void loadRows();
  }, [open, loadRows]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const data = await getDispatchSaveLog(id);
      setDetail(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل التفاصيل', 'error');
      setSelectedId(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const closeUndoConfirm = () => {
    setUndoConfirmId(null);
    setUndoPreview(null);
    setUndoReason('');
    setUndoPreviewLoading(false);
  };

  const openUndoConfirm = async (row: DispatchSaveLogSummary, event: MouseEvent) => {
    event.stopPropagation();
    if (!isUndoableRow(row) || undoingId) return;
    setUndoConfirmId(row.id);
    setUndoPreview(null);
    setUndoReason('');
    setUndoPreviewLoading(true);
    try {
      const preview = await previewDispatchSaveUndo(row.id);
      setUndoPreview(preview);
      if (!preview.undoable) {
        showToast(preview.reason || 'لا يمكن إلغاء هذا الحفظ', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر معاينة الإلغاء', 'error');
      closeUndoConfirm();
    } finally {
      setUndoPreviewLoading(false);
    }
  };

  const handleConfirmUndo = async () => {
    if (!undoConfirmId || !undoPreview?.undoable) return;
    setUndoingId(undoConfirmId);
    try {
      const result = await undoDispatchSave(undoConfirmId, {
        reason: undoReason.trim() || null,
      });
      showToast(`تم إلغاء الحفظ واستعادة ${result.restoredRows} سطر`, 'success');
      closeUndoConfirm();
      await loadRows();
      if (selectedId === undoConfirmId) {
        const refreshed = await getDispatchSaveLog(undoConfirmId);
        setDetail(refreshed);
      }
      onUndone?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر إلغاء حفظ الإرسالية', 'error');
    } finally {
      setUndoingId(null);
    }
  };

  const handleReprint = async () => {
    if (!detail) return;
    setReprinting(true);
    try {
      await onReprint(detail);
      await markDispatchSavePrinted(detail.id, {});
      const refreshed = await getDispatchSaveLog(detail.id);
      setDetail(refreshed);
      setRows((prev) =>
        prev.map((row) =>
          row.id === detail.id
            ? {
                ...row,
                printed_at: refreshed.printed_at,
                print_count: refreshed.print_count,
              }
            : row,
        ),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر إعادة الطباعة', 'error');
    } finally {
      setReprinting(false);
    }
  };

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.logs += 1;
          acc.lines += row.row_count;
          acc.pieces += row.pieces_count;
          acc.weightKg += Number(row.weight_kg) || 0;
          acc.collect += Number(row.collect_total_usd) || 0;
          return acc;
        },
        { logs: 0, lines: 0, pieces: 0, weightKg: 0, collect: 0 },
      ),
    [rows],
  );

  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="quick-ledger-dispatch-save-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-save-log-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-ledger-dispatch-dialog-header">
          <div>
            <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
            <h3 id="dispatch-save-log-title">سجل حفظ إرساليات</h3>
            <p className="quick-ledger-dispatch-dialog-sub">
              مرجع للمدير والمحاسبة — وجهات، مبالغ، أوزان، إيصالات، وحالة الطباعة.
            </p>
          </div>
          <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>

        <div className="quick-ledger-dispatch-save-log-body">
          <section className="quick-ledger-dispatch-save-log-filters">
            <label>
              <span>من</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              <span>إلى</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label>
              <span>الفرع</span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">كل الفروع</option>
                {branches.map((branch) => {
                  const backendId = getBackendIdFromSynthetic(branch.id);
                  return backendId ? (
                    <option key={branch.id} value={backendId}>
                      {branch.name}
                    </option>
                  ) : null;
                })}
              </select>
            </label>
            <label>
              <span>السائق</span>
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">كل السائقين</option>
                {drivers.map((driver) => {
                  const backendId = getBackendIdFromSynthetic(driver.id);
                  return backendId ? (
                    <option key={driver.id} value={backendId}>
                      {driver.name}
                    </option>
                  ) : null;
                })}
              </select>
            </label>
            <label>
              <span>الجهة</span>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="مثال: الرقة" />
            </label>
            <label className="quick-ledger-dispatch-save-log-search">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="إيصال، سائق، ملخص..."
              />
            </label>
            <button type="button" onClick={() => void loadRows()} disabled={loading}>
              {loading ? 'جاري التحميل...' : 'تحديث'}
            </button>
          </section>

          <section className="quick-ledger-dispatch-save-log-stats">
            <div><strong>{totals.logs}</strong><span>إرساليات</span></div>
            <div><strong>{totals.lines}</strong><span>أسطر</span></div>
            <div><strong>{totals.pieces}</strong><span>طرود</span></div>
            <div><strong>{fmtWeightKg(totals.weightKg)}</strong><span>وزن</span></div>
            <div><strong>{fmtMoney(totals.collect)} $</strong><span>تحصيل</span></div>
          </section>

          <div className="quick-ledger-dispatch-save-log-layout">
            <div className="quick-ledger-dispatch-save-log-list-wrap">
              <table className="quick-ledger-dispatch-save-log-table">
                <thead>
                  <tr>
                    <th>إرسالية</th>
                    <th>التاريخ</th>
                    <th>السائق / المركبة</th>
                    <th>الوجهات</th>
                    <th>أسطر / طرود / وزن</th>
                    <th>تحصيل / مسبق / حوالة</th>
                    <th>الحفظ</th>
                    <th>الطباعة</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="quick-ledger-dispatch-save-log-empty">
                        {loading ? 'جاري التحميل...' : 'لا توجد سجلات في هذا النطاق.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const undoable = isUndoableRow(row);
                      const busy = undoingId === row.id;
                      return (
                        <tr
                          key={row.id}
                          className={selectedId === row.id ? 'is-selected' : ''}
                          onClick={() => void openDetail(row.id)}
                        >
                          <td>
                            <strong>{row.dispatch_no != null ? `#${row.dispatch_no}` : '—'}</strong>
                            <span className="quick-ledger-dispatch-save-log-mode">{saveModeLabel(row.save_mode)}</span>
                          </td>
                          <td>{fmtDate(row.ledger_date)}</td>
                          <td>
                            <div>{row.driver_label || '—'}</div>
                            <div className="quick-ledger-dispatch-save-log-muted">{row.vehicle_label || '—'}</div>
                          </td>
                          <td>{row.destination_label || '—'}</td>
                          <td>
                            {row.row_count} / {row.pieces_count}
                            <div className="quick-ledger-dispatch-save-log-muted">{fmtWeightKg(row.weight_kg)}</div>
                          </td>
                          <td>
                            {fmtMoney(row.collect_total_usd)} / {fmtMoney(row.prepaid_total_usd)} / {fmtMoney(row.hawala_total_usd)}
                          </td>
                          <td>
                            <div>{row.saved_by_name || row.saved_by_username || '—'}</div>
                            <div className="quick-ledger-dispatch-save-log-muted">{fmtDateTime(row.saved_at)}</div>
                            <span className={`quick-ledger-dispatch-save-log-outcome is-${row.outcome ?? 'none'}`}>
                              {outcomeLabel(row.outcome)}
                            </span>
                            {(row.cancelled_at || row.undo_status) && (
                              <div className={`quick-ledger-dispatch-save-log-undo-status is-${row.undo_status ?? 'none'}`}>
                                {undoStatusLabel(row)}
                              </div>
                            )}
                          </td>
                          <td>
                            {row.printed_at ? (
                              <>
                                <span className="quick-ledger-dispatch-save-log-printed">طُبعت</span>
                                <div className="quick-ledger-dispatch-save-log-muted">
                                  {fmtDateTime(row.printed_at)}
                                  {row.print_count > 1 ? ` (${row.print_count}×)` : ''}
                                </div>
                              </>
                            ) : (
                              <span className="quick-ledger-dispatch-save-log-not-printed">لم تُطبع</span>
                            )}
                          </td>
                          <td className="quick-ledger-dispatch-save-log-actions-cell">
                            <button
                              type="button"
                              className="quick-ledger-dispatch-save-log-undo-btn"
                              disabled={!undoable || Boolean(undoingId)}
                              title={undoable ? 'إلغاء حفظ الإرسالية واستعادة الأسطر' : undoDisabledReason(row)}
                              onClick={(event) => void openUndoConfirm(row, event)}
                            >
                              <RotateCcw size={14} />
                              {busy ? 'جاري...' : 'إلغاء'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <aside className="quick-ledger-dispatch-save-log-detail">
              {!selectedId ? (
                <div className="quick-ledger-dispatch-save-log-detail-empty">
                  <FileText size={32} />
                  <p>اضغط على سطر لعرض تفاصيل الإرسالية والإيصالات.</p>
                </div>
              ) : detailLoading ? (
                <p>جاري تحميل التفاصيل...</p>
              ) : detail ? (
                <>
                  <div className="quick-ledger-dispatch-save-log-detail-header">
                    <h4>
                      إرسالية {detail.dispatch_no != null ? `#${detail.dispatch_no}` : '—'} — {fmtDate(detail.ledger_date)}
                    </h4>
                    <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={closeDetail} aria-label="إغلاق التفاصيل">
                      <X size={18} />
                    </button>
                  </div>
                  <dl className="quick-ledger-dispatch-save-log-meta">
                    <div><dt>الخط</dt><dd>{detail.line_label || '—'}</dd></div>
                    <div><dt>السائق</dt><dd>{detail.driver_label || '—'}</dd></div>
                    <div><dt>المركبة</dt><dd>{detail.vehicle_label || '—'}</dd></div>
                    <div><dt>الوجهات</dt><dd>{detail.destination_label || '—'}</dd></div>
                    <div><dt>التحصيل</dt><dd>{fmtMoney(detail.collect_total_usd)} $</dd></div>
                    <div><dt>مسبق</dt><dd>{fmtMoney(detail.prepaid_total_usd)} $</dd></div>
                    <div><dt>حوالة</dt><dd>{fmtMoney(detail.hawala_total_usd)} $</dd></div>
                    <div><dt>رسوم</dt><dd>{fmtMoney(detail.transfer_fee_total_usd)} $</dd></div>
                    <div><dt>الترحيل</dt><dd>{detail.posted_count} مُرحَّل · {detail.error_count} خطأ · {detail.skipped_count} تُخطّى</dd></div>
                    <div><dt>حُفظ بواسطة</dt><dd>{detail.saved_by_name || detail.saved_by_username || '—'} — {fmtDateTime(detail.saved_at)}</dd></div>
                    <div><dt>حالة الإلغاء</dt><dd>{undoStatusLabel(detail)}</dd></div>
                    {detail.cancellation_reason ? (
                      <div><dt>سبب الإلغاء</dt><dd>{detail.cancellation_reason}</dd></div>
                    ) : null}
                    {detail.summary ? (
                      <div className="quick-ledger-dispatch-save-log-summary"><dt>الملخص</dt><dd>{detail.summary}</dd></div>
                    ) : null}
                  </dl>
                  <div className="quick-ledger-dispatch-save-log-detail-actions">
                    <button type="button" className="primary" onClick={() => void handleReprint()} disabled={reprinting}>
                      <Printer size={16} />
                      {reprinting ? 'جاري الطباعة...' : 'إعادة طباعة'}
                    </button>
                    <button
                      type="button"
                      className="quick-ledger-dispatch-save-log-undo-btn"
                      disabled={!isUndoableRow(detail) || Boolean(undoingId)}
                      title={isUndoableRow(detail) ? 'إلغاء حفظ الإرسالية' : undoDisabledReason(detail)}
                      onClick={(event) => void openUndoConfirm(detail, event)}
                    >
                      <RotateCcw size={16} />
                      {undoingId === detail.id ? 'جاري الإلغاء...' : 'إلغاء الحفظ'}
                    </button>
                  </div>
                  <div className="quick-ledger-dispatch-save-log-receipts">
                    <h5>قائمة الإيصالات ({detail.rows_snapshot?.length ?? 0})</h5>
                    <table>
                      <thead>
                        <tr>
                          <th>إيصال</th>
                          <th>جهة</th>
                          <th>طرود</th>
                          <th>وزن</th>
                          <th>تحصيل</th>
                          <th>مرسل / مستلم</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.rows_snapshot ?? []).map((row) => (
                          <tr key={row.rowId}>
                            <td>{row.receiptNo || '—'}</td>
                            <td>{row.destination || '—'}</td>
                            <td>{row.parcelCount ?? '—'}</td>
                            <td>{row.weightKg || '—'}</td>
                            <td>{fmtMoney(row.collectAmountUsd)}</td>
                            <td>{row.senderName || '—'} / {row.receiverName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        </div>

        {undoConfirmId ? (
          <div
            className="quick-ledger-dispatch-undo-confirm-backdrop"
            role="presentation"
            onClick={closeUndoConfirm}
          >
            <div
              className="quick-ledger-dispatch-undo-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dispatch-undo-confirm-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <h4 id="dispatch-undo-confirm-title">تأكيد إلغاء حفظ الإرسالية</h4>
                <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={closeUndoConfirm} aria-label="إغلاق">
                  <X size={18} />
                </button>
              </header>
              {undoPreviewLoading ? (
                <p>جاري معاينة الآثار...</p>
              ) : undoPreview ? (
                <>
                  {!undoPreview.undoable ? (
                    <p className="quick-ledger-dispatch-undo-blocker">
                      {undoPreview.reason || 'لا يمكن إلغاء هذا الحفظ.'}
                    </p>
                  ) : (
                    <>
                      <p>
                        سيتم إعادة الأسطر إلى مواضعها الأصلية وعكس الآثار المالية المرتبطة بهذا الحفظ فقط.
                      </p>
                      <ul className="quick-ledger-dispatch-undo-stats">
                        <li><strong>{undoPreview.rowCount}</strong> أسطر</li>
                        <li><strong>{undoPreview.shipmentCount}</strong> شحنات</li>
                        <li><strong>{undoPreview.createdShipmentCount}</strong> شحنات أُنشئت</li>
                        <li><strong>{undoPreview.movementCount}</strong> حركات مالية</li>
                        <li><strong>{undoPreview.transferCount}</strong> حوالات</li>
                      </ul>
                      <label className="quick-ledger-dispatch-undo-reason">
                        <span>سبب الإلغاء (اختياري)</span>
                        <textarea
                          value={undoReason}
                          onChange={(e) => setUndoReason(e.target.value)}
                          rows={3}
                          maxLength={500}
                          placeholder="مثال: حفظ بتاريخ خاطئ"
                        />
                      </label>
                    </>
                  )}
                  <div className="quick-ledger-dispatch-undo-confirm-actions">
                    <button type="button" onClick={closeUndoConfirm} disabled={Boolean(undoingId)}>
                      رجوع
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={!undoPreview.undoable || Boolean(undoingId)}
                      onClick={() => void handleConfirmUndo()}
                    >
                      {undoingId ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
