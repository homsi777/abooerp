import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpClient } from '../lib/api/httpClient';
import { centersGateway, type ProvincialInboundRow } from '../lib/api/centersGateway';
import VehicleTripReportDialog from '../components/shipping/VehicleTripReportDialog';
import { downloadCsv } from '../lib/export/csvDownload';
import { formatCurrency } from '../lib/currency/currency';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../lib/shipments/shipmentStatus';
import {
  computeProvincialTotals,
  computeProvincialCommissionSummary,
  formatWeightTotal,
  groupProvincialByAgent,
} from '../lib/shipping/provincialInboundTotals';
import { useToast } from '../components/Toast';

const SYRIAN_GOVERNORATES = [
  'دمشق',
  'ريف دمشق',
  'حلب',
  'حمص',
  'حماة',
  'اللاذقية',
  'طرطوس',
  'إدلب',
  'دير الزور',
  'الحسكة',
  'الرقة',
  'درعا',
  'السويداء',
  'القنيطرة',
  'القامشلي',
];

function normalizeArabic(value: string) {
  return value
    .trim()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesCenter(rowCenter: string, selectedCenter: string) {
  const a = normalizeArabic(rowCenter);
  const b = normalizeArabic(selectedCenter);
  return a === b || a.includes(b) || b.includes(a);
}

function defaultDateFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

export default function Centers() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ProvincialInboundRow[]>([]);
  const [selectedCenter, setSelectedCenter] = useState(SYRIAN_GOVERNORATES[0]);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [receiptStatus, setReceiptStatus] = useState<'all' | 'pending' | 'received'>('all');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<ProvincialInboundRow | null>(null);
  const [vehicleReportOpen, setVehicleReportOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await centersGateway.listProvincialInbound({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        receiptStatus,
      });
      setRows(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل شحنات المحافظات', 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, receiptStatus, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const centerCards = useMemo(() => {
    const inbound = new Map<string, number>();
    const received = new Map<string, number>();
    rows.forEach((row) => {
      const name = row.operationalCenter || 'غير محدد';
      inbound.set(name, (inbound.get(name) || 0) + 1);
      if (row.centerReceived) {
        received.set(name, (received.get(name) || 0) + 1);
      }
    });

    const names = new Set<string>([...SYRIAN_GOVERNORATES, ...inbound.keys()]);
    return Array.from(names)
      .map((name) => ({
        name,
        inbound: inbound.get(name) || 0,
        received: received.get(name) || 0,
      }))
      .sort((a, b) => b.inbound - a.inbound || a.name.localeCompare(b.name, 'ar'));
  }, [rows]);

  const selectedRows = useMemo(
    () => rows.filter((row) => matchesCenter(row.operationalCenter, selectedCenter)),
    [rows, selectedCenter],
  );

  const selectedTotals = useMemo(() => computeProvincialTotals(selectedRows), [selectedRows]);
  const agentTotals = useMemo(() => groupProvincialByAgent(selectedRows), [selectedRows]);
  const commissionSummary = useMemo(
    () => computeProvincialCommissionSummary(selectedRows),
    [selectedRows],
  );

  const completeCenterReceive = async (row: ProvincialInboundRow) => {
    setProcessingId(row.shipmentId);
    try {
      if (row.centerReceived) {
        showToast('تم تسجيل استلام هذه الشحنة في المركز مسبقاً.', 'success');
        setConfirmRow(null);
        await loadData();
        return;
      }

      await httpClient.post('/center-receipts', {
        shipmentId: row.shipmentId,
        centerName: selectedCenter,
        notes: `استلام مركز ${selectedCenter} — ${row.shipmentNo}`,
      });

      showToast('تم تثبيت استلام الشحنة في المركز.', 'success');
      setConfirmRow(null);
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تثبيت استلام المركز', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const exportCsv = () => {
    if (!selectedRows.length) {
      showToast('لا توجد بيانات للتصدير', 'info');
      return;
    }
    downloadCsv(
      `provincial-inbound-${selectedCenter}-${dateFrom}_${dateTo}.csv`,
      [
        'تاريخ الدفتر',
        'رقم الوصل',
        'رقم الشحنة',
        'الوجهة (دفتر)',
        'المحافظة',
        'الوكيل',
        'نوع الطرد',
        'العدد',
        'الوزن',
        'المرسل',
        'المستلم',
        'تحصيل',
        'دفع مسبق',
        'حوالة',
        'أجرة حوالة',
        'الإجمالي',
        'الحالة',
        'استلام المركز',
      ],
      selectedRows.map((row) => [
        row.ledgerDate ?? String(row.shipmentCreatedAt).split('T')[0],
        row.ledgerReceiptNo ?? row.shipmentNo,
        row.shipmentNo,
        row.ledgerDestination ?? '—',
        row.operationalCenter,
        row.agentName ?? '—',
        row.parcelType ?? '—',
        row.parcelCount ?? '',
        row.weightKg ?? '',
        row.senderName ?? '—',
        row.receiverName ?? '—',
        row.collectAmount,
        row.prepaidAmount,
        row.hawalaAmount,
        row.transferServiceFee,
        row.totalAmount,
        shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)),
        row.centerReceived ? 'مستلم' : 'بانتظار الاستلام',
      ]).concat([
        [
          'المجاميع',
          '',
          '',
          '',
          selectedCenter,
          '',
          '',
          selectedTotals.parcelCount,
          selectedTotals.weightKg,
          '',
          '',
          selectedTotals.collectAmount,
          selectedTotals.prepaidAmount,
          selectedTotals.hawalaAmount,
          selectedTotals.transferServiceFee,
          selectedTotals.lineTotal,
          '',
          '',
        ],
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  return (
    <div className="centers-page" dir="rtl">
      <div className="centers-header no-print">
        <div>
          <p className="centers-eyebrow">المراكز</p>
          <h2>استلام شحنات المحافظات</h2>
          <p className="text-sm text-gray-500 mt-1">
            شحنات منشأة من دفتر الإدخال السريع — مرتبطة بالوجهة/الوكيل وتظهر بنفس بيانات الدفتر
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="toolbar-btn primary" type="button" onClick={() => setVehicleReportOpen(true)}>
            تقرير سيارة
          </button>
          <button className="toolbar-btn" type="button" onClick={() => void loadData()} disabled={loading}>
            تحديث
          </button>
          <button className="toolbar-btn" type="button" onClick={exportCsv} disabled={!selectedRows.length}>
            تصدير Excel (CSV)
          </button>
          <button className="toolbar-btn" type="button" onClick={() => window.print()} disabled={!selectedRows.length}>
            طباعة
          </button>
        </div>
      </div>

      <div className="card mb-4 p-4 no-print">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">حالة الاستلام</label>
            <select className="form-select" value={receiptStatus} onChange={(e) => setReceiptStatus(e.target.value as typeof receiptStatus)}>
              <option value="all">الكل</option>
              <option value="pending">بانتظار استلام المركز</option>
              <option value="received">مستلمة في المركز</option>
            </select>
          </div>
          <div>
            <button className="toolbar-btn primary" type="button" onClick={() => void loadData()} disabled={loading}>
              {loading ? 'جارٍ التحميل...' : 'عرض الشحنات'}
            </button>
          </div>
        </div>
      </div>

      <div className="centers-layout">
        <aside className="centers-sidebar no-print">
          {centerCards.map((center) => (
            <button
              key={center.name}
              type="button"
              className={center.name === selectedCenter ? 'active' : ''}
              onClick={() => setSelectedCenter(center.name)}
            >
              <span>{center.name}</span>
              <strong title="وارد / مستلم في المركز">
                {center.inbound}/{center.received}
              </strong>
            </button>
          ))}
        </aside>

        <main className="centers-workspace">
          <section className="centers-summary">
            <div>
              <span>المحافظة</span>
              <strong>{selectedCenter}</strong>
            </div>
            <div>
              <span>عدد الشحنات</span>
              <strong>{selectedTotals.shipments.toLocaleString()}</strong>
            </div>
            <div>
              <span>عدد الطرود</span>
              <strong>{selectedTotals.parcelCount.toLocaleString()}</strong>
            </div>
            <div>
              <span>مجموع الأوزان (كغ)</span>
              <strong>{formatWeightTotal(selectedTotals.weightKg)}</strong>
            </div>
            <div>
              <span>مبالغ (تحصيل)</span>
              <strong>{formatCurrency(selectedTotals.collectAmount, 'USD')}</strong>
            </div>
            <div>
              <span>أجور (مسبق)</span>
              <strong>{formatCurrency(selectedTotals.prepaidAmount, 'USD')}</strong>
            </div>
            <div>
              <span>حوالات</span>
              <strong>{formatCurrency(selectedTotals.hawalaAmount, 'USD')}</strong>
            </div>
            <div>
              <span>أجور حوالات</span>
              <strong>{formatCurrency(selectedTotals.transferServiceFee, 'USD')}</strong>
            </div>
            <div className="centers-summary-commission">
              <span>عمولة مستحقة للوكيل</span>
              <strong>{formatCurrency(commissionSummary.totalCommission, 'USD')}</strong>
            </div>
            <div>
              <span>من الدفتر السريع</span>
              <strong>{selectedRows.filter((r) => r.fromQuickLedger).length.toLocaleString()}</strong>
            </div>
          </section>

          {(commissionSummary.missingAgentCount > 0 || commissionSummary.missingRateCount > 0) && (
            <div className="centers-commission-warn no-print">
              {commissionSummary.missingAgentCount > 0 ? (
                <p>
                  {commissionSummary.missingAgentCount.toLocaleString()} شحنة بدون <strong>وكيل معرّف</strong> —
                  لم تُحسب عمولتها. ربط الوكيل يتم من الدفتر أو تعريف الوكلاء.
                </p>
              ) : null}
              {commissionSummary.missingRateCount > 0 ? (
                <p>
                  {commissionSummary.missingRateCount.toLocaleString()} شحنة لوكيل <strong>بدون نسبة عمولة</strong> —
                  حدّد نسبة العمولة (%) في تعريف الوكيل.
                </p>
              ) : null}
            </div>
          )}

          {agentTotals.length > 0 && (
            <div className="card overflow-auto">
              <div className="card-header">مجاميع حسب الوكيل — {selectedCenter}</div>
              <table className="data-grid centers-agent-totals-table">
                <thead>
                  <tr>
                    <th>الوكيل</th>
                    <th>شحنات</th>
                    <th>طرود</th>
                    <th>وزن (كغ)</th>
                    <th>تحصيل</th>
                    <th>مسبق</th>
                    <th>حوالة</th>
                    <th>أجرة حوالة</th>
                    <th>عمولة الوكيل</th>
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
                      <td>{agent.agentCommissionAmount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="centers-totals-row">
                    <td><strong>المجموع</strong></td>
                    <td><strong>{selectedTotals.shipments}</strong></td>
                    <td><strong>{selectedTotals.parcelCount.toLocaleString()}</strong></td>
                    <td><strong>{formatWeightTotal(selectedTotals.weightKg)}</strong></td>
                    <td><strong>{selectedTotals.collectAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.prepaidAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.hawalaAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.transferServiceFee.toLocaleString()}</strong></td>
                    <td><strong>{commissionSummary.totalCommission.toLocaleString()}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="card overflow-auto">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>تاريخ</th>
                  <th>رقم الوصل</th>
                  <th>الوجهة</th>
                  <th>الوكيل</th>
                  <th>نوع الطرد</th>
                  <th>عدد</th>
                  <th>وزن</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>تحصيل</th>
                  <th>مسبق</th>
                  <th>حوالة</th>
                  <th>أجرة حوالة</th>
                  <th>الحالة</th>
                  <th className="no-print">استلام</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={15}>جاري تحميل البيانات...</td>
                  </tr>
                )}
                {!loading && selectedRows.length === 0 && (
                  <tr>
                    <td colSpan={15}>لا توجد شحنات لهذه المحافظة ضمن الفترة المحددة.</td>
                  </tr>
                )}
                {!loading &&
                  selectedRows.map((row) => {
                    const disabled = processingId === row.shipmentId;
                    return (
                      <tr key={row.shipmentId}>
                        <td>{row.ledgerDate ?? String(row.shipmentCreatedAt).split('T')[0]}</td>
                        <td>{row.ledgerReceiptNo ?? row.shipmentNo}</td>
                        <td>{row.ledgerDestination ?? row.operationalCenter}</td>
                        <td>{row.agentName ?? '—'}</td>
                        <td>{row.parcelType ?? '—'}</td>
                        <td>{row.parcelCount ?? '—'}</td>
                        <td>{row.weightKg ?? '—'}</td>
                        <td>{row.senderName ?? '—'}</td>
                        <td>{row.receiverName ?? '—'}</td>
                        <td>{row.collectAmount.toLocaleString()}</td>
                        <td>{row.prepaidAmount.toLocaleString()}</td>
                        <td>{row.hawalaAmount.toLocaleString()}</td>
                        <td>{row.transferServiceFee.toLocaleString()}</td>
                        <td>{shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus))}</td>
                        <td className="no-print">
                          {!row.centerReceived ? (
                            <button
                              type="button"
                              className="toolbar-btn primary"
                              onClick={() => setConfirmRow(row)}
                              disabled={disabled}
                            >
                              استلام مركز
                            </button>
                          ) : (
                            <span className="status-badge bg-green-100">مستلم</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              {!loading && selectedRows.length > 0 && (
                <tfoot>
                  <tr className="centers-totals-row">
                    <td colSpan={5}><strong>المجاميع</strong></td>
                    <td><strong>{selectedTotals.parcelCount.toLocaleString()}</strong></td>
                    <td><strong>{formatWeightTotal(selectedTotals.weightKg)}</strong></td>
                    <td colSpan={2} />
                    <td><strong>{selectedTotals.collectAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.prepaidAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.hawalaAmount.toLocaleString()}</strong></td>
                    <td><strong>{selectedTotals.transferServiceFee.toLocaleString()}</strong></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </main>
      </div>

      {confirmRow && (
        <div className="quick-ledger-confirm no-print">
          <div className="quick-ledger-confirm-panel">
            <h3>تأكيد استلام المركز — {selectedCenter}</h3>
            <p>
              الشحنة {confirmRow.shipmentNo} — {confirmRow.senderName} → {confirmRow.receiverName}
              <br />
              تحصيل {confirmRow.collectAmount} | مسبق {confirmRow.prepaidAmount} | حوالة {confirmRow.hawalaAmount}
            </p>
            <p className="text-xs text-gray-500">
              يثبت وصول الشحنة إلى مركز المحافظة فقط. السند المالي يتم لاحقاً من قسم التسليم.
            </p>
            <div>
              <button
                type="button"
                className="danger"
                onClick={() => void completeCenterReceive(confirmRow)}
                disabled={processingId !== null}
              >
                تأكيد استلام المركز
              </button>
              <button type="button" onClick={() => setConfirmRow(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <VehicleTripReportDialog
        open={vehicleReportOpen}
        defaultDate={dateTo}
        onClose={() => setVehicleReportOpen(false)}
      />
    </div>
  );
}
