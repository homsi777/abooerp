import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReportControlBar from '../../components/ReportControlBar';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import {
  phase3FinanceGateway,
  type BackendCashboxRecord,
  type DeliveryAgentCommissionReviewRow,
  type DeliveryLegacyAdditionalChargesRow,
  type DeliveryPendingTransferRow,
  type DeliveryTransferProfitRow,
  type DeliveryTransferProfitSummary,
} from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type ReportType =
  | 'pendingTransfers'
  | 'transferProfit'
  | 'legacyAdditionalCharges'
  | 'agentCommissionReview';

type BranchRow = { id: number; name: string };
type AgentRow = { id: number; name: string };

function isoFromDateStart(date: string) {
  return new Date(`${date}T00:00:00Z`).toISOString();
}

function isoFromDateEnd(date: string) {
  return new Date(`${date}T23:59:59Z`).toISOString();
}

export default function FinanceDeliveryReports() {
  const { showToast } = useToast();
  const [reportType, setReportType] = useState<ReportType>('pendingTransfers');
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [status, setStatus] = useState('');

  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [pendingRows, setPendingRows] = useState<DeliveryPendingTransferRow[]>([]);
  const [profitRows, setProfitRows] = useState<DeliveryTransferProfitRow[]>([]);
  const [profitSummary, setProfitSummary] = useState<DeliveryTransferProfitSummary | null>(null);
  const [legacyRows, setLegacyRows] = useState<DeliveryLegacyAdditionalChargesRow[]>([]);
  const [commissionRows, setCommissionRows] = useState<DeliveryAgentCommissionReviewRow[]>([]);

  const initialLoad = useRef(false);

  const reportTitle = useMemo(() => {
    if (reportType === 'pendingTransfers') return 'تقرير الحوالات المعلقة';
    if (reportType === 'transferProfit') return 'تقرير ربح أجرة الحوالة';
    if (reportType === 'legacyAdditionalCharges') return 'تقرير مراجعة الرسوم الإضافية (Legacy)';
    return 'تقرير مراجعة عمولات الوكلاء';
  }, [reportType]);

  const loadReferences = useCallback(async () => {
    try {
      const [branchesData, agentsData, cashboxesData] = await Promise.all([
        phase15Gateway.branches.getAll(),
        phase15Gateway.agents.getAll(),
        phase3FinanceGateway.cashbox.listMaster({ isActive: 'true' }),
      ]);
      setBranches(branchesData.map((b: any) => ({ id: b.id, name: b.name })));
      setAgents(agentsData.map((a: any) => ({ id: a.id, name: a.name })));
      setCashboxes(cashboxesData);
    } catch {
      showToast('تعذر تحميل المراجع', 'error');
    }
  }, [showToast]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {
        dateFrom: dateFrom ? isoFromDateStart(dateFrom) : undefined,
        dateTo: dateTo ? isoFromDateEnd(dateTo) : undefined,
        branchId: branchId || undefined,
        agentId: agentId || undefined,
        cashboxId: cashboxId || undefined,
        status: status || undefined,
      };

      if (reportType === 'pendingTransfers') {
        const data = await phase3FinanceGateway.deliveryReports.pendingTransfers({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          branchId: filters.branchId,
          agentId: filters.agentId,
        });
        setPendingRows(data.rows || []);
        setHasLoaded(true);
        return;
      }

      if (reportType === 'transferProfit') {
        const data = await phase3FinanceGateway.deliveryReports.transferProfit({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          branchId: filters.branchId,
          cashboxId: filters.cashboxId,
          status: filters.status,
        });
        setProfitRows(data.rows || []);
        setProfitSummary(data.summary || null);
        setHasLoaded(true);
        return;
      }

      if (reportType === 'legacyAdditionalCharges') {
        const data = await phase3FinanceGateway.deliveryReports.legacyAdditionalCharges({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          branchId: filters.branchId,
          status: filters.status,
        });
        setLegacyRows(data.rows || []);
        setHasLoaded(true);
        return;
      }

      const data = await phase3FinanceGateway.deliveryReports.agentCommissionReview({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        branchId: filters.branchId,
        agentId: filters.agentId,
        status: filters.status,
      });
      setCommissionRows(data.rows || []);
      setHasLoaded(true);
    } catch (err: any) {
      showToast(err.message || 'تعذر تحميل التقرير', 'error');
    } finally {
      setLoading(false);
    }
  }, [agentId, branchId, cashboxId, dateFrom, dateTo, reportType, showToast, status]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadReferences().then(() => loadReport());
  }, [loadReferences, loadReport]);

  const exportCsv = () => {
    if (!hasLoaded) {
      showToast('حمّل التقرير أولاً', 'info');
      return;
    }
    const tag = `${reportType}-${dateFrom}_${dateTo}`;

    if (reportType === 'pendingTransfers') {
      downloadCsv(
        `pending-transfers-${tag}.csv`,
        ['created_at', 'transfer_id', 'shipment_no', 'sender', 'receiver', 'agent', 'branch', 'service_fee', 'currency', 'status'],
        pendingRows.map((r) => [
          r.created_at,
          r.id,
          r.shipment_no ?? '',
          r.sender_name,
          r.receiver_name,
          r.agent_name ?? '',
          r.branch_name ?? '',
          r.transfer_service_fee,
          r.transfer_service_fee_currency,
          r.status,
        ]),
      );
      return;
    }

    if (reportType === 'transferProfit') {
      downloadCsv(
        `transfer-profit-${tag}.csv`,
        ['date', 'transfer_id', 'shipment_no', 'service_fee', 'service_fee_currency', 'company_profit', 'profit_currency', 'cashbox', 'receipt_voucher', 'status'],
        profitRows.map((r) => [
          r.report_date,
          r.id,
          r.shipment_no ?? '',
          r.transfer_service_fee,
          r.transfer_service_fee_currency,
          r.company_transfer_profit,
          r.company_transfer_profit_currency,
          r.cashbox_name ?? '',
          r.receipt_voucher_no ?? '',
          r.status,
        ]),
      );
      return;
    }

    if (reportType === 'legacyAdditionalCharges') {
      downloadCsv(
        `legacy-additional-charges-${tag}.csv`,
        ['date', 'shipment_no', 'sender', 'receiver', 'additional_charges', 'transfer_service_fee', 'status'],
        legacyRows.map((r) => [
          r.created_at,
          r.shipment_no,
          r.sender_name ?? '',
          r.receiver_name ?? '',
          r.additional_charges,
          r.transfer_service_fee,
          r.status,
        ]),
      );
      return;
    }

    downloadCsv(
      `agent-commission-review-${tag}.csv`,
      ['date', 'shipment_no', 'agent', 'freight_charge', 'commission_pct_snapshot', 'commission_amount_snapshot', 'expected_commission', 'base_type', 'status'],
      commissionRows.map((r) => [
        r.created_at,
        r.shipment_no,
        r.agent_name,
        r.freight_charge,
        r.commission_percentage_snapshot,
        r.commission_amount_snapshot,
        r.expected_commission_amount,
        r.base_type,
        r.status,
      ]),
    );
  };

  const exportPdf = async () => {
    if (!hasLoaded) {
      showToast('حمّل التقرير أولاً', 'info');
      return;
    }

    if (reportType === 'pendingTransfers') {
      await exportPdfTable({
        title: `${reportTitle} (${dateFrom} → ${dateTo})`,
        fileName: `pending-transfers-${dateFrom}_${dateTo}.pdf`,
        columns: [
          { key: 'created_at', label: 'التاريخ' },
          { key: 'shipment_no', label: 'الشحنة' },
          { key: 'sender_name', label: 'المرسل' },
          { key: 'receiver_name', label: 'المستلم' },
          { key: 'agent_name', label: 'الوكيل' },
          { key: 'branch_name', label: 'الفرع' },
          { key: 'fee', label: 'أجرة الحوالة' },
          { key: 'status', label: 'الحالة' },
        ],
        rows: pendingRows.map((r) => ({
          created_at: r.created_at?.split('T')[0] ?? '',
          shipment_no: r.shipment_no ?? '-',
          sender_name: r.sender_name,
          receiver_name: r.receiver_name,
          agent_name: r.agent_name ?? '-',
          branch_name: r.branch_name ?? '-',
          fee: `${Number(r.transfer_service_fee ?? 0).toLocaleString()} ${r.transfer_service_fee_currency}`,
          status: r.status,
        })),
      });
      return;
    }

    if (reportType === 'transferProfit') {
      await exportPdfTable({
        title: `${reportTitle} (${dateFrom} → ${dateTo})`,
        fileName: `transfer-profit-${dateFrom}_${dateTo}.pdf`,
        columns: [
          { key: 'report_date', label: 'التاريخ' },
          { key: 'shipment_no', label: 'الشحنة' },
          { key: 'service_fee', label: 'أجرة الحوالة' },
          { key: 'profit', label: 'ربح الشركة' },
          { key: 'cashbox', label: 'الصندوق' },
          { key: 'voucher', label: 'سند القبض' },
          { key: 'status', label: 'الحالة' },
        ],
        rows: profitRows.map((r) => ({
          report_date: r.report_date?.split('T')[0] ?? '',
          shipment_no: r.shipment_no ?? '-',
          service_fee: `${Number(r.transfer_service_fee ?? 0).toLocaleString()} ${r.transfer_service_fee_currency}`,
          profit: `${Number(r.company_transfer_profit ?? 0).toLocaleString()} ${r.company_transfer_profit_currency}`,
          cashbox: r.cashbox_name ?? '-',
          voucher: r.receipt_voucher_no ?? '-',
          status: r.status,
        })),
      });
      return;
    }

    if (reportType === 'legacyAdditionalCharges') {
      await exportPdfTable({
        title: `${reportTitle} (${dateFrom} → ${dateTo})`,
        fileName: `legacy-additional-charges-${dateFrom}_${dateTo}.pdf`,
        columns: [
          { key: 'date', label: 'التاريخ' },
          { key: 'shipment_no', label: 'الشحنة' },
          { key: 'sender', label: 'المرسل' },
          { key: 'receiver', label: 'المستلم' },
          { key: 'additional', label: 'رسوم إضافية' },
          { key: 'service_fee', label: 'أجرة الحوالة' },
          { key: 'status', label: 'الحالة' },
        ],
        rows: legacyRows.map((r) => ({
          date: r.created_at?.split('T')[0] ?? '',
          shipment_no: r.shipment_no ?? '-',
          sender: r.sender_name ?? '-',
          receiver: r.receiver_name ?? '-',
          additional: Number(r.additional_charges ?? 0).toLocaleString(),
          service_fee: Number(r.transfer_service_fee ?? 0).toLocaleString(),
          status: r.status,
        })),
      });
      return;
    }

    await exportPdfTable({
      title: `${reportTitle} (${dateFrom} → ${dateTo})`,
      fileName: `agent-commission-review-${dateFrom}_${dateTo}.pdf`,
      columns: [
        { key: 'date', label: 'التاريخ' },
        { key: 'shipment_no', label: 'الشحنة' },
        { key: 'agent', label: 'الوكيل' },
        { key: 'freight', label: 'أجرة الشحن' },
        { key: 'pct', label: '% العمولة' },
        { key: 'snap', label: 'عمولة Snapshot' },
        { key: 'expected', label: 'المتوقع' },
        { key: 'base', label: 'Base' },
        { key: 'status', label: 'الحالة' },
      ],
      rows: commissionRows.map((r) => ({
        date: r.created_at?.split('T')[0] ?? '',
        shipment_no: r.shipment_no ?? '-',
        agent: r.agent_name ?? '-',
        freight: Number(r.freight_charge ?? 0).toLocaleString(),
        pct: Number(r.commission_percentage_snapshot ?? 0).toLocaleString(),
        snap: Number(r.commission_amount_snapshot ?? 0).toLocaleString(),
        expected: Number(r.expected_commission_amount ?? 0).toLocaleString(),
        base: r.base_type ?? '-',
        status: r.status,
      })),
    });
  };

  const table = useMemo(() => {
    if (reportType === 'pendingTransfers') {
      return (
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الشحنة</th>
              <th>المرسل</th>
              <th>المستلم</th>
              <th>الوكيل</th>
              <th>الفرع</th>
              <th>أجرة الحوالة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {pendingRows.map((r) => (
              <tr key={r.id}>
                <td>{r.created_at?.split('T')[0] ?? ''}</td>
                <td>{r.shipment_no ?? '-'}</td>
                <td>{r.sender_name}</td>
                <td>{r.receiver_name}</td>
                <td>{r.agent_name ?? '-'}</td>
                <td>{r.branch_name ?? '-'}</td>
                <td>{Number(r.transfer_service_fee ?? 0).toLocaleString()} {r.transfer_service_fee_currency}</td>
                <td>{r.status}</td>
              </tr>
            ))}
            {!loading && pendingRows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-6 text-gray-500">
                  لا يوجد بيانات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }

    if (reportType === 'transferProfit') {
      return (
        <div className="space-y-3">
          {profitSummary && (
            <div className="grid grid-cols-4 gap-3">
              <div className="card p-3">
                <div className="text-xs text-slate-500">إجمالي أجور الحوالات (مكتملة)</div>
                <div className="font-bold">{Number(profitSummary.totalTransferServiceFees ?? 0).toLocaleString()}</div>
              </div>
              <div className="card p-3">
                <div className="text-xs text-slate-500">مكتملة</div>
                <div className="font-bold">{profitSummary.completedCount}</div>
              </div>
              <div className="card p-3">
                <div className="text-xs text-slate-500">ملغاة</div>
                <div className="font-bold">{profitSummary.cancelledCount}</div>
              </div>
              <div className="card p-3">
                <div className="text-xs text-slate-500">معلقة</div>
                <div className="font-bold">{profitSummary.pendingCount}</div>
              </div>
            </div>
          )}

          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الشحنة</th>
                <th>أجرة الحوالة</th>
                <th>ربح الشركة</th>
                <th>الصندوق</th>
                <th>سند القبض</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {profitRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.report_date?.split('T')[0] ?? ''}</td>
                  <td>{r.shipment_no ?? '-'}</td>
                  <td>{Number(r.transfer_service_fee ?? 0).toLocaleString()} {r.transfer_service_fee_currency}</td>
                  <td>{Number(r.company_transfer_profit ?? 0).toLocaleString()} {r.company_transfer_profit_currency}</td>
                  <td>{r.cashbox_name ?? '-'}</td>
                  <td>{r.receipt_voucher_no ?? '-'}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
              {!loading && profitRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-gray-500">
                    لا يوجد بيانات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (reportType === 'legacyAdditionalCharges') {
      return (
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الشحنة</th>
              <th>المرسل</th>
              <th>المستلم</th>
              <th>رسوم إضافية</th>
              <th>أجرة الحوالة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {legacyRows.map((r) => (
              <tr key={r.shipment_id}>
                <td>{r.created_at?.split('T')[0] ?? ''}</td>
                <td>{r.shipment_no}</td>
                <td>{r.sender_name ?? '-'}</td>
                <td>{r.receiver_name ?? '-'}</td>
                <td>{Number(r.additional_charges ?? 0).toLocaleString()}</td>
                <td>{Number(r.transfer_service_fee ?? 0).toLocaleString()}</td>
                <td>{r.status}</td>
              </tr>
            ))}
            {!loading && legacyRows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-6 text-gray-500">
                  لا يوجد بيانات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }

    return (
      <table className="table w-full text-sm">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>الشحنة</th>
            <th>الوكيل</th>
            <th>أجرة الشحن</th>
            <th>% العمولة</th>
            <th>عمولة Snapshot</th>
            <th>المتوقع</th>
            <th>Base</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {commissionRows.map((r) => (
            <tr key={r.shipment_id}>
              <td>{r.created_at?.split('T')[0] ?? ''}</td>
              <td>{r.shipment_no}</td>
              <td>{r.agent_name}</td>
              <td>{Number(r.freight_charge ?? 0).toLocaleString()}</td>
              <td>{Number(r.commission_percentage_snapshot ?? 0).toLocaleString()}</td>
              <td>{Number(r.commission_amount_snapshot ?? 0).toLocaleString()}</td>
              <td>{Number(r.expected_commission_amount ?? 0).toLocaleString()}</td>
              <td>{r.base_type}</td>
              <td>{r.status}</td>
            </tr>
          ))}
          {!loading && commissionRows.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center py-6 text-gray-500">
                لا يوجد بيانات
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }, [commissionRows, legacyRows, loading, pendingRows, profitRows, profitSummary, reportType]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">تقارير قبل التسليم</h2>
      </div>

      <ReportControlBar
        onExecute={() => void loadReport()}
        executeLabel={loading ? 'جارٍ التحميل...' : 'عرض التقرير'}
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          { id: 'export', label: 'تصدير Excel (CSV)', onClick: exportCsv },
          { id: 'pdf', label: 'تصدير PDF', onClick: () => void exportPdf() },
        ]}
        filters={
          <>
            <div className="form-group">
              <label className="form-label">نوع التقرير</label>
              <select className="form-select" value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
                <option value="pendingTransfers">الحوالات المعلقة</option>
                <option value="transferProfit">ربح أجرة الحوالة</option>
                <option value="legacyAdditionalCharges">مراجعة الرسوم الإضافية (Legacy)</option>
                <option value="agentCommissionReview">مراجعة عمولات الوكلاء</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">من</label>
              <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">إلى</label>
              <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">الفرع</label>
              <select className="form-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">الكل</option>
                {branches.map((b) => (
                  <option key={b.id} value={getBackendIdFromSynthetic(b.id) || ''}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {(reportType === 'pendingTransfers' || reportType === 'agentCommissionReview') && (
              <div className="form-group">
                <label className="form-label">الوكيل</label>
                <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">الكل</option>
                  {agents.map((a) => (
                    <option key={a.id} value={getBackendIdFromSynthetic(a.id) || ''}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {reportType === 'transferProfit' && (
              <>
                <div className="form-group">
                  <label className="form-label">الصندوق</label>
                  <select className="form-select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
                    <option value="">الكل</option>
                    {cashboxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.code} - {cb.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">الحالة</label>
                  <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">الكل</option>
                    <option value="PENDING">PENDING</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>
              </>
            )}

            {reportType !== 'pendingTransfers' && reportType !== 'transferProfit' && (
              <div className="form-group">
                <label className="form-label">الحالة</label>
                <input className="form-input" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="مثل: CONFIRMED" />
              </div>
            )}
          </>
        }
      />

      <div className="card flex-1 min-h-0 overflow-auto print:overflow-visible">
        <div className="p-3 border-b">
          <div className="font-semibold">{reportTitle}</div>
          <div className="text-xs text-gray-500">{dateFrom} → {dateTo}</div>
        </div>
        <div className="p-3">{table}</div>
      </div>
    </div>
  );
}
