import { useCallback, useEffect, useRef, useState } from 'react';
import ReportControlBar from '../../components/ReportControlBar';
import { useToast } from '../../components/Toast';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import { httpClient } from '../../lib/api/httpClient';
import {
  transfersGateway,
  type TransferReport,
  type TransferReportRow,
  transferStatusLabel,
} from '../../lib/api/transfersGateway';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type ReportView = 'detail' | 'by_destination';

export default function TransferReports() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [originAgentId, setOriginAgentId] = useState('');
  const [destinationAgentId, setDestinationAgentId] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [reportView, setReportView] = useState<ReportView>('detail');
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [report, setReport] = useState<TransferReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const initialLoad = useRef(false);

  useEffect(() => {
    void Promise.all([
      phase15Gateway.branches.getAll(),
      httpClient.get<Array<{ id: string; name: string }>>('/agents?includeInactive=false'),
    ]).then(([branchRows, agentRows]) => {
      setBranches(
        branchRows
          .map((b) => {
            const id = getBackendIdFromSynthetic(b.id);
            return id ? { id, name: b.name } : null;
          })
          .filter((row): row is { id: string; name: string } => Boolean(row)),
      );
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })));
    }).catch(() => {
      setBranches([]);
      setAgents([]);
    });
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const dateFromIso = new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const dateToIso = new Date(`${dateTo}T23:59:59Z`).toISOString();
      const data = await transfersGateway.getReport({
        dateFrom: dateFromIso,
        dateTo: dateToIso,
        branchId: branchId || undefined,
        status: (status || undefined) as 'PENDING' | 'COMPLETED' | 'CANCELLED' | undefined,
        originAgentId: originAgentId || undefined,
        destinationAgentId: destinationAgentId || undefined,
        destinationCity: destinationCity.trim() || undefined,
      });
      setReport(data);
      setHasLoaded(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل تقرير الحوالات', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    branchId,
    dateFrom,
    dateTo,
    destinationAgentId,
    destinationCity,
    originAgentId,
    showToast,
    status,
  ]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadReport();
  }, [loadReport]);

  const totals = report?.summaryByCurrency ?? [];
  const totalPending = totals.reduce((sum, row) => sum + Number(row.pending_count ?? 0), 0);
  const totalCompleted = totals.reduce((sum, row) => sum + Number(row.completed_count ?? 0), 0);
  const totalCancelled = totals.reduce((sum, row) => sum + Number(row.cancelled_count ?? 0), 0);
  const totalCount = totals.reduce((sum, row) => sum + Number(row.total_count ?? 0), 0);

  const exportDetailCsv = () => {
    if (!report) return;
    downloadCsv(
      `transfer-report-${dateFrom}_${dateTo}.csv`,
      [
        'التاريخ',
        'المرسل',
        'المستلم',
        'المبلغ',
        'العملة',
        'الوجهة',
        'وكيل المصدر',
        'وكيل الوجهة',
        'الشحنة',
        'أجرة الحوالة',
        'حالة التسليم',
        'تاريخ التسليم',
        'سند الدفع',
        'ملاحظات',
      ],
      report.rows.map((row) => [
        String(row.report_date ?? '').split('T')[0],
        row.sender_name,
        row.receiver_name,
        row.amount,
        row.currency,
        row.destination_label ?? row.destination_city ?? '',
        row.origin_agent_name ?? '',
        row.destination_agent_name ?? '',
        row.shipment_no ?? '',
        row.transfer_service_fee,
        transferStatusLabel(row.status),
        row.posted_at ? String(row.posted_at).split('T')[0] : '',
        row.payout_voucher_no ?? '',
        row.notes ?? '',
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  const exportDestinationCsv = () => {
    if (!report) return;
    downloadCsv(
      `transfer-by-destination-${dateFrom}_${dateTo}.csv`,
      [
        'الوجهة',
        'المدينة',
        'العملة',
        'الإجمالي',
        'لم تُسلّم',
        'تم التسليم',
        'ملغاة',
        'مبلغ معلّق',
        'مبلغ مُسلّم',
        'إجمالي المبالغ',
      ],
      report.byDestination.map((row) => [
        row.destination_label,
        row.destination_city ?? '',
        row.currency,
        row.total_count,
        row.pending_count,
        row.completed_count,
        row.cancelled_count,
        row.pending_amount,
        row.completed_amount,
        row.total_amount,
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  const exportPdf = async () => {
    if (!report) return;
    if (reportView === 'by_destination') {
      await exportPdfTable({
        title: 'تقرير الحوالات حسب الوجهة',
        subtitle: `من ${dateFrom} إلى ${dateTo}`,
        columns: ['الوجهة', 'العملة', 'لم تُسلّم', 'تم التسليم', 'مبلغ معلّق', 'مبلغ مُسلّم'],
        rows: report.byDestination.map((row) => [
          row.destination_label,
          row.currency,
          String(row.pending_count),
          String(row.completed_count),
          Number(row.pending_amount).toLocaleString(),
          Number(row.completed_amount).toLocaleString(),
        ]),
        fileName: `transfer-by-destination-${dateFrom}_${dateTo}.pdf`,
      });
    } else {
      await exportPdfTable({
        title: 'كشف الحوالات',
        subtitle: `من ${dateFrom} إلى ${dateTo} | لم تُسلّم: ${totalPending} | تم التسليم: ${totalCompleted}`,
        columns: ['التاريخ', 'المرسل', 'المستلم', 'المبلغ', 'الوجهة', 'الحالة'],
        rows: report.rows.map((row) => [
          String(row.report_date ?? '').split('T')[0],
          row.sender_name,
          row.receiver_name,
          `${Number(row.amount).toLocaleString()} ${row.currency}`,
          row.destination_label ?? row.destination_city ?? '—',
          transferStatusLabel(row.status),
        ]),
        fileName: `transfer-report-${dateFrom}_${dateTo}.pdf`,
      });
    }
    showToast('تم تصدير PDF', 'success');
  };

  const renderDetailTable = (rows: TransferReportRow[]) => (
    <table className="table w-full text-sm">
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>المرسل</th>
          <th>المستلم</th>
          <th>المبلغ</th>
          <th>الوجهة</th>
          <th>المصدر → الوجهة</th>
          <th>الشحنة</th>
          <th>أجرة الحوالة</th>
          <th>حالة التسليم</th>
          <th>التسليم / السند</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={rowStatusClass(row.status)}>
            <td>{String(row.report_date ?? '').split('T')[0]}</td>
            <td>{row.sender_name}</td>
            <td>{row.receiver_name}</td>
            <td>{Number(row.amount).toLocaleString()} {row.currency}</td>
            <td>{row.destination_label ?? row.destination_city ?? '—'}</td>
            <td>
              {(row.origin_agent_name ?? '—')} → {(row.destination_agent_name ?? '—')}
            </td>
            <td>{row.shipment_no ?? '—'}</td>
            <td>
              {Number(row.transfer_service_fee ?? 0).toLocaleString()} {row.transfer_service_fee_currency}
            </td>
            <td>{transferStatusLabel(row.status)}</td>
            <td>
              {row.posted_at
                ? `${String(row.posted_at).split('T')[0]}${row.payout_voucher_no ? ` / ${row.payout_voucher_no}` : ''}`
                : '—'}
            </td>
          </tr>
        ))}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={10} className="text-center py-6 text-gray-500">
              لا توجد حوالات ضمن الفلاتر المحددة
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <ReportControlBar
        onExecute={() => void loadReport()}
        executeLabel={loading ? 'جارٍ التحميل...' : 'عرض التقرير'}
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          {
            id: 'csv-detail',
            label: 'تصدير كشف CSV',
            onClick: exportDetailCsv,
          },
          {
            id: 'csv-destination',
            label: 'تصدير حسب الوجهة CSV',
            onClick: exportDestinationCsv,
          },
          { id: 'pdf', label: 'تصدير PDF', onClick: () => void exportPdf() },
        ]}
        filters={
          <>
            <div className="form-group">
              <label className="form-label">عرض التقرير</label>
              <select
                className="form-select"
                value={reportView}
                onChange={(e) => setReportView(e.target.value as ReportView)}
              >
                <option value="detail">كشف تفصيلي</option>
                <option value="by_destination">حسب الوجهة</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">حالة التسليم</label>
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">الكل</option>
                <option value="PENDING">لم تُسلّم بعد</option>
                <option value="COMPLETED">تم التسليم</option>
                <option value="CANCELLED">ملغاة</option>
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
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">وكيل المصدر</label>
              <select className="form-select" value={originAgentId} onChange={(e) => setOriginAgentId(e.target.value)}>
                <option value="">الكل</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">وكيل / وجهة التسليم</label>
              <select
                className="form-select"
                value={destinationAgentId}
                onChange={(e) => setDestinationAgentId(e.target.value)}
              >
                <option value="">الكل</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">مدينة الوجهة</label>
              <input
                className="form-input"
                value={destinationCity}
                onChange={(e) => setDestinationCity(e.target.value)}
                placeholder="مثال: حمص"
              />
            </div>
          </>
        }
      />

      {hasLoaded && report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="card p-3">
            <div className="text-xs text-slate-500">إجمالي الحوالات</div>
            <div className="font-bold text-lg">{totalCount}</div>
          </div>
          <div className="card p-3 border-amber-200 bg-amber-50/50">
            <div className="text-xs text-amber-700">لم تُسلّم بعد</div>
            <div className="font-bold text-lg text-amber-800">{totalPending}</div>
            {totals.map((row) => (
              <div key={`pending-${row.currency}`} className="text-xs text-amber-700">
                {Number(row.pending_amount).toLocaleString()} {row.currency}
              </div>
            ))}
          </div>
          <div className="card p-3 border-emerald-200 bg-emerald-50/50">
            <div className="text-xs text-emerald-700">تم التسليم</div>
            <div className="font-bold text-lg text-emerald-800">{totalCompleted}</div>
            {totals.map((row) => (
              <div key={`completed-${row.currency}`} className="text-xs text-emerald-700">
                {Number(row.completed_amount).toLocaleString()} {row.currency}
              </div>
            ))}
          </div>
          <div className="card p-3">
            <div className="text-xs text-slate-500">ملغاة</div>
            <div className="font-bold text-lg">{totalCancelled}</div>
          </div>
        </div>
      )}

      <div className="card flex-1 min-h-0 overflow-auto">
        {reportView === 'by_destination' ? (
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th>الوجهة</th>
                <th>المدينة</th>
                <th>العملة</th>
                <th>العدد</th>
                <th>لم تُسلّم</th>
                <th>تم التسليم</th>
                <th>ملغاة</th>
                <th>مبلغ معلّق</th>
                <th>مبلغ مُسلّم</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {(report?.byDestination ?? []).map((row, index) => (
                <tr key={`${row.destination_label}-${row.currency}-${index}`}>
                  <td>{row.destination_label}</td>
                  <td>{row.destination_city ?? '—'}</td>
                  <td>{row.currency}</td>
                  <td>{row.total_count}</td>
                  <td className="text-amber-700 font-medium">{row.pending_count}</td>
                  <td className="text-emerald-700 font-medium">{row.completed_count}</td>
                  <td>{row.cancelled_count}</td>
                  <td>{Number(row.pending_amount).toLocaleString()}</td>
                  <td>{Number(row.completed_amount).toLocaleString()}</td>
                  <td>{Number(row.total_amount).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && (report?.byDestination.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-6 text-gray-500">
                    لا توجد بيانات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          renderDetailTable(report?.rows ?? [])
        )}
      </div>
    </div>
  );
}

function rowStatusClass(status: string) {
  const normalized = String(status).toUpperCase();
  if (normalized === 'PENDING') return 'bg-amber-50/40';
  if (normalized === 'COMPLETED') return 'bg-emerald-50/30';
  if (normalized === 'CANCELLED') return 'opacity-60';
  return '';
}
