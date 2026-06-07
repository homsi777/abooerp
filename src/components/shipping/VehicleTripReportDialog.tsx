import { useEffect, useMemo, useState } from 'react';
import { Truck, X } from 'lucide-react';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { centersGateway, type ProvincialInboundRow, type VehicleTripReportMeta } from '../../lib/api/centersGateway';
import { downloadCsv } from '../../lib/export/csvDownload';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../../lib/shipments/shipmentStatus';
import {
  computeProvincialTotals,
  formatWeightTotal,
  groupProvincialByAgent,
} from '../../lib/shipping/provincialInboundTotals';
import type { Driver } from '../../types';

type Props = {
  open: boolean;
  defaultDate: string;
  onClose: () => void;
};

export default function VehicleTripReportDialog({ open, defaultDate, onClose }: Props) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState(0);
  const [reportDate, setReportDate] = useState(defaultDate);
  const [rows, setRows] = useState<ProvincialInboundRow[]>([]);
  const [meta, setMeta] = useState<VehicleTripReportMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReportDate(defaultDate);
    setLoaded(false);
    setRows([]);
    setMeta(null);
    setError('');
    void phase15Gateway.drivers.getAll().then(setDrivers).catch(() => setDrivers([]));
  }, [open, defaultDate]);

  const selectedDriver = drivers.find((d) => d.id === driverId);
  const totals = useMemo(() => computeProvincialTotals(rows), [rows]);
  const agentTotals = useMemo(() => groupProvincialByAgent(rows), [rows]);

  const loadReport = async () => {
    const backendDriverId = driverId ? getBackendIdFromSynthetic(driverId) : null;
    if (!backendDriverId) {
      setError('يرجى اختيار السائق.');
      return;
    }
    if (!reportDate) {
      setError('يرجى اختيار التاريخ.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await centersGateway.getVehicleTripReport({
        date: reportDate,
        driverId: backendDriverId,
      });
      setRows(data.rows);
      setMeta(data.meta);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تقرير السيارة');
      setRows([]);
      setMeta(null);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const driverName = selectedDriver?.name ?? 'سائق';
    downloadCsv(
      `vehicle-report-${driverName}-${reportDate}.csv`,
      [
        'تاريخ الدفتر',
        'رقم الوصل',
        'الوجهة',
        'المحافظة',
        'الوكيل',
        'نوع الطرد',
        'عدد',
        'وزن',
        'تحصيل',
        'مسبق',
        'حوالة',
        'أجرة حوالة',
        'الحالة',
        'السيارة',
      ],
      rows
        .map((row) => [
          row.ledgerDate ?? String(row.shipmentCreatedAt).split('T')[0],
          row.ledgerReceiptNo ?? row.shipmentNo,
          row.ledgerDestination ?? '—',
          row.operationalCenter,
          row.agentName ?? '—',
          row.parcelType ?? '—',
          row.parcelCount ?? '',
          row.weightKg ?? '',
          row.collectAmount,
          row.prepaidAmount,
          row.hawalaAmount,
          row.transferServiceFee,
          shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)),
          row.vehicleLabel ?? '—',
        ])
        .concat([
          [
            'المجاميع',
            '',
            '',
            '',
            '',
            '',
            totals.parcelCount,
            totals.weightKg,
            totals.collectAmount,
            totals.prepaidAmount,
            totals.hawalaAmount,
            totals.transferServiceFee,
            '',
            '',
          ],
        ]),
    );
  };

  if (!open) return null;

  return (
    <div className="quick-ledger-confirm vehicle-report-dialog no-print" role="dialog" aria-modal="true">
      <div className="vehicle-report-panel">
        <div className="vehicle-report-header">
          <div className="vehicle-report-title-wrap">
            <Truck size={22} aria-hidden="true" />
            <h3>تقرير سيارة — حسب السائق والتاريخ</h3>
          </div>
          <button type="button" className="quick-ledger-save-progress-close" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <p className="vehicle-report-intro">
          يقرأ مباشرة من <strong>دفتر الإدخال السريع</strong> (كل الأسطر المحفوظة للسائق في اليوم) — وليس فقط الشحنات
          المفتوحة في «استلام المحافظات»، لذلك يطابق عدد الدفتر بدقة أكبر.
        </p>

        <div className="vehicle-report-filters">
          <div className="form-group">
            <label className="form-label">السائق *</label>
            <select
              className="form-select"
              value={driverId || ''}
              onChange={(e) => setDriverId(Number(e.target.value) || 0)}
            >
              <option value="">— اختر السائق —</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">التاريخ *</label>
            <input
              className="form-input"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>
          <button type="button" className="toolbar-btn primary" onClick={() => void loadReport()} disabled={loading}>
            {loading ? 'جاري التحميل...' : 'عرض التقرير'}
          </button>
        </div>

        {error ? <div className="text-sm text-red-700 mb-2">{error}</div> : null}

        {loaded && (
          <>
            <section className="vehicle-report-meta">
              <div><span>السائق</span><strong>{selectedDriver?.name ?? '—'}</strong></div>
              <div><span>التاريخ</span><strong>{reportDate}</strong></div>
              <div><span>السيارة</span><strong>{rows[0]?.vehicleLabel ?? '—'}</strong></div>
              <div><span>أسطر الدفتر</span><strong>{meta?.totalRows.toLocaleString() ?? totals.shipments.toLocaleString()}</strong></div>
              <div><span>مرحّلة كشحنات</span><strong>{meta?.postedRows.toLocaleString() ?? '—'}</strong></div>
              <div><span>دفتر فقط</span><strong>{meta?.ledgerOnlyRows.toLocaleString() ?? '—'}</strong></div>
            </section>

            <section className="centers-summary vehicle-report-summary">
              <div><span>عدد الطرود</span><strong>{totals.parcelCount.toLocaleString()}</strong></div>
              <div><span>مجموع الأوزان (كغ)</span><strong>{formatWeightTotal(totals.weightKg)}</strong></div>
              <div><span>تحصيل</span><strong>{totals.collectAmount.toLocaleString()}</strong></div>
              <div><span>مسبق</span><strong>{totals.prepaidAmount.toLocaleString()}</strong></div>
              <div><span>حوالات</span><strong>{totals.hawalaAmount.toLocaleString()}</strong></div>
              <div><span>أجور حوالات</span><strong>{totals.transferServiceFee.toLocaleString()}</strong></div>
            </section>

            {agentTotals.length > 0 && (
              <div className="card overflow-auto">
                <div className="card-header">مجاميع حسب الوكيل</div>
                <table className="data-grid">
                  <thead>
                    <tr>
                      <th>الوكيل</th>
                      <th>شحنات</th>
                      <th>طرود</th>
                      <th>وزن</th>
                      <th>تحصيل</th>
                      <th>مسبق</th>
                      <th>حوالة</th>
                      <th>أجرة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentTotals.map((agent) => (
                      <tr key={agent.key}>
                        <td>{agent.agentName}</td>
                        <td>{agent.shipments}</td>
                        <td>{agent.parcelCount.toLocaleString()}</td>
                        <td>{formatWeightTotal(agent.weightKg)}</td>
                        <td>{agent.collectAmount.toLocaleString()}</td>
                        <td>{agent.prepaidAmount.toLocaleString()}</td>
                        <td>{agent.hawalaAmount.toLocaleString()}</td>
                        <td>{agent.transferServiceFee.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="card overflow-auto vehicle-report-details">
              <div className="card-header">تفاصيل الشحنات</div>
              {rows.length === 0 ? (
                <p className="p-4 text-gray-500">لا توجد شحنات لهذا السائق في هذا التاريخ.</p>
              ) : (
                <table className="data-grid">
                  <thead>
                    <tr>
                      <th>وصل</th>
                      <th>وجهة</th>
                      <th>وكيل</th>
                      <th>حالة</th>
                      <th>عدد</th>
                      <th>وزن</th>
                      <th>تحصيل</th>
                      <th>مسبق</th>
                      <th>حوالة</th>
                      <th>أجرة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.shipmentId}>
                        <td>{row.ledgerReceiptNo ?? row.shipmentNo}</td>
                        <td>{row.ledgerDestination ?? row.operationalCenter}</td>
                        <td>{row.agentName ?? '—'}</td>
                        <td>{row.isPosted ? shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)) : 'دفتر فقط'}</td>
                        <td>{row.parcelCount ?? '—'}</td>
                        <td>{row.weightKg ?? '—'}</td>
                        <td>{row.collectAmount.toLocaleString()}</td>
                        <td>{row.prepaidAmount.toLocaleString()}</td>
                        <td>{row.hawalaAmount.toLocaleString()}</td>
                        <td>{row.transferServiceFee.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="vehicle-report-actions">
              <button type="button" className="toolbar-btn" onClick={exportCsv} disabled={!rows.length}>
                تصدير CSV
              </button>
              <button type="button" className="toolbar-btn" onClick={() => window.print()} disabled={!rows.length}>
                طباعة
              </button>
              <button type="button" className="toolbar-btn primary" onClick={onClose}>
                إغلاق
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
