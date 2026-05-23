import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer } from '../../types';
import ReportControlBar from '../../components/ReportControlBar';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { getBackendIdFromSynthetic, phase15Gateway } from '../../lib/api/phase15Gateway';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

const LEDGER_PAGE = 200;

export default function FinanceReports() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [currencyRows, setCurrencyRows] = useState<any[]>([]);
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [sendersList, setSendersList] = useState<Customer[]>([]);
  const [accountScope, setAccountScope] = useState<'all' | 'customer' | 'sender_receiver'>('all');
  const [accountPartyId, setAccountPartyId] = useState('');
  const initialLoad = useRef(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const fromAt = new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toAt = new Date(`${dateTo}T23:59:59Z`).toISOString();

      const scoped = accountScope !== 'all' && accountPartyId.trim() !== '';
      const party: {
        partyType?: 'customer' | 'sender_receiver';
        partyId?: string;
      } = {};
      if (scoped) {
        party.partyType = accountScope;
        party.partyId = accountPartyId.trim();
      }

      const [pkg, snapshot, ledgerData, cur, cust, snd] = await Promise.all([
        phase3FinanceGateway.statements.getPackage({ fromAt, toAt, page: 1, pageSize: 25, ...party }),
        phase3FinanceGateway.statements.getAnalyticsSnapshot({ fromAt, toAt, topN: 8, ...party }),
        phase3FinanceGateway.statements.getLedger({
          fromAt,
          toAt,
          page: 1,
          pageSize: LEDGER_PAGE,
          ...party,
        }),
        phase3FinanceGateway.statements.getCurrencySummary({ fromAt, toAt, includeReversals: true, ...party }),
        phase15Gateway.customers.getAll(),
        phase15Gateway.sendersReceivers.getAll(),
      ]);
      setSummary(pkg?.summary || null);
      setAnalytics(snapshot || null);
      setLedger(ledgerData?.rows || []);
      setCurrencyRows(cur || []);
      setCustomersList(cust);
      setSendersList(snd);
      setHasAppliedFilters(true);
    } catch {
      showToast('تعذر تحميل التقرير المالي', 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, showToast, accountScope, accountPartyId]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadReport();
  }, [loadReport]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">التقارير المالية</h2>
      </div>

      <ReportControlBar
        onExecute={() => void loadReport()}
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          {
            id: 'export',
            label: 'تصدير Excel (CSV)',
            onClick: () => {
              if (!hasAppliedFilters) {
                showToast('حمّل التقرير أولاً', 'info');
                return;
              }
              const tag = `${dateFrom}_${dateTo}`;
              const scope = accountScope !== 'all' && accountPartyId ? `-${accountScope}-${accountPartyId.slice(0, 8)}` : '';
              downloadCsv(`finance-summary${scope}-${tag}.csv`, ['metric', 'value_usd'], [
                ['opening_balance_usd', summary?.opening_balance_usd ?? 0],
                ['period_inflow_usd', summary?.period_inflow_usd ?? 0],
                ['period_outflow_usd', summary?.period_outflow_usd ?? 0],
                ['closing_balance_usd', summary?.closing_balance_usd ?? 0],
              ]);
              downloadCsv(`finance-ledger${scope}-${tag}.csv`, ['date', 'party', 'movement', 'direction', 'amount', 'currency', 'usd'], ledger.map((row: any) => [
                row.created_at?.split('T')[0] ?? '',
                row.party_type,
                row.movement_type,
                row.direction,
                row.original_amount,
                row.original_currency,
                row.signed_base_amount_usd ?? row.base_amount_usd ?? 0,
              ]));
              if (currencyRows.length) {
                downloadCsv(`finance-currency${scope}-${tag}.csv`, ['currency', 'entries', 'in_orig', 'out_orig', 'net_orig', 'in_usd', 'out_usd', 'net_usd'], currencyRows.map((r: any) => [
                  r.original_currency,
                  r.entries_count,
                  r.inflow_original_amount,
                  r.outflow_original_amount,
                  r.net_original_amount,
                  r.inflow_base_usd,
                  r.outflow_base_usd,
                  r.net_base_usd,
                ]));
              }
              showToast('تم التصدير (ملفات CSV)', 'success');
            },
          },
          {
            id: 'export-pdf',
            label: 'تصدير PDF',
            onClick: async () => {
              if (!hasAppliedFilters) {
                showToast('حمّل التقرير أولاً', 'info');
                return;
              }
              const tag = `${dateFrom}_${dateTo}`;
              const scope = accountScope !== 'all' && accountPartyId ? `-${accountScope}-${accountPartyId.slice(0, 8)}` : '';
              const subtitle = `من ${dateFrom} إلى ${dateTo} | افتتاحي: ${formatCurrency(summary?.opening_balance_usd || 0, 'USD')} | ختامي: ${formatCurrency(summary?.closing_balance_usd || 0, 'USD')}`;
              const result = await exportPdfTable({
                title: 'دفتر الحركات (تقرير مالي)',
                subtitle,
                defaultFileName: `finance-ledger${scope}-${tag}.pdf`,
                headers: ['التاريخ', 'الطرف', 'نوع الحركة', 'الاتجاه', 'المبلغ', 'العملة', 'USD'],
                rows: ledger.map((row: any) => [
                  row.created_at?.split('T')[0] ?? '',
                  row.party_type,
                  row.movement_type,
                  row.direction,
                  row.original_amount,
                  row.original_currency,
                  row.signed_base_amount_usd ?? row.base_amount_usd ?? 0,
                ]),
              });
              if (result.saved) showToast('تم حفظ ملف PDF', 'success');
              else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
            },
          },
          {
            id: 'clear',
            label: 'مسح العرض',
            onClick: () => {
              setHasAppliedFilters(false);
              setSummary(null);
              setAnalytics(null);
              setLedger([]);
              setCurrencyRows([]);
            },
          },
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
            <div className="form-group">
              <label className="form-label">نطاق الطرف</label>
              <select
                className="form-select min-w-[200px]"
                value={accountScope}
                onChange={(e) => {
                  setAccountScope(e.target.value as 'all' | 'customer' | 'sender_receiver');
                  setAccountPartyId('');
                }}
              >
                <option value="all">الكل (إجمالي)</option>
                <option value="customer">عميل</option>
                <option value="sender_receiver">مرسل/مستلم</option>
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
        }
      />

      {accountScope !== 'all' && !accountPartyId.trim() && hasAppliedFilters && !loading && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
          لم يُحدد طرف: يُعرض الإجمالي. اختر عميلاً أو مرسل/مستلماً ثم اضغط «عرض الكشف».
        </p>
      )}

      {loading && <div className="text-sm text-gray-500 mb-2">جاري التحميل…</div>}

      {hasAppliedFilters && !loading && (
        <>
          <div className="grid grid-cols-4 gap-4 mb-4 print:block">
            <div className="stat-card">
              <div className="stat-value">{formatCurrency(summary?.opening_balance_usd || 0, 'USD')}</div>
              <div className="stat-label">الرصيد الافتتاحي</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatCurrency(summary?.period_inflow_usd || 0, 'USD')}</div>
              <div className="stat-label">إجمالي الداخل</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatCurrency(summary?.period_outflow_usd || 0, 'USD')}</div>
              <div className="stat-label">إجمالي الخارج</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatCurrency(summary?.closing_balance_usd || 0, 'USD')}</div>
              <div className="stat-label">الرصيد الختامي</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="card">
              <div className="card-header">مؤشرات</div>
              <div>الحركات: {analytics?.kpis?.entries_count || 0}</div>
              <div>الأطراف: {analytics?.kpis?.parties_count || 0}</div>
            </div>
            <div className="card">
              <div className="card-header">أكثر الأطراف نشاطاً (صافي)</div>
              <div className="space-y-1 text-sm">
                {(analytics?.topParties || []).map((row: any) => (
                  <div key={`${row.party_type}-${row.party_id}`}>
                    {row.party_type} · {formatCurrency(row.net_base_usd, 'USD')}
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header">تطور (آخر أيام)</div>
              <div className="space-y-1 text-sm">
                {(analytics?.trend || []).slice(-5).map((row: any) => (
                  <div key={row.day}>
                    {row.day?.split('T')[0]}: {formatCurrency(row.net_base_usd, 'USD')}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {currencyRows.length > 0 && (
            <div className="card overflow-auto mb-4">
              <div className="card-header">ملخص حسب العملة</div>
              <table className="data-grid text-sm">
                <thead>
                  <tr>
                    <th>العملة</th>
                    <th>سجلات</th>
                    <th>وارد (أصلي)</th>
                    <th>صادر (أصلي)</th>
                    <th>صافٍ (أصلي)</th>
                    <th>وارد USD</th>
                    <th>صادر USD</th>
                    <th>صافٍ USD</th>
                  </tr>
                </thead>
                <tbody>
                  {currencyRows.map((r: any) => (
                    <tr key={r.original_currency}>
                      <td>{r.original_currency}</td>
                      <td>{r.entries_count}</td>
                      <td className="text-left">{formatCurrency(r.inflow_original_amount, r.original_currency as CurrencyCode)}</td>
                      <td className="text-left">{formatCurrency(r.outflow_original_amount, r.original_currency as CurrencyCode)}</td>
                      <td className="text-left">{formatCurrency(r.net_original_amount, r.original_currency as CurrencyCode)}</td>
                      <td className="text-left">{formatCurrency(r.inflow_base_usd, 'USD')}</td>
                      <td className="text-left">{formatCurrency(r.outflow_base_usd, 'USD')}</td>
                      <td className="text-left">{formatCurrency(r.net_base_usd, 'USD')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card overflow-auto">
            <div className="card-header flex justify-between items-center">
              <span>دفتر الحركات (حتى {LEDGER_PAGE} سطر)</span>
            </div>
            <table className="data-grid text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الطرف</th>
                  <th>نوع الحركة</th>
                  <th>الاتجاه</th>
                  <th>المبلغ الأصلي</th>
                  <th>USD</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row: any) => (
                  <tr key={row.id}>
                    <td>{row.created_at.split('T')[0]}</td>
                    <td>{row.party_type}</td>
                    <td>{row.movement_type}</td>
                    <td>{row.direction}</td>
                    <td>{formatCurrency(Number(row.original_amount), row.original_currency as CurrencyCode)}</td>
                    <td>{formatCurrency(Number(row.signed_base_amount_usd || row.base_amount_usd || 0), 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.length === 0 && <p className="p-4 text-gray-500">لا حركات في النطاق</p>}
          </div>
        </>
      )}
    </div>
  );
}
