import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { Customer, Driver, Manifest } from '../types';
import { SHIPMENT_STATUS_LABELS } from '../types';
import ReportControlBar from '../components/ReportControlBar';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../lib/currency/currency';
import { getBackendIdFromSynthetic, phase15Gateway } from '../lib/api/phase15Gateway';
import { phase3FinanceGateway } from '../lib/api/phase3FinanceGateway';
import { useToast } from '../components/Toast';
import { downloadCsv } from '../lib/export/csvDownload';

type ReportType = 'daily' | 'destination' | 'driver' | 'pending' | 'customer' | 'cash' | 'manifest';

export default function Reports() {
  const rates = getExchangeRatesToUsd();
  const { showToast } = useToast();
  const [shipments, setShipments] = useState<any[]>([]);
  const [statementSummary, setStatementSummary] = useState<any>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [cashboxTx, setCashboxTx] = useState<Awaited<ReturnType<typeof phase3FinanceGateway.cashbox.getTransactions>>>([]);
  const [selectedReport, setSelectedReport] = useState<ReportType>('daily');
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [appliedDateFrom, setAppliedDateFrom] = useState(dateFrom);
  const [appliedDateTo, setAppliedDateTo] = useState(dateTo);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [sendersList, setSendersList] = useState<Customer[]>([]);
  const [accountScope, setAccountScope] = useState<'all' | 'customer' | 'sender_receiver'>('all');
  const [accountPartyId, setAccountPartyId] = useState('');
  const [partyEntries, setPartyEntries] = useState<
    Awaited<ReturnType<typeof phase3FinanceGateway.statements.getEntries>>
  >([]);
  const initialFetchDone = useRef(false);

  const resetFilters = () => {
    setDateFrom(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    setDateTo(new Date().toISOString().split('T')[0]);
    setHasAppliedFilters(false);
  };

  const reportTypes = [
    { id: 'daily', label: 'التقرير اليومي' },
    { id: 'destination', label: 'الشحنات حسب الوجهة' },
    { id: 'driver', label: 'الشحنات حسب السائق' },
    { id: 'pending', label: 'الشحنات المعلقة' },
    { id: 'customer', label: 'الملخص المالي والأطراف' },
    { id: 'cash', label: 'ملخص النقود' },
    { id: 'manifest', label: 'ملخص التحميل' },
  ];

  const driverNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of drivers) {
      m.set(d.id, d.name);
    }
    return m;
  }, [drivers]);

  const filteredShipments = useMemo(
    () => shipments.filter((s) => s.date >= appliedDateFrom && s.date <= appliedDateTo),
    [shipments, appliedDateFrom, appliedDateTo],
  );

  const cashboxInRange = useMemo(() => {
    const fromT = new Date(`${appliedDateFrom}T00:00:00`).getTime();
    const toT = new Date(`${appliedDateTo}T23:59:59.999`).getTime();
    return cashboxTx.filter((t) => {
      const t0 = new Date(t.created_at).getTime();
      return t0 >= fromT && t0 <= toT;
    });
  }, [cashboxTx, appliedDateFrom, appliedDateTo]);

  const filteredManifests = useMemo(
    () => manifests.filter((m) => m.date >= appliedDateFrom && m.date <= appliedDateTo),
    [manifests, appliedDateFrom, appliedDateTo],
  );

  const fetchReportData = useCallback(
    async (from: string, to: string) => {
      setLoading(true);
      try {
        const fromAt = new Date(`${from}T00:00:00Z`).toISOString();
        const toAt = new Date(`${to}T23:59:59Z`).toISOString();

        const scoped = accountScope !== 'all' && accountPartyId.trim() !== '';
        const summaryParams: Parameters<typeof phase3FinanceGateway.statements.getSummary>[0] = { fromAt, toAt };
        if (scoped) {
          summaryParams.partyType = accountScope;
          summaryParams.partyId = accountPartyId.trim();
        }

        const entriesPromise = scoped
          ? phase3FinanceGateway.statements.getEntries({
              fromAt,
              toAt,
              partyType: accountScope,
              partyId: accountPartyId.trim(),
              includeReversals: true,
            })
          : Promise.resolve(
              [] as Awaited<ReturnType<typeof phase3FinanceGateway.statements.getEntries>>,
            );

        const [shipmentsData, summary, driversList, manifs, cbox, cust, snd, ent] = await Promise.all([
          phase15Gateway.shipments.getAll(),
          phase3FinanceGateway.statements.getSummary(summaryParams),
          phase15Gateway.drivers.getAll(),
          phase15Gateway.manifests.getAll(),
          phase3FinanceGateway.cashbox.getTransactions(),
          phase15Gateway.customers.getAll(),
          phase15Gateway.sendersReceivers.getAll(),
          entriesPromise,
        ]);

        setShipments(shipmentsData);
        setStatementSummary(summary);
        setDrivers(driversList);
        setManifests(manifs);
        setCashboxTx(cbox);
        setCustomersList(cust);
        setSendersList(snd);
        setPartyEntries(scoped ? ent : []);
      } catch {
        showToast('تعذر تحميل بيانات التقارير', 'error');
        setPartyEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [showToast, accountScope, accountPartyId],
  );

  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    void (async () => {
      setAppliedDateFrom(dateFrom);
      setAppliedDateTo(dateTo);
      setHasAppliedFilters(true);
      await fetchReportData(dateFrom, dateTo);
    })();
  }, [fetchReportData, dateFrom, dateTo]);

  const shipmentAmountUsd = (total: number, currency?: string) =>
    convertToUsd(total || 0, (currency || 'USD') as CurrencyCode, rates);

  const handleExecuteReport = () => {
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setHasAppliedFilters(true);
    void fetchReportData(dateFrom, dateTo);
  };

  const isPending = (s: (typeof shipments)[0]) => s.status !== 'delivered' && s.status !== 'cancelled' && s.status !== 'returned';

  const buildExport = () => {
    const d0 = appliedDateFrom;
    const d1 = appliedDateTo;

    try {
      switch (selectedReport) {
        case 'daily':
          downloadCsv(
            `report-daily-${d0}_${d1}.csv`,
            ['shipmentNo', 'date', 'sender', 'receiver', 'destination', 'weight', 'total', 'totalUsd', 'status'],
            filteredShipments.map((s) => [
              s.shipmentNo,
              s.date,
              s.senderName,
              s.receiverName,
              s.destinationName,
              s.weight,
              s.total,
              shipmentAmountUsd(s.total || 0, s.currency).toFixed(2),
              SHIPMENT_STATUS_LABELS[s.status] ?? s.status,
            ]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        case 'destination': {
          const byDest = filteredShipments.reduce(
            (acc, s) => {
              const k = s.destinationName || '—';
              if (!acc[k]) acc[k] = { count: 0, weight: 0, total: 0 };
              acc[k].count++;
              acc[k].weight += s.weight;
              acc[k].total += shipmentAmountUsd(s.total || 0, s.currency);
              return acc;
            },
            {} as Record<string, { count: number; weight: number; total: number }>,
          );
          downloadCsv(
            `report-destination-${d0}_${d1}.csv`,
            ['destination', 'count', 'weight', 'totalUsd'],
            Object.entries(byDest).map(([dest, v]) => [dest, v.count, v.weight, v.total.toFixed(2)]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        }
        case 'driver': {
          const byDriver = filteredShipments.reduce(
            (acc, s) => {
              const name =
                s.driverId && driverNameById.has(s.driverId) ? driverNameById.get(s.driverId)! : 'غير مُعيّن';
              if (!acc[name]) acc[name] = { count: 0, weight: 0, total: 0 };
              acc[name].count++;
              acc[name].weight += s.weight;
              acc[name].total += shipmentAmountUsd(s.total || 0, s.currency);
              return acc;
            },
            {} as Record<string, { count: number; weight: number; total: number }>,
          );
          downloadCsv(
            `report-driver-${d0}_${d1}.csv`,
            ['driver', 'shipments', 'weight', 'totalUsd'],
            Object.entries(byDriver).map(([dn, v]) => [dn, v.count, v.weight, v.total.toFixed(2)]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        }
        case 'pending':
          downloadCsv(
            `report-pending-${d0}_${d1}.csv`,
            ['shipmentNo', 'date', 'sender', 'receiver', 'status'],
            filteredShipments.filter(isPending).map((s) => [
              s.shipmentNo,
              s.date,
              s.senderName,
              s.receiverName,
              SHIPMENT_STATUS_LABELS[s.status] ?? s.status,
            ]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        case 'customer': {
          const tag =
            accountScope !== 'all' && accountPartyId
              ? `${accountScope}-${accountPartyId.slice(0, 8)}`
              : 'aggregated';
          downloadCsv(
            `report-finance-summary-${d0}_${d1}-${tag}.csv`,
            ['metric', 'usd'],
            [
              ['رصيد_افتتاحي', String(statementSummary?.opening_balance_usd ?? 0)],
              ['دخل_الفترة', String(statementSummary?.period_inflow_usd ?? 0)],
              ['صرف_الفترة', String(statementSummary?.period_outflow_usd ?? 0)],
              ['رصيد_ختامي', String(statementSummary?.closing_balance_usd ?? 0)],
            ],
          );
          if (partyEntries.length) {
            downloadCsv(
              `report-party-entries-${d0}_${d1}.csv`,
              ['date', 'party_type', 'movement', 'voucher', 'amount', 'currency', 'usd', 'reversal'],
              partyEntries.map((row) => [
                row.created_at,
                row.party_type,
                row.movement_type,
                row.voucher_id,
                row.original_amount,
                row.original_currency,
                row.signed_base_amount_usd ?? row.base_amount_usd ?? 0,
                row.is_reversal ? 'yes' : 'no',
              ]),
            );
          }
          showToast(
            partyEntries.length ? 'تم تنزيل الملف (ملخص + حركات إن وُجدت)' : 'تم تنزيل الملف',
            'success',
          );
          return;
        }
        case 'cash':
          downloadCsv(
            `report-cash-${d0}_${d1}.csv`,
            ['created_at', 'type', 'voucher', 'amount', 'currency', 'usd', 'notes'],
            cashboxInRange.map((t) => [
              t.created_at,
              t.transaction_type,
              t.source_voucher_id,
              t.original_amount,
              t.original_currency,
              t.base_amount_usd,
              (t.notes || '').replace(/\r?\n/g, ' '),
            ]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        case 'manifest':
          downloadCsv(
            `report-manifest-${d0}_${d1}.csv`,
            ['manifestNo', 'date', 'vehicle', 'driver', 'shipments', 'weight', 'status'],
            filteredManifests.map((m) => [
              m.manifestNo,
              m.date,
              m.vehiclePlate,
              m.driverName,
              m.totalShipments,
              m.totalWeight,
              m.status,
            ]),
          );
          showToast('تم تنزيل الملف', 'success');
          return;
        default:
          showToast('لا يوجد تصدير لهذا التقرير', 'info');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر التصدير', 'error');
    }
  };

  const renderReport = () => {
    switch (selectedReport) {
      case 'daily':
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">شركة شحن</div>
              <div className="print-subtitle">التقرير اليومي للشحنات</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <table className="print-table">
              <thead>
                <tr>
                  <th>رقم الشحنة</th>
                  <th>التاريخ</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>الوجهة</th>
                  <th>الوزن</th>
                  <th>المجموع الأصلي</th>
                  <th>المجموع USD</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filteredShipments.map((s) => (
                  <tr key={s.id}>
                    <td>{s.shipmentNo}</td>
                    <td>{s.date}</td>
                    <td>{s.senderName}</td>
                    <td>{s.receiverName}</td>
                    <td>{s.destinationName}</td>
                    <td>{s.weight}</td>
                    <td>{formatCurrency(s.total || 0, (s.currency || 'USD') as CurrencyCode)}</td>
                    <td>{formatCurrency(shipmentAmountUsd(s.total || 0, s.currency), 'USD')}</td>
                    <td>{SHIPMENT_STATUS_LABELS[s.status] ?? s.status}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="text-left font-bold">
                    الإجمالي
                  </td>
                  <td className="text-left font-bold">
                    {filteredShipments.reduce((s, s2) => s + s2.weight, 0)}
                  </td>
                  <td className="text-left font-bold">-</td>
                  <td className="text-left font-bold">
                    {formatCurrency(
                      filteredShipments.reduce((s, s2) => s + shipmentAmountUsd(s2.total || 0, s2.currency), 0),
                      'USD',
                    )}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            <div className="print-footer">
              <div>تاريخ الطباعة: {new Date().toLocaleDateString('ar')}</div>
              <div>إجمالي الشحنات: {filteredShipments.length}</div>
            </div>
          </div>
        );

      case 'destination': {
        const byDestination = filteredShipments.reduce(
          (acc, s) => {
            const k = s.destinationName || '—';
            if (!acc[k]) acc[k] = { count: 0, weight: 0, total: 0 };
            acc[k].count++;
            acc[k].weight += s.weight;
            acc[k].total += shipmentAmountUsd(s.total || 0, s.currency);
            return acc;
          },
          {} as Record<string, { count: number; weight: number; total: number }>,
        );

        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">تقرير الشحنات حسب الوجهة</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <table className="print-table">
              <thead>
                <tr>
                  <th>الوجهة</th>
                  <th>عدد الشحنات</th>
                  <th>إجمالي الوزن</th>
                  <th>إجمالي المبالغ (USD)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byDestination).map(([dest, data]) => (
                  <tr key={dest}>
                    <td>{dest}</td>
                    <td>{data.count}</td>
                    <td>{data.weight}</td>
                    <td>{formatCurrency(data.total, 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'driver': {
        const byDriver = filteredShipments.reduce(
          (acc, s) => {
            const name =
              s.driverId && driverNameById.has(s.driverId) ? driverNameById.get(s.driverId)! : 'غير مُعيّن';
            if (!acc[name]) acc[name] = { count: 0, weight: 0, total: 0 };
            acc[name].count++;
            acc[name].weight += s.weight;
            acc[name].total += shipmentAmountUsd(s.total || 0, s.currency);
            return acc;
          },
          {} as Record<string, { count: number; weight: number; total: number }>,
        );
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">الشحنات حسب السائق</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-2">عند عدم ربط شحنة بسائق تظهر تحت &quot;غير مُعيّن&quot;.</p>
            <table className="print-table">
              <thead>
                <tr>
                  <th>السائق</th>
                  <th>عدد الشحنات</th>
                  <th>الوزن</th>
                  <th>الإجمالي (USD)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byDriver).map(([dn, v]) => (
                  <tr key={dn}>
                    <td>{dn}</td>
                    <td>{v.count}</td>
                    <td>{v.weight}</td>
                    <td>{formatCurrency(v.total, 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'pending': {
        const pendingShipments = filteredShipments.filter(isPending);
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">الشحنات غير المُنهية</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-2">كل شحنة لم تُسلَّم بعد أو تُلغَ ضمن نطاق التاريخ.</p>
            <table className="print-table">
              <thead>
                <tr>
                  <th>رقم الشحنة</th>
                  <th>التاريخ</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {pendingShipments.map((s) => (
                  <tr key={s.id}>
                    <td>{s.shipmentNo}</td>
                    <td>{s.date}</td>
                    <td>{s.senderName}</td>
                    <td>{s.receiverName}</td>
                    <td>{SHIPMENT_STATUS_LABELS[s.status] ?? s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'customer': {
        const showPartyTable = partyEntries.length > 0;
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">ملخص مالي — الأطراف</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            {accountScope !== 'all' && !accountPartyId.trim() && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                اختر العميل أو المرسل/المستلم من الفلاتر أعلاه، ثم اضغط «عرض الكشف» لعرض كشفه التفصيلي. يُعرض
                الآن الملخص المجمّع لجميع الأطراف.
              </p>
            )}
            {accountScope !== 'all' && accountPartyId.trim() && (
              <p className="text-sm text-gray-600 mb-3">
                عرض كشف مالي لطرف واحد (من السيرفر) مع جدول الحركات عند التوفر.
              </p>
            )}
            {accountScope === 'all' && (
              <p className="text-sm text-gray-600 mb-3">
                ملخص مُجمّع لحركات الأطراف ضمن نطاق التاريخ. للكشف التفصيلي الكامل استخدم «التقارير المالية» في
                القائمة.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(statementSummary?.opening_balance_usd || 0, 'USD')}</div>
                <div className="stat-label">رصيد افتتاحي</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(statementSummary?.period_inflow_usd || 0, 'USD')}</div>
                <div className="stat-label">دخل الفترة</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(statementSummary?.period_outflow_usd || 0, 'USD')}</div>
                <div className="stat-label">صرف الفترة</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(statementSummary?.closing_balance_usd || 0, 'USD')}</div>
                <div className="stat-label">رصيد ختامي</div>
              </div>
            </div>
            {showPartyTable && (
              <div className="mt-4">
                <h3 className="text-lg font-bold mb-2">حركات الطرف (تفصيلي)</h3>
                <div className="overflow-auto max-h-96">
                  <table className="print-table text-sm w-full">
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>النوع</th>
                        <th>سند</th>
                        <th>الاتجاه</th>
                        <th>مبلغ</th>
                        <th>دولار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partyEntries.map((row) => (
                        <tr key={row.id}>
                          <td>{row.created_at?.split('T')[0]}</td>
                          <td>{row.movement_type}</td>
                          <td>{row.voucher_id?.slice(0, 8)}</td>
                          <td>{row.direction}</td>
                          <td>
                            {formatCurrency(Number(row.original_amount), row.original_currency as CurrencyCode)}
                          </td>
                          <td>
                            {formatCurrency(Number(row.signed_base_amount_usd ?? row.base_amount_usd ?? 0), 'USD')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'cash': {
        const net = cashboxInRange.reduce((sum, t) => {
          const u = Number(t.base_amount_usd || 0);
          return sum + (t.transaction_type === 'inflow' ? u : -u);
        }, 0);
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">ملخص حركات الصندوق</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="stat-card">
                <div className="stat-value">{cashboxInRange.length}</div>
                <div className="stat-label">عدد الحركات</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(net, 'USD')}</div>
                <div className="stat-label">صافي تقديري (USD)</div>
              </div>
            </div>
            <table className="print-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>النوع</th>
                  <th>مرجع سند</th>
                  <th>مبلغ</th>
                  <th>USD</th>
                </tr>
              </thead>
              <tbody>
                {cashboxInRange.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.created_at).toLocaleString()}</td>
                    <td>{t.transaction_type === 'inflow' ? 'وارد' : 'صادر'}</td>
                    <td>{t.source_voucher_id?.slice(0, 8) ?? '—'}</td>
                    <td>
                      {formatCurrency(Number(t.original_amount), t.original_currency as CurrencyCode)}
                    </td>
                    <td>{formatCurrency(Number(t.base_amount_usd), 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'manifest':
        return (
          <div className="print-preview">
            <div className="print-header">
              <div className="print-title">تقارير التحميل (Manifest)</div>
              <div>
                الفترة: {appliedDateFrom} إلى {appliedDateTo}
              </div>
            </div>
            <table className="print-table">
              <thead>
                <tr>
                  <th>رقم</th>
                  <th>التاريخ</th>
                  <th>المركبة</th>
                  <th>السائق</th>
                  <th>شحنات</th>
                  <th>الوزن</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filteredManifests.map((m) => (
                  <tr key={m.id}>
                    <td>{m.manifestNo}</td>
                    <td>{m.date}</td>
                    <td>{m.vehiclePlate || '—'}</td>
                    <td>{m.driverName || '—'}</td>
                    <td>{m.totalShipments}</td>
                    <td>{m.totalWeight}</td>
                    <td>{m.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredManifests.length === 0 && (
              <p className="text-center p-4 text-gray-600">لا سجلات تحميل في هذه الفترة</p>
            )}
          </div>
        );

      default:
        return (
          <div className="print-preview">
            <p className="text-center p-8 text-gray-600">اختر نوع التقرير من القائمة اليسرى</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">التقارير</h2>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden min-h-0">
        <div className="w-64 card overflow-auto flex-shrink-0">
          <div className="card-header">اختر التقرير</div>
          <div className="space-y-1">
            {reportTypes.map((rt) => (
              <button
                key={rt.id}
                type="button"
                onClick={() => setSelectedReport(rt.id as ReportType)}
                className={`w-full text-right px-3 py-2 rounded ${
                  selectedReport === rt.id ? 'bg-primary text-white' : 'hover:bg-gray-100'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <ReportControlBar
            onExecute={handleExecuteReport}
            actions={[
              { id: 'print', label: 'طباعة', onClick: () => window.print() },
              { id: 'export', label: 'تصدير Excel (CSV)', onClick: () => (hasAppliedFilters ? buildExport() : showToast('اعرض التقرير أولاً', 'info')) },
              { id: 'clear', label: 'مسح عرض', onClick: resetFilters },
            ]}
            filters={
              <>
                <div className="form-group">
                  <label className="form-label">من تاريخ</label>
                  <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">إلى تاريخ</label>
                  <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                {selectedReport === 'customer' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">نطاق الملخص المالي</label>
                      <select
                        className="form-select min-w-[200px]"
                        value={accountScope}
                        onChange={(e) => {
                          const v = e.target.value as 'all' | 'customer' | 'sender_receiver';
                          setAccountScope(v);
                          setAccountPartyId('');
                        }}
                      >
                        <option value="all">جميع الأطراف (إجمالي)</option>
                        <option value="customer">عميل محدد</option>
                        <option value="sender_receiver">مرسل/مستلم محدد</option>
                      </select>
                    </div>
                    {accountScope === 'customer' && (
                      <div className="form-group">
                        <label className="form-label">العميل</label>
                        <select
                          className="form-select min-w-[220px]"
                          value={accountPartyId}
                          onChange={(e) => setAccountPartyId(e.target.value)}
                        >
                          <option value="">— اختر —</option>
                          {customersList.map((c) => {
                            const bid = getBackendIdFromSynthetic(c.id);
                            if (!bid) return null;
                            return (
                              <option key={c.id} value={bid}>
                                {c.name} ({c.code})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    {accountScope === 'sender_receiver' && (
                      <div className="form-group">
                        <label className="form-label">المرسل/المستلم</label>
                        <select
                          className="form-select min-w-[220px]"
                          value={accountPartyId}
                          onChange={(e) => setAccountPartyId(e.target.value)}
                        >
                          <option value="">— اختر —</option>
                          {sendersList.map((c) => {
                            const bid = getBackendIdFromSynthetic(c.id);
                            if (!bid) return null;
                            return (
                              <option key={c.id} value={bid}>
                                {c.name} ({c.code})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </>
            }
          />

          <div className="flex-1 overflow-auto bg-gray-200 p-4 min-h-0">
            {hasAppliedFilters ? (
              loading ? (
                <div className="card text-center p-8 text-gray-600">جاري تحميل بيانات التقارير…</div>
              ) : (
                renderReport()
              )
            ) : (
              <div className="card text-center p-4 text-gray-600">اختر نطاق التواريخ ثم اضغط &quot;عرض الكشف&quot;</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
