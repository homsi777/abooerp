import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpClient } from '../../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../../lib/api/phase3FinanceGateway';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../../lib/api/phase15Gateway';
import { useToast } from '../../../components/Toast';
import FinanceExportToolbar from '../../../components/finance/FinanceExportToolbar';
import FinanceCurrencySelect from '../../../components/finance/FinanceCurrencySelect';
import { financePartyTypeLabel } from '../../../lib/finance/financeArabicLabels';
import { formatWesternDateTime, formatWesternNumber } from '../../../lib/format/westernDigits';
import { downloadCsv } from '../../../lib/export/csvDownload';
import {
  DEFAULT_STATEMENT_DATE_FROM,
  StatementDateRangeBar,
  StatementSummaryGrid,
  todayIsoDate,
} from './statementShared';

type PartyType = 'agent' | 'customer' | 'sender_receiver';

const PARTY_LABELS: Record<PartyType, string> = {
  agent: 'الوكيل',
  customer: 'العميل',
  sender_receiver: 'المرسل / المستلم',
};

export default function PartyStatementPage({ partyType }: { partyType: PartyType }) {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [dateFrom, setDateFrom] = useState(DEFAULT_STATEMENT_DATE_FROM);
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [partyId, setPartyId] = useState(searchParams.get('partyId') || '');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([]);
  const [pkg, setPkg] = useState<{
    summary: {
      opening_balance_usd: number;
      period_inflow_usd: number;
      period_outflow_usd: number;
      closing_balance_usd: number;
    };
    ledger: {
      rows: Array<{
        id: string;
        created_at: string;
        notes?: string;
        movement_type?: string;
        debit?: number;
        credit?: number;
        running_balance?: number;
        reference_no?: string;
        shipment_no?: string;
      }>;
    };
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (partyType === 'agent') {
          const rows = await httpClient.get<Array<{ id: string; name: string; governorate?: string }>>(
            '/agents?includeInactive=false',
          );
          setParties(rows.map((r) => ({ id: r.id, name: r.governorate ? `${r.name} — ${r.governorate}` : r.name })));
        } else if (partyType === 'customer') {
          const rows = await phase15Gateway.customers.getAll();
          setParties(rows.map((c) => ({
            id: getBackendIdFromSynthetic(c.id) || String(c.id),
            name: c.name,
          })));
        } else {
          const rows = await phase15Gateway.sendersReceivers.getAll();
          setParties(rows.map((p) => ({
            id: getBackendIdFromSynthetic(p.id) || String(p.id),
            name: p.name,
          })));
        }
      } catch {
        setParties([]);
      }
    })();
  }, [partyType]);

  const load = async () => {
    if (!partyId) {
      showToast(`اختر ${PARTY_LABELS[partyType]} أولاً`, 'error');
      return;
    }
    setLoading(true);
    try {
      const [summary, detailed] = await Promise.all([
        phase3FinanceGateway.statements.getSummary({
          partyType,
          partyId,
          fromAt: `${dateFrom}T00:00:00.000Z`,
          toAt: `${dateTo}T23:59:59.999Z`,
        }),
        phase3FinanceGateway.accountStatement.getDetailed({
          partyType,
          partyId,
          currencyCode: currencyCode || undefined,
          dateFrom: `${dateFrom}T00:00:00.000Z`,
          dateTo: `${dateTo}T23:59:59.999Z`,
          pageSize: 2000,
        }),
      ]);
      setPkg(
        summary
          ? {
              summary,
              ledger: {
                page: 1,
                pageSize: detailed.rows.length,
                total: detailed.rows.length,
                rows: detailed.rows.map((row) => ({
                  id: row.id,
                  party_type: partyType,
                  party_id: partyId,
                  movement_type: row.referenceType as 'voucher_receipt' | 'voucher_payment',
                  voucher_type: 'receipt' as const,
                  voucher_id: row.id,
                  direction: row.debit > 0 ? ('debit' as const) : ('credit' as const),
                  original_amount: row.debit > 0 ? row.debit : row.credit,
                  original_currency: (row.currencyCode || 'USD') as 'USD',
                  base_amount_usd: row.debit > 0 ? row.debit : row.credit,
                  created_at: row.date,
                  notes: row.description,
                  reference_no: row.referenceNo,
                  shipment_no: row.shipmentNo,
                  debit: row.debit,
                  credit: row.credit,
                  running_balance: row.runningBalance,
                })),
              },
            }
          : null,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل كشف الحساب', 'error');
      setPkg(null);
    } finally {
      setLoading(false);
    }
  };

  const ledgerRows = pkg?.ledger?.rows ?? [];
  const summary = pkg?.summary;

  const mappedLedger = useMemo(() => {
    return ledgerRows.map((row) => ({
      id: row.id,
      date: row.created_at,
      description: row.notes || row.movement_type || '—',
      debit: Number(row.debit ?? 0),
      credit: Number(row.credit ?? 0),
      running: Number(row.running_balance ?? 0),
      reference: row.shipment_no || row.reference_no || '—',
    }));
  }, [ledgerRows]);

  const csvRows = useMemo(
    () =>
      mappedLedger.map((row) => ({
        التاريخ: row.date?.slice(0, 10) ?? '',
        البيان: row.description,
        مدين: row.debit,
        دائن: row.credit,
        الرصيد: row.running,
        المرجع: row.reference,
      })),
    [mappedLedger],
  );

  const partyName = parties.find((p) => p.id === partyId)?.name ?? '';

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">كشف حساب — {PARTY_LABELS[partyType]}</h3>

      <StatementDateRangeBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(next) => {
          if (next.dateFrom !== undefined) setDateFrom(next.dateFrom);
          if (next.dateTo !== undefined) setDateTo(next.dateTo);
        }}
        onApply={() => void load()}
        loading={loading}
        extra={
          <>
            <label className="text-sm min-w-[12rem]">
              <span className="block text-gray-600 mb-1">{PARTY_LABELS[partyType]}</span>
              <select className="form-select w-full" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">— اختر —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">العملة</span>
              <FinanceCurrencySelect value={currencyCode} onChange={setCurrencyCode} />
            </label>
            <FinanceExportToolbar
              disabled={!mappedLedger.length}
              csvFilename={`statement-${partyType}-${dateFrom}.csv`}
              csvRows={csvRows}
            />
          </>
        }
      />

      {summary && (
        <StatementSummaryGrid
          items={[
            { label: 'الطرف', value: partyName || partyId },
            { label: 'نوع الطرف', value: financePartyTypeLabel(partyType) },
            {
              label: 'رصيد افتتاحي',
              value: formatWesternNumber(Number(summary.opening_balance_usd ?? 0), { minimumFractionDigits: 2 }),
            },
            {
              label: 'إجمالي مدين',
              value: formatWesternNumber(Number(summary.period_inflow_usd ?? 0), { minimumFractionDigits: 2 }),
            },
            {
              label: 'إجمالي دائن',
              value: formatWesternNumber(Number(summary.period_outflow_usd ?? 0), { minimumFractionDigits: 2 }),
            },
            {
              label: 'رصيد ختامي',
              value: formatWesternNumber(Number(summary.closing_balance_usd ?? 0), { minimumFractionDigits: 2 }),
              highlight: true,
            },
          ]}
        />
      )}

      <div className="card overflow-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>البيان</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>الرصيد</th>
              <th>المرجع</th>
            </tr>
          </thead>
          <tbody>
            {mappedLedger.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-6">
                  اختر الطرف والفترة ثم اضغط «عرض الكشف».
                </td>
              </tr>
            )}
            {mappedLedger.map((row) => (
              <tr key={row.id}>
                <td>{formatWesternDateTime(row.date)}</td>
                <td>{row.description}</td>
                <td>{formatWesternNumber(row.debit, { minimumFractionDigits: 2 })}</td>
                <td>{formatWesternNumber(row.credit, { minimumFractionDigits: 2 })}</td>
                <td>{formatWesternNumber(row.running, { minimumFractionDigits: 2 })}</td>
                <td>{row.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
