import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck } from 'lucide-react';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { centersGateway, type ProvincialInboundRow, type VehicleTripReportMeta } from '../../lib/api/centersGateway';
import { downloadCsv } from '../../lib/export/csvDownload';
import { buildVehicleTripReportPrintHtml } from '../../lib/export/financialStatementPrint';
import FinancialStatementPrintButtons from '../../components/finance/FinancialStatementPrintButtons';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../../lib/shipments/shipmentStatus';
import {
  computeProvincialTotals,
  formatWeightTotal,
  groupProvincialByAgent,
} from '../../lib/shipping/provincialInboundTotals';
import type { Driver } from '../../types';

// "تقرير أرباح السيارة" — شاشة مالية حصراً (نُقلت من قسم المراكز بطلب
// صاحبة المشروع، لأن صافي الربح وعمولة الوكيل بيانات خاصة بالمحاسب وليست
// جزءاً من متابعة الاستلام اللوجستي). تقرأ من نفس نقطة /center-receipts/
// vehicle-trip-report — الصلاحية هناك تقبل الآن finance.read أيضاً.

export default function VehicleTripProfitReport() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState(0);
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rows, setRows] = useState<ProvincialInboundRow[]>([]);
  const [meta, setMeta] = useState<VehicleTripReportMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void phase15Gateway.drivers.getAll().then(setDrivers).catch(() => setDrivers([]));
  }, []);

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
      const data = await centersGateway.getVehicleTripReport({ date: reportDate, driverId: backendDriverId });
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
      `vehicle-profit-report-${driverName}-${reportDate}.csv`,
      [
        'تاريخ الدفتر', 'رقم الوصل', 'الوجهة', 'المحافظة', 'الوكيل', 'نوع الطرد', 'عدد', 'وزن',
        'تحصيل', 'مسبق', 'حوالة', 'أجرة حوالة', 'نسبة الوكيل', 'عمولة الوكيل', 'الصافي', 'الحالة', 'السيارة',
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
          row.agentCommissionPercentage ?? 0,
          Math.round((row.agentCommissionAmount ?? 0) * 100) / 100,
          Math.round((row.netProfit ?? 0) * 100) / 100,
          shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)),
          row.vehicleLabel ?? '—',
        ])
        .concat([
          [
            'المجاميع', '', '', '', '', '', totals.parcelCount, totals.weightKg,
            totals.collectAmount, totals.prepaidAmount, totals.hawalaAmount, totals.transferServiceFee,
            '', meta?.totalAgentCommission ?? 0, meta?.totalNetProfit ?? 0, '', '',
          ],
        ]),
    );
  };

  const buildPrintHtml = () =>
    buildVehicleTripReportPrintHtml({
      driverName: selectedDriver?.name ?? '—',
      reportDate,
      vehicleLabel: rows[0]?.vehicleLabel ?? '—',
      meta,
      totals,
      agentTotals,
      rows,
    });

  return (
    <div className="h-full flex flex-col gap-3">
      <Link to="/finance" style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af', textDecoration: 'none', width: 'fit-content' }}>
        ← الذمم والمالية
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Truck size={22} color="#4338ca" />
        </div>
        <div>
          <h1 style={{ fontSize: '19px', fontWeight: 800, color: '#111827', margin: 0 }}>تقرير أرباح السيارة</h1>
          <p style={{ fontSize: '12.5px', color: '#6b7280', margin: '2px 0 0' }}>
            صافي ربح كل رحلة حسب السائق والتاريخ — يقرأ مباشرة من دفتر الإدخال السريع
          </p>
        </div>
      </div>

      <div className="vehicle-report-formula">
        <strong>معادلة الصافي المعتمدة:</strong> عمولة الوكيل = نسبة% × (دفع مسبق + تحصيل) — الصافي = (دفع مسبق +
        تحصيل) − عمولة الوكيل − دفع مسبق + أجور الشحن + حوالة
      </div>

      <div className="card p-3" style={{ display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap' }}>
        <div className="form-group">
          <label className="form-label">السائق *</label>
          <select className="form-select" value={driverId || ''} onChange={(e) => setDriverId(Number(e.target.value) || 0)}>
            <option value="">— اختر السائق —</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>{driver.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">التاريخ *</label>
          <input className="form-input" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </div>
        <button type="button" className="toolbar-btn primary" onClick={() => void loadReport()} disabled={loading}>
          {loading ? 'جاري التحميل...' : 'عرض التقرير'}
        </button>
      </div>

      {error ? <div className="text-sm text-red-700">{error}</div> : null}

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
            <div className="centers-summary-commission"><span>عمولة الوكيل</span><strong>{(meta?.totalAgentCommission ?? 0).toLocaleString()}</strong></div>
            <div className="centers-summary-company"><span>الصافي</span><strong>{(meta?.totalNetProfit ?? 0).toLocaleString()}</strong></div>
          </section>

          {agentTotals.length > 0 && (
            <div className="card overflow-auto">
              <div className="card-header">مجاميع حسب الوكيل</div>
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>الوكيل</th><th>شحنات</th><th>طرود</th><th>وزن</th>
                    <th>تحصيل</th><th>مسبق</th><th>حوالة</th><th>أجرة</th>
                    <th>عمولة الوكيل</th><th>الصافي</th>
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
                      <td>{agent.agentCommissionAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td><strong>{agent.netProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card overflow-auto vehicle-report-details flex-1">
            <div className="card-header">تفاصيل الشحنات</div>
            {rows.length === 0 ? (
              <p className="p-4 text-gray-500">لا توجد شحنات لهذا السائق في هذا التاريخ.</p>
            ) : (
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>وصل</th><th>وجهة</th><th>وكيل</th><th>حالة</th><th>عدد</th><th>وزن</th>
                    <th>تحصيل</th><th>مسبق</th><th>حوالة</th><th>أجرة</th>
                    <th>نسبة الوكيل</th><th>عمولة الوكيل</th><th>الصافي</th>
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
                      <td>{row.agentCommissionPercentage ? `${row.agentCommissionPercentage}٪` : '—'}</td>
                      <td>{(row.agentCommissionAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td><strong>{(row.netProfit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="vehicle-report-totals-row">
                    <td colSpan={6}>المجاميع</td>
                    <td>{totals.collectAmount.toLocaleString()}</td>
                    <td>{totals.prepaidAmount.toLocaleString()}</td>
                    <td>{totals.hawalaAmount.toLocaleString()}</td>
                    <td>{totals.transferServiceFee.toLocaleString()}</td>
                    <td>—</td>
                    <td>{(meta?.totalAgentCommission ?? 0).toLocaleString()}</td>
                    <td><strong>{(meta?.totalNetProfit ?? 0).toLocaleString()}</strong></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <div className="vehicle-report-actions">
            <button type="button" className="toolbar-btn" onClick={exportCsv} disabled={!rows.length}>
              تصدير CSV
            </button>
            <FinancialStatementPrintButtons
              disabled={!rows.length}
              documentType="vehicle_trip_report"
              pdfTitle={`تقرير أرباح السيارة — ${selectedDriver?.name ?? ''}`}
              pdfFileName={`vehicle-profit-report-${selectedDriver?.name ?? 'driver'}-${reportDate}.pdf`}
              onBuildHtml={buildPrintHtml}
              className="flex gap-2"
            />
          </div>
        </>
      )}
    </div>
  );
}
