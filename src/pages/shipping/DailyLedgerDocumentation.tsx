import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, FileText, X, Printer, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthProvider';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  deletePrintDocumentation,
  getPrintDocumentation,
  listPrintDocumentation,
  printTypeLabel,
  type PrintDocumentationDetail,
  type PrintDocumentationSummary,
} from '../../lib/shipping/dailyLedgerDocumentationGateway';
import {
  buildDocumentationDetailPrintHtml,
  buildDocumentationListPrintHtml,
  exportDocumentationPdf,
  printDocumentationHtml,
} from '../../lib/shipping/dailyLedgerDocumentationPrint';
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

function normalizeLedgerYmd(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
}

function fmtDate(value: string | null | undefined): string {
  const ymd = normalizeLedgerYmd(value);
  if (!ymd) return '—';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('ar-SY', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return ymd;
  }
}

function fmtDateTime(value: string): string {
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

export default function DailyLedgerDocumentation() {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canDeleteDocumentation = hasPermission('shipments.write');
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [destination, setDestination] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rows, setRows] = useState<PrintDocumentationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrintDocumentationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([phase15Gateway.branches.getAll(), phase15Gateway.drivers.getAll()])
      .then(([branchRows, driverRows]) => {
        setBranches(branchRows);
        setDrivers(driverRows.filter((d) => d.isActive));
      })
      .catch(() => {
        setBranches([]);
        setDrivers([]);
      });
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPrintDocumentation({
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
      showToast(error instanceof Error ? error.message : 'تعذر تحميل التوثيق', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, dateFrom, dateTo, destination, driverId, searchQuery, showToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const data = await getPrintDocumentation(id);
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

  const deleteDocument = async (doc: PrintDocumentationSummary) => {
    if (!canDeleteDocumentation) {
      showToast('لا تملك صلاحية حذف سجلات التوثيق', 'error');
      return;
    }
    const label = [
      fmtDate(doc.ledger_date),
      doc.driver_label || '',
      doc.destination_label || doc.search_query || '',
      printTypeLabel(doc.print_type),
    ]
      .filter(Boolean)
      .join(' — ');
    if (!window.confirm(`حذف سجل التوثيق هذا نهائياً؟\n\n${label}`)) return;

    setDeletingId(doc.id);
    try {
      await deletePrintDocumentation(doc.id);
      setRows((prev) => prev.filter((row) => row.id !== doc.id));
      if (selectedId === doc.id) closeDetail();
      showToast('تم حذف سجل التوثيق', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حذف سجل التوثيق', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const printList = async () => {
    if (!rows.length) {
      showToast('لا توجد وثائق للطباعة', 'info');
      return;
    }
    try {
      const html = buildDocumentationListPrintHtml(rows, { dateFrom, dateTo });
      const result = await printDocumentationHtml(html);
      if (result === 'queued') showToast('تم إرسال الطباعة', 'success');
      else if (result === 'browser') showToast('تم فتح معاينة الطباعة', 'success');
      else showToast('تعذر تنفيذ الطباعة', 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر الطباعة', 'error');
    }
  };

  const exportListPdf = async () => {
    if (!rows.length) {
      showToast('لا توجد وثائق للتصدير', 'info');
      return;
    }
    setExporting(true);
    try {
      const html = buildDocumentationListPrintHtml(rows, { dateFrom, dateTo });
      await exportDocumentationPdf({
        title: `توثيق دفتر الشحن — ${dateFrom} — ${dateTo}`,
        html,
        defaultFileName: `ledger-documentation-${dateFrom}-${dateTo}.pdf`,
      });
      showToast('تم تصدير PDF', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تصدير PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  const printDetail = async (doc: PrintDocumentationDetail) => {
    try {
      const html = buildDocumentationDetailPrintHtml(doc);
      const result = await printDocumentationHtml(html);
      if (result === 'queued') showToast('تم إرسال الطباعة', 'success');
      else if (result === 'browser') showToast('تم فتح معاينة الطباعة', 'success');
      else showToast('تعذر تنفيذ الطباعة', 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر الطباعة', 'error');
    }
  };

  const exportDetailPdf = async (doc: PrintDocumentationDetail) => {
    setExporting(true);
    try {
      const html = buildDocumentationDetailPrintHtml(doc);
      const safeDate = doc.ledger_date.replace(/[\\/:*?"<>|]+/g, '-');
      const safeDest = (doc.destination_label || doc.search_query || 'doc').replace(/[\\/:*?"<>|]+/g, '-');
      await exportDocumentationPdf({
        title: doc.title || `توثيق — ${safeDest}`,
        html,
        defaultFileName: `ledger-documentation-${safeDate}-${safeDest}.pdf`,
      });
      showToast('تم تصدير PDF', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تصدير PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.documents += 1;
          acc.lines += row.row_count;
          acc.pieces += row.pieces_count;
          acc.weightKg += Number(row.weight_kg) || 0;
          acc.collect += Number(row.collect_total_usd) || 0;
          return acc;
        },
        { documents: 0, lines: 0, pieces: 0, weightKg: 0, collect: 0 },
      ),
    [rows],
  );

  return (
    <div className="page-shell documentation-page" dir="rtl">
      <header className="page-header">
        <div>
          <h1>التوثيق</h1>
          <p className="page-subtitle">
            أرشيف طباعة دفتر الشحن اليومي — مرجع للمحاسب والمدير حسب السائق والجهة والتاريخ.
          </p>
        </div>
        <div className="documentation-header-actions">
          <button type="button" onClick={() => void loadRows()} disabled={loading || exporting}>
            {loading ? 'جاري التحديث...' : 'تحديث'}
          </button>
          <button type="button" onClick={() => void printList()} disabled={loading || exporting || !rows.length}>
            <Printer size={16} />
            طباعة
          </button>
          <button type="button" className="primary" onClick={() => void exportListPdf()} disabled={loading || exporting || !rows.length}>
            {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
          </button>
        </div>
      </header>

      <section className="documentation-filters card-panel">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <label className="form-group block">
            <span className="form-label">من تاريخ</span>
            <input className="form-input w-full" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="form-group block">
            <span className="form-label">إلى تاريخ</span>
            <input className="form-input w-full" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="form-group block">
            <span className="form-label">الفرع</span>
            <select className="form-select w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
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
          <label className="form-group block">
            <span className="form-label">السائق</span>
            <select className="form-select w-full" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">كل السائقين</option>
              {drivers.map((driver) => {
                const backendId = getBackendIdFromSynthetic(driver.id);
                return backendId ? (
                  <option key={driver.id} value={backendId}>
                    {driver.code ? `${driver.code} — ` : ''}{driver.name}
                  </option>
                ) : null;
              })}
            </select>
          </label>
          <label className="form-group block">
            <span className="form-label">الجهة</span>
            <input
              className="form-input w-full"
              placeholder="مثال: منبج"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <label className="form-group block">
            <span className="form-label">بحث</span>
            <div className="documentation-search">
              <Search size={16} />
              <input
                className="form-input w-full"
                placeholder="سائق، جهة، عنوان..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </label>
        </div>
      </section>

      <section className="documentation-stats">
        <div><strong>{totals.documents}</strong><span>وثائق</span></div>
        <div><strong>{totals.lines}</strong><span>أسطر</span></div>
        <div><strong>{totals.pieces}</strong><span>طرود</span></div>
        <div><strong>{fmtWeightKg(totals.weightKg)}</strong><span>الوزن</span></div>
        <div><strong>{fmtMoney(totals.collect)} $</strong><span>تحصيل</span></div>
      </section>

      <section className="card-panel documentation-table-wrap">
        {loading ? (
          <p>جاري تحميل التوثيق...</p>
        ) : rows.length === 0 ? (
          <p className="documentation-empty">لا توجد وثائق مطابقة — ستُحفظ تلقائياً عند الطباعة من دفتر الشحن.</p>
        ) : (
          <table className="documentation-table">
            <thead>
              <tr>
                <th>تاريخ الدفتر</th>
                <th>السائق</th>
                <th>الجهة</th>
                <th>النوع</th>
                <th>أسطر</th>
                <th>طرود</th>
                <th>تحصيل $</th>
                <th>طُبع في</th>
                <th>بواسطة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {fmtDate(row.ledger_date)}
                    {row.ledger_date_to && row.ledger_date_to !== row.ledger_date
                      ? ` — ${fmtDate(row.ledger_date_to)}`
                      : ''}
                  </td>
                  <td>{row.driver_label || '—'}</td>
                  <td>{row.destination_label || row.search_query || '—'}</td>
                  <td>{printTypeLabel(row.print_type)}</td>
                  <td>{row.row_count}</td>
                  <td>{row.pieces_count}</td>
                  <td>{fmtMoney(row.collect_total_usd)}</td>
                  <td>{fmtDateTime(row.printed_at)}</td>
                  <td>{row.printed_by_name || row.printed_by_username || '—'}</td>
                  <td>
                    <div className="documentation-row-actions">
                      <button type="button" className="linkish" onClick={() => void openDetail(row.id)}>
                        <FileText size={14} />
                        تفاصيل
                      </button>
                      {canDeleteDocumentation ? (
                        <button
                          type="button"
                          className="linkish documentation-delete-btn"
                          onClick={() => void deleteDocument(row)}
                          disabled={deletingId === row.id}
                          title="حذف سجل التوثيق"
                        >
                          <Trash2 size={14} />
                          {deletingId === row.id ? 'جاري الحذف...' : 'حذف'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedId ? (
        <div className="quick-ledger-confirm documentation-detail-dialog" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel documentation-detail-panel">
            <div className="documentation-detail-header">
              <h3>تفاصيل التوثيق</h3>
              <div className="documentation-header-actions">
                {detail && !detailLoading ? (
                  <>
                    <button type="button" onClick={() => void printDetail(detail)} disabled={exporting}>
                      <Printer size={16} />
                      طباعة
                    </button>
                    <button type="button" className="primary" onClick={() => void exportDetailPdf(detail)} disabled={exporting}>
                      {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
                    </button>
                    {canDeleteDocumentation ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteDocument(detail)}
                        disabled={deletingId === detail.id}
                      >
                        <Trash2 size={16} />
                        {deletingId === detail.id ? 'جاري الحذف...' : 'حذف'}
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button type="button" onClick={closeDetail} aria-label="إغلاق">
                  <X size={18} />
                </button>
              </div>
            </div>
            {detailLoading || !detail ? (
              <p>جاري تحميل التفاصيل...</p>
            ) : (
              <>
                <div className="documentation-detail-meta">
                  <span><strong>العنوان:</strong> {detail.title || '—'}</span>
                  <span><strong>تاريخ الدفتر:</strong> {fmtDate(detail.ledger_date)}</span>
                  <span><strong>السائق:</strong> {detail.driver_label || '—'}</span>
                  <span><strong>الجهة:</strong> {detail.destination_label || detail.search_query || '—'}</span>
                  <span><strong>الفرع:</strong> {detail.branch_name || '—'}</span>
                  <span><strong>الخط:</strong> {detail.line_label || '—'}</span>
                  <span><strong>أسطر:</strong> {detail.row_count}</span>
                  <span><strong>طرود:</strong> {detail.pieces_count}</span>
                  <span><strong>وزن:</strong> {fmtWeightKg(detail.weight_kg)}</span>
                  <span><strong>تحصيل:</strong> {fmtMoney(detail.collect_total_usd)} $</span>
                  <span><strong>مسبق:</strong> {fmtMoney(detail.prepaid_total_usd)} $</span>
                  <span><strong>حوالة:</strong> {fmtMoney(detail.hawala_total_usd)} $</span>
                  <span><strong>أجرة حوالة:</strong> {fmtMoney(detail.transfer_fee_total_usd)} $</span>
                  <span><strong>طُبع:</strong> {fmtDateTime(detail.printed_at)}</span>
                  <span><strong>بواسطة:</strong> {detail.printed_by_name || detail.printed_by_username || '—'}</span>
                </div>
                <div className="documentation-detail-table-wrap">
                  <table className="documentation-table documentation-detail-table">
                    <thead>
                      <tr>
                        <th>نوع البضاعة</th>
                        <th>عدد</th>
                        <th>وزن</th>
                        <th>تحصيل</th>
                        <th>حوالة</th>
                        <th>أجرة</th>
                        <th>مسبق</th>
                        <th>مرسل</th>
                        <th>مستلم</th>
                        <th>الجهة</th>
                        <th>إيصال</th>
                        <th>ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.rows_snapshot ?? []).map((row) => (
                        <tr key={row.rowId}>
                          <td>{row.parcelType || '—'}</td>
                          <td>{row.parcelCount ?? '—'}</td>
                          <td>{row.weightKg || '—'}</td>
                          <td>{fmtMoney(row.collectAmountUsd)}</td>
                          <td>{fmtMoney(row.hawalaAmountUsd)}</td>
                          <td>{fmtMoney(row.transferServiceFeeUsd)}</td>
                          <td>{fmtMoney(row.prepaidAmountUsd)}</td>
                          <td>{row.senderName || '—'}</td>
                          <td>{row.receiverName || '—'}</td>
                          <td>{row.destination || '—'}</td>
                          <td>{row.receiptNo || '—'}</td>
                          <td>{row.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
