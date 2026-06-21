import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, X, ArrowRight } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  getPrintDocumentation,
  listPrintDocumentation,
  printTypeLabel,
  type PrintDocumentationDetail,
  type PrintDocumentationSummary,
} from '../../lib/shipping/dailyLedgerDocumentationGateway';
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

function fmtDate(value: string): string {
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString('ar-SY', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
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
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrintDocumentationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
          <button type="button" className="linkish documentation-back" onClick={() => navigate('/shipment-quick-ledger')}>
            <ArrowRight size={16} />
            العودة إلى دفتر الشحن اليومي
          </button>
          <h1>التوثيق</h1>
          <p className="page-subtitle">
            أرشيف طباعة دفتر الشحن اليومي — مرجع للمحاسب والمدير حسب السائق والجهة والتاريخ.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => void loadRows()} disabled={loading}>
          {loading ? 'جاري التحديث...' : 'تحديث'}
        </button>
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
                <th>تاريخ الشحن</th>
                <th>السائق</th>
                <th>الجهة</th>
                <th>النوع</th>
                <th>أسطر</th>
                <th>طرود</th>
                <th>تحصيل $</th>
                <th>طُبع في</th>
                <th>بواسطة</th>
                <th></th>
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
                    <button type="button" className="linkish" onClick={() => void openDetail(row.id)}>
                      <FileText size={14} />
                      تفاصيل
                    </button>
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
              <button type="button" onClick={closeDetail} aria-label="إغلاق">
                <X size={18} />
              </button>
            </div>
            {detailLoading || !detail ? (
              <p>جاري تحميل التفاصيل...</p>
            ) : (
              <>
                <div className="documentation-detail-meta">
                  <span><strong>العنوان:</strong> {detail.title || '—'}</span>
                  <span><strong>التاريخ:</strong> {fmtDate(detail.ledger_date)}</span>
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
                        <th>إيصال</th>
                        <th>الجهة</th>
                        <th>نوع الطرود</th>
                        <th>عدد</th>
                        <th>وزن</th>
                        <th>مرسل</th>
                        <th>مستلم</th>
                        <th>تحصيل</th>
                        <th>مسبق</th>
                        <th>حوالة</th>
                        <th>أجرة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.rows_snapshot ?? []).map((row) => (
                        <tr key={row.rowId}>
                          <td>{row.receiptNo || '—'}</td>
                          <td>{row.destination || '—'}</td>
                          <td>{row.parcelType || '—'}</td>
                          <td>{row.parcelCount ?? '—'}</td>
                          <td>{row.weightKg || '—'}</td>
                          <td>{row.senderName || '—'}</td>
                          <td>{row.receiverName || '—'}</td>
                          <td>{fmtMoney(row.collectAmountUsd)}</td>
                          <td>{fmtMoney(row.prepaidAmountUsd)}</td>
                          <td>{fmtMoney(row.hawalaAmountUsd)}</td>
                          <td>{fmtMoney(row.transferServiceFeeUsd)}</td>
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
