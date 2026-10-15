import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { getExchangeRatesToUsd, getRateToUsd, type CurrencyCode } from '../../lib/currency/currency';
import { useAuth } from '../../context/AuthProvider';
import { useToast } from '../../components/Toast';
import FinanceCurrencySelect from '../../components/finance/FinanceCurrencySelect';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { printLedgerStyleDocument } from '../../lib/export/ledgerStylePrint';
import { formatWesternDateTime, formatWesternNumber } from '../../lib/format/westernDigits';

// New "السندات" screen — receipt (قبض) / payment (دفع) / manual journal (قيد يدوي).
// Built fresh per the approved Finance-hub redesign; does not reuse the
// previous vouchers screen's markup. Only two shared UI primitives are
// reused as instructed: FinanceCurrencySelect and FinanceExportToolbar.
//
// NOTE ON DATA FETCHING: the existing phase3FinanceGateway.receiptVouchers/
// paymentVouchers mappers (toReceiptVoucher/toPaymentVoucher) are lossy for
// this screen's needs — they hide `status` inside an unrelated `createdBy`
// field and drop `sender_receiver_id` entirely. Since accurate status and
// party-type display are core to this screen's spec, the raw
// /receipt-vouchers and /payment-vouchers endpoints are called directly via
// httpClient instead of going through that mapper.

type VoucherKind = 'receipt' | 'payment' | 'journal' | 'discount';
type PartyType = 'agent' | 'customer' | 'sender_receiver';
type VoucherStatus = 'draft' | 'confirmed' | 'cancelled';

interface ChartOfAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: 'debit' | 'credit';
}

interface RawJournalEntry {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  status: 'draft' | 'posted' | 'reversed';
  created_at: string;
  total_debit: number | string;
  total_credit: number | string;
}

function journalStatusToVoucherStatus(s: RawJournalEntry['status']): VoucherStatus {
  if (s === 'posted') return 'confirmed';
  if (s === 'reversed') return 'cancelled';
  return 'draft';
}

function toJournalVoucherRow(row: RawJournalEntry): VoucherRow {
  return {
    id: row.id,
    voucherNo: row.entry_no,
    createdAt: row.created_at,
    kind: 'journal',
    partyType: null,
    partyName: row.description || '—',
    amount: Number(row.total_debit),
    currency: 'USD',
    cashboxName: null,
    status: journalStatusToVoucherStatus(row.status),
    displayNo: '',
    partyId: null,
    cashboxId: null,
    exchangeRateToUsd: 1,
    notes: '',
    baseAmountUsd: Number(row.total_debit),
    createdByUsername: null,
    createdByFullName: null,
  };
}

interface RawVoucher {
  id: string;
  voucher_no: string;
  branch_id?: string | null;
  agent_id?: string | null;
  customer_id?: string | null;
  sender_receiver_id?: string | null;
  cashbox_id?: string | null;
  cashbox_name?: string | null;
  cashbox_code?: string | null;
  party_display_name?: string | null;
  status: VoucherStatus;
  notes?: string | null;
  original_amount: number | string;
  original_currency: string;
  exchange_rate_to_usd: number | string;
  base_amount_usd: number | string;
  created_at: string;
  created_by_username?: string | null;
  created_by_full_name?: string | null;
}

interface VoucherRow {
  id: string;
  voucherNo: string;
  createdAt: string;
  kind: VoucherKind;
  partyType: PartyType | null;
  partyName: string;
  amount: number;
  currency: string;
  cashboxName: string | null;
  status: VoucherStatus;
  /** Clean sequential display number (000001, 000002, ...), assigned by
   * creation-date order — shown in the "الرقم" column instead of the raw
   * internal voucher_no (e.g. "RV-1780936549109"), which stays unchanged
   * in the database and everywhere else it's already used (printed
   * receipts, reconciliation reports, etc.) to avoid touching real
   * financial records outside this screen's display. */
  displayNo: string;
  // Raw fields kept only for edit-form prefill and printing — not shown
  // directly in the table.
  partyId: string | null;
  cashboxId: string | null;
  exchangeRateToUsd: number;
  notes: string;
  baseAmountUsd: number;
  createdByUsername: string | null;
  createdByFullName: string | null;
}

interface PartyOption {
  id: string;
  name: string;
}

interface RawDiscountVoucher {
  id: string;
  voucher_no: string;
  shipment_id: string;
  shipment_no: string;
  agent_id: string | null;
  agent_name: string | null;
  amount_usd: number | string;
  notes: string | null;
  reversed_at: string | null;
  created_at: string;
  created_by_username?: string | null;
  created_by_full_name?: string | null;
}

function toDiscountVoucherRow(row: RawDiscountVoucher): VoucherRow {
  return {
    id: row.id,
    voucherNo: row.voucher_no,
    createdAt: row.created_at,
    kind: 'discount',
    partyType: 'agent',
    partyName: row.agent_name || '—',
    amount: Number(row.amount_usd),
    currency: 'USD',
    cashboxName: null,
    status: row.reversed_at ? 'cancelled' : 'confirmed',
    displayNo: '',
    partyId: row.agent_id,
    cashboxId: null,
    exchangeRateToUsd: 1,
    notes: `شحنة رقم ${row.shipment_no}${row.notes ? ' — ' + row.notes : ''}`,
    baseAmountUsd: Number(row.amount_usd),
    createdByUsername: row.created_by_username ?? null,
    createdByFullName: row.created_by_full_name ?? null,
  };
}

function resolvePartyType(row: RawVoucher): PartyType | null {
  if (row.agent_id) return 'agent';
  if (row.customer_id) return 'customer';
  if (row.sender_receiver_id) return 'sender_receiver';
  return null;
}

function resolvePartyId(row: RawVoucher): string | null {
  return row.agent_id || row.customer_id || row.sender_receiver_id || null;
}

function toVoucherRow(row: RawVoucher, kind: VoucherKind): VoucherRow {
  return {
    id: row.id,
    voucherNo: row.voucher_no,
    createdAt: row.created_at,
    kind,
    partyType: resolvePartyType(row),
    partyName: row.party_display_name || '—',
    amount: Number(row.original_amount),
    currency: row.original_currency,
    cashboxName: row.cashbox_name || row.cashbox_code || null,
    status: row.status,
    displayNo: '', // assigned in allRows below, after combining + sorting
    partyId: resolvePartyId(row),
    cashboxId: row.cashbox_id ?? null,
    exchangeRateToUsd: Number(row.exchange_rate_to_usd) || 1,
    notes: row.notes ?? '',
    baseAmountUsd: Number(row.base_amount_usd ?? row.original_amount) || 0,
    createdByUsername: row.created_by_username ?? null,
    createdByFullName: row.created_by_full_name ?? null,
  };
}

const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  agent: 'وكيل',
  customer: 'عميل',
  sender_receiver: 'مرسل/مستلم',
};

const STATUS_LABEL: Record<VoucherStatus, string> = {
  confirmed: 'مرحّل',
  draft: 'مسودة',
  cancelled: 'معكوس',
};

const STATUS_CHIP_COLORS: Record<VoucherStatus, { bg: string; text: string }> = {
  confirmed: { bg: '#dcfce7', text: '#15803d' },
  draft: { bg: '#fef3c7', text: '#b45309' },
  cancelled: { bg: '#fee2e2', text: '#b91c1c' },
};

type TabKey = 'all' | 'receipt' | 'payment' | 'journal' | 'discount';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'receipt', label: 'قبض' },
  { key: 'payment', label: 'دفع' },
  { key: 'journal', label: 'قيد يدوي' },
  { key: 'discount', label: 'حسم شحنة' },
];

// Stroke-based inline icons (not emoji), matching the app's newer screens.
function ReceiptIcon() {
  return (
    <span style={{ display: 'inline-flex', width: '20px', height: '20px', borderRadius: '999px', background: '#dcfce7', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </span>
  );
}
function PaymentIcon() {
  return (
    <span style={{ display: 'inline-flex', width: '20px', height: '20px', borderRadius: '999px', background: '#fee2e2', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </span>
  );
}
function JournalIcon() {
  return (
    <span style={{ display: 'inline-flex', width: '20px', height: '20px', borderRadius: '999px', background: '#f1f5f9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
    </span>
  );
}

function IconButton({ title, onClick, color, children }: { title: string; onClick: () => void; color: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '26px', height: '26px', borderRadius: '6px', border: '1px solid #e5e7eb',
        background: '#fff', color, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function EditGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function PrintGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
    </svg>
  );
}
function ReverseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5" />
    </svg>
  );
}

function StatusChip({ status }: { status: VoucherStatus }) {
  const c = STATUS_CHIP_COLORS[status];
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: c.bg, color: c.text }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const KIND_LABEL: Record<VoucherKind, string> = { receipt: 'سند قبض', payment: 'سند دفع', journal: 'قيد يدوي', discount: 'سند حسم شحنة' };

// Uses the app's existing plain print CSS classes (.print-header/.print-title/
// .print-table, defined in src/index.css) — the same ones used by the
// existing shipment print templates — so this looks consistent with every
// other printed document in the app, not a new one-off style.
function buildVoucherPrintHtml(row: VoucherRow): string {
  return `
    <div class="print-header">
      <div class="print-title">${KIND_LABEL[row.kind]}</div>
      <div class="print-subtitle">رقم ${row.displayNo}</div>
    </div>
    <table class="print-table">
      <tbody>
        <tr><td>التاريخ</td><td>${row.createdAt.split('T')[0]}</td></tr>
        <tr><td>الطرف</td><td>${row.partyName}${row.partyType ? ` (${PARTY_TYPE_LABEL[row.partyType]})` : ''}</td></tr>
        <tr><td>المبلغ</td><td>${row.amount.toLocaleString('en-US')} ${row.currency}</td></tr>
        <tr><td>الصندوق</td><td>${row.cashboxName ?? '—'}</td></tr>
        <tr><td>الحالة</td><td>${STATUS_LABEL[row.status]}</td></tr>
        <tr><td>ملاحظات</td><td>${row.notes || '—'}</td></tr>
      </tbody>
    </table>
  `;
}

export default function FinanceVouchers() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [receipts, setReceipts] = useState<VoucherRow[]>([]);
  const [payments, setPayments] = useState<VoucherRow[]>([]);
  const [journalEntries, setJournalEntries] = useState<VoucherRow[]>([]);
  const [discounts, setDiscounts] = useState<VoucherRow[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    partyType: '' as '' | PartyType,
    status: '' as '' | VoucherStatus,
    currency: '' as '' | CurrencyCode,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [showCreateJournal, setShowCreateJournal] = useState(false);
  const [showCreateDiscount, setShowCreateDiscount] = useState(false);
  const [createKind, setCreateKind] = useState<VoucherKind>('receipt');
  const [editingRow, setEditingRow] = useState<VoucherRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<VoucherRow | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [receiptRows, paymentRows, journalRows, discountRows] = await Promise.all([
        httpClient.get<RawVoucher[]>('/receipt-vouchers'),
        httpClient.get<RawVoucher[]>('/payment-vouchers'),
        httpClient.get<RawJournalEntry[]>('/journal-entries').catch(() => []),
        httpClient.get<RawDiscountVoucher[]>('/shipment-discounts').catch(() => []),
      ]);
      setReceipts(receiptRows.map((r) => toVoucherRow(r, 'receipt')));
      setPayments(paymentRows.map((r) => toVoucherRow(r, 'payment')));
      setJournalEntries(journalRows.map(toJournalVoucherRow));
      setDiscounts(discountRows.map(toDiscountVoucherRow));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل السندات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    httpClient.get<ChartOfAccount[]>('/chart-of-accounts').then(setAccounts).catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRows = useMemo(() => {
    // Numbered by creation order (oldest = 000001), independent of the
    // table's own display sort — so a voucher's number never shifts once
    // assigned, even as new vouchers are added later.
    const byCreationAsc = [...receipts, ...payments, ...journalEntries, ...discounts].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
    const numbered = byCreationAsc.map((row, idx) => ({ ...row, displayNo: String(idx + 1).padStart(6, '0') }));
    return numbered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [receipts, payments, journalEntries, discounts]);

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (activeTab === 'receipt' && row.kind !== 'receipt') return false;
      if (activeTab === 'payment' && row.kind !== 'payment') return false;
      if (activeTab === 'journal' && row.kind !== 'journal') return false;
      if (activeTab === 'discount' && row.kind !== 'discount') return false;
      if (filters.dateFrom && row.createdAt.split('T')[0] < filters.dateFrom) return false;
      if (filters.dateTo && row.createdAt.split('T')[0] > filters.dateTo) return false;
      if (filters.partyType && row.partyType !== filters.partyType) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.currency && row.currency !== filters.currency) return false;
      return true;
    });
  }, [allRows, activeTab, filters]);

  const openCreate = () => {
    if (activeTab === 'journal') {
      setShowCreateJournal(true);
      return;
    }
    if (activeTab === 'discount') {
      setShowCreateDiscount(true);
      return;
    }
    setCreateKind(activeTab === 'payment' ? 'payment' : 'receipt');
    setShowCreate(true);
  };

  const handlePrint = async (row: VoucherRow) => {
    try {
      const result = await printLedgerStyleDocument(buildVoucherPrintHtml(row), 'voucher');
      if (result === 'error') showToast('تعذر تنفيذ الطباعة', 'error');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تنفيذ الطباعة', 'error');
    }
  };

  const handleReverse = async (row: VoucherRow) => {
    const confirmed = window.confirm(`هل تريدين عكس ${KIND_LABEL[row.kind]} رقم ${row.displayNo}؟ سيُنشأ قيد/سند معاكس ولن يُحذف السجل الأصلي.`);
    if (!confirmed) return;
    setReversingId(row.id);
    try {
      if (row.kind === 'journal') {
        await httpClient.post(`/journal-entries/${row.id}/reverse`, {});
      } else if (row.kind === 'discount') {
        await httpClient.post(`/shipment-discounts/${row.id}/reverse`, {});
      } else {
        await httpClient.put(row.kind === 'receipt' ? `/receipt-vouchers/${row.id}` : `/payment-vouchers/${row.id}`, {
          status: 'cancelled',
        });
      }
      showToast('تم العكس بنجاح', 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تنفيذ العكس', 'error');
    } finally {
      setReversingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col gap-3">
      <Link to="/finance" style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af', textDecoration: 'none', width: 'fit-content' }}>
        ← الذمم والمالية
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '19px', fontWeight: 800, color: '#111827', margin: 0 }}>السندات</h1>
          <p style={{ fontSize: '12.5px', color: '#6b7280', margin: '2px 0 0' }}>قبض · دفع · قيد يدوي</p>
        </div>
        <button type="button" className="toolbar-btn primary" onClick={openCreate}>
          + سند جديد
        </button>
      </div>

      <div style={{ display: 'flex', gap: '18px', borderBottom: '1px solid #e5e7eb' }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 2px', fontSize: '14px', fontWeight: active ? 700 : 500,
                color: active ? '#1e40af' : '#6b7280',
                borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="card p-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        <span style={{ fontSize: '13px', color: '#6b7280' }}>إلى</span>
        <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
        <select className="form-select" value={filters.partyType} onChange={(e) => setFilters((p) => ({ ...p, partyType: e.target.value as any }))}>
          <option value="">كل الأطراف</option>
          <option value="agent">وكلاء</option>
          <option value="customer">عملاء</option>
          <option value="sender_receiver">مرسلون/مستلمون</option>
        </select>
        <select className="form-select" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value as any }))}>
          <option value="">كل الحالات</option>
          <option value="draft">مسودة</option>
          <option value="confirmed">مرحّل</option>
          <option value="cancelled">معكوس</option>
        </select>
        <FinanceCurrencySelect
          value={filters.currency}
          onChange={(v) => setFilters((p) => ({ ...p, currency: v as any }))}
          allowEmpty
          emptyLabel="كل العملات"
        />
        <button type="button" className="toolbar-btn" onClick={() => void load()}>تطبيق</button>
        <div style={{ marginInlineStart: 'auto' }}>
          <FinanceExportToolbar
            disabled={loading || filteredRows.length === 0}
            csvFileName={`vouchers-${new Date().toISOString().split('T')[0]}.csv`}
            csvHeaders={['الرقم', 'التاريخ', 'الطرف', 'النوع', 'المبلغ', 'الحساب', 'الحالة']}
            csvRows={filteredRows.map((r) => [
              r.displayNo,
              r.createdAt.split('T')[0],
              r.partyName,
              r.kind === 'receipt' ? 'قبض' : 'دفع',
              String(r.amount),
              r.cashboxName ?? '',
              STATUS_LABEL[r.status],
            ])}
            pdfTitle="السندات"
            pdfFileName={`vouchers-${new Date().toISOString().split('T')[0]}.pdf`}
            documentType="vouchers"
            onBuildPrintHtml={() => '<div></div>'}
          />
        </div>
      </div>

      <div style={{ border: '1px solid #9ca3af', borderRadius: '4px', overflow: 'hidden', flex: 1 }}>
        {loading ? <p style={{ padding: '14px', color: '#6b7280' }}>جاري التحميل...</p> : null}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #9ca3af' }}>
                <th style={voucherThStyle('right')}>الرقم</th>
                <th style={voucherThStyle('right')}>التاريخ</th>
                <th style={voucherThStyle('right')}>الطرف</th>
                <th style={voucherThStyle('right')}>النوع</th>
                <th style={voucherThStyle('left')}>المبلغ</th>
                <th style={voucherThStyle('right')}>الحساب</th>
                <th style={voucherThStyle('right')}>الحالة</th>
                <th style={voucherThStyle('right')}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  onClick={() => setDetailsRow(row)}
                  style={{ borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ ...voucherTdStyle('right'), direction: 'ltr', fontVariantNumeric: 'tabular-nums' }}>{row.displayNo}</td>
                  <td style={voucherTdStyle('right')}>{row.createdAt.split('T')[0]}</td>
                  <td style={voucherTdStyle('right')}>{row.partyName}{row.partyType ? ` (${PARTY_TYPE_LABEL[row.partyType]})` : ''}</td>
                  <td style={voucherTdStyle('right')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {row.kind === 'receipt' && <ReceiptIcon />}
                      {row.kind === 'payment' && <PaymentIcon />}
                      {row.kind === 'journal' && <JournalIcon />}
                      {row.kind === 'discount' && <PaymentIcon />}
                      {row.kind === 'receipt' ? 'قبض' : row.kind === 'payment' ? 'دفع' : row.kind === 'discount' ? 'حسم' : 'قيد'}
                    </span>
                  </td>
                  <td style={{ ...voucherTdStyle('left'), direction: 'ltr', fontWeight: 600, color: row.kind === 'payment' || row.kind === 'discount' ? '#991b1b' : '#166534' }}>
                    {row.amount.toLocaleString('en-US')} {row.currency}
                  </td>
                  <td style={voucherTdStyle('right')}>{row.cashboxName ?? '—'}</td>
                  <td style={voucherTdStyle('right')}><StatusChip status={row.status} /></td>
                  <td style={voucherTdStyle('right')} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {row.kind !== 'journal' && row.kind !== 'discount' && row.status !== 'cancelled' && (
                        <IconButton title="تعديل" color="#1e40af" onClick={() => setEditingRow(row)}>
                          <EditGlyph />
                        </IconButton>
                      )}
                      <IconButton title="طباعة" color="#334155" onClick={() => void handlePrint(row)}>
                        <PrintGlyph />
                      </IconButton>
                      {row.status !== 'cancelled' && (
                        <IconButton title="عكس" color="#b91c1c" onClick={() => void handleReverse(row)}>
                          {reversingId === row.id ? '…' : <ReverseGlyph />}
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '28px', color: '#9ca3af' }}>
                    {activeTab === 'journal'
                      ? 'لا توجد قيود يدوية بعد — اضغطي "+ سند جديد" لإضافة أول قيد.'
                      : activeTab === 'discount'
                        ? 'لا توجد سندات حسم بعد — اضغطي "+ سند جديد" لتسجيل أول حسم على شحنة.'
                        : 'لا توجد سندات مطابقة للفلاتر الحالية.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateVoucherModal
          kind={createKind}
          onKindChange={setCreateKind}
          branchId={user?.branchId ?? null}
          userId={user?.id ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {editingRow && (
        <CreateVoucherModal
          kind={editingRow.kind === 'payment' ? 'payment' : 'receipt'}
          onKindChange={() => {}}
          branchId={user?.branchId ?? null}
          userId={user?.id ?? null}
          editing={editingRow}
          onClose={() => setEditingRow(null)}
          onCreated={() => {
            setEditingRow(null);
            void load();
          }}
        />
      )}

      {showCreateJournal && (
        <CreateJournalModal
          accounts={accounts}
          branchId={user?.branchId ?? null}
          onClose={() => setShowCreateJournal(false)}
          onCreated={() => {
            setShowCreateJournal(false);
            void load();
          }}
        />
      )}

      {showCreateDiscount && (
        <CreateDiscountModal
          onClose={() => setShowCreateDiscount(false)}
          onCreated={() => {
            setShowCreateDiscount(false);
            void load();
          }}
        />
      )}

      {detailsRow && <VoucherDetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </div>
  );
}

function VoucherDetailsModal({ row, onClose }: { row: VoucherRow; onClose: () => void }) {
  const kindLabel = row.kind === 'receipt' ? 'سند قبض' : row.kind === 'payment' ? 'سند دفع' : 'قيد يدوي';
  const fields: Array<{ label: string; value: ReactNode }> = [
    { label: 'رقم السند', value: row.voucherNo },
    { label: 'النوع', value: kindLabel },
    { label: 'التاريخ والوقت', value: formatWesternDateTime(row.createdAt) },
    { label: 'الطرف', value: row.partyType ? `${row.partyName} (${PARTY_TYPE_LABEL[row.partyType]})` : row.partyName },
    { label: 'الصندوق', value: row.cashboxName ?? '—' },
    {
      label: 'المبلغ',
      value: `${formatWesternNumber(row.amount, { minimumFractionDigits: 2 })} ${row.currency}`,
    },
    { label: 'سعر الصرف إلى USD', value: formatWesternNumber(row.exchangeRateToUsd, { minimumFractionDigits: 4 }) },
    { label: 'ما يعادله بالدولار', value: `${formatWesternNumber(row.baseAmountUsd, { minimumFractionDigits: 2 })} USD` },
    { label: 'الحالة', value: STATUS_LABEL[row.status] },
    {
      label: 'أنشأه (الحساب)',
      value: row.createdByUsername || row.createdByFullName
        ? `${row.createdByFullName ?? '—'} (${row.createdByUsername ?? '—'})`
        : 'غير متوفر لهذا السند',
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '10px',
          width: 'min(480px, 92vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#111827' }}>تفاصيل {kindLabel}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {fields.map((f) => (
            <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderBottom: '1px solid #f3f4f6', paddingBottom: '8px' }}>
              <span style={{ fontSize: '12.5px', color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{f.label}</span>
              <span style={{ fontSize: '13.5px', color: '#111827', fontWeight: 600, textAlign: 'left' }}>{f.value}</span>
            </div>
          ))}
          <div>
            <div style={{ fontSize: '12.5px', color: '#6b7280', fontWeight: 600, marginBottom: '6px' }}>الملاحظات / المصدر</div>
            <div
              style={{
                background: '#f9fafb',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '13px',
                color: '#374151',
                lineHeight: 1.6,
                minHeight: '40px',
              }}
            >
              {row.notes?.trim() || 'لا توجد ملاحظات مسجّلة على هذا السند.'}
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="toolbar-btn" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}

function voucherThStyle(align: 'right' | 'left'): React.CSSProperties {
  return { textAlign: align, padding: '9px 14px', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' };
}

function voucherTdStyle(align: 'right' | 'left'): React.CSSProperties {
  return { textAlign: align, padding: '8px 14px', whiteSpace: 'nowrap', color: '#1f2937' };
}

// ─────────────────────────────────────────────────────────────────────────
// Create receipt/payment voucher — modal panel (implementer's choice, per
// the task spec, over a dedicated route/page, since it's a short focused
// form and a full page navigation would break the accountant's place in
// the register).
// ─────────────────────────────────────────────────────────────────────────

function CreateVoucherModal({
  kind, onKindChange, branchId, userId, editing, onClose, onCreated,
}: {
  kind: VoucherKind;
  onKindChange: (k: VoucherKind) => void;
  branchId: string | null;
  userId: string | null;
  editing?: VoucherRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { showToast } = useToast();
  const [partyType, setPartyType] = useState<PartyType>(editing?.partyType ?? 'agent');
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState(editing?.partyId ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [currency, setCurrency] = useState<CurrencyCode>((editing?.currency as CurrencyCode) ?? 'USD');
  const [exchangeRate, setExchangeRate] = useState(editing ? String(editing.exchangeRateToUsd) : '1');
  const [cashboxId, setCashboxId] = useState(editing?.cashboxId ?? '');
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [status, setStatus] = useState<VoucherStatus>(editing?.status ?? 'draft');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    phase3FinanceGateway.cashbox.listMaster().then(setCashboxes).catch(() => setCashboxes([]));
  }, []);

  const isFirstPartyTypeRun = useState(() => ({ current: true }))[0];
  useEffect(() => {
    if (isFirstPartyTypeRun.current) {
      isFirstPartyTypeRun.current = false;
    } else {
      setPartyId('');
    }
    const path = partyType === 'agent' ? '/agents' : partyType === 'customer' ? '/customers' : '/senders-receivers';
    httpClient
      .get<Array<{ id: string; name?: string; full_name?: string }>>(path)
      .then((rows) => setPartyOptions(rows.map((r) => ({ id: r.id, name: r.name || r.full_name || '—' }))))
      .catch(() => setPartyOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType]);

  const isFirstCurrencyRun = useState(() => ({ current: true }))[0];
  useEffect(() => {
    // Don't overwrite the voucher's original historical exchange rate with
    // today's rate on first render when editing — only auto-fill when the
    // user actively changes the currency afterwards.
    if (isFirstCurrencyRun.current) {
      isFirstCurrencyRun.current = false;
      return;
    }
    if (currency === 'USD') {
      setExchangeRate('1');
      return;
    }
    const rates = getExchangeRatesToUsd();
    setExchangeRate(String(getRateToUsd(currency, rates)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const save = async () => {
    if (!partyId || !amount || !cashboxId) {
      showToast('الرجاء إكمال الطرف والمبلغ والصندوق', 'error');
      return;
    }
    setSaving(true);
    try {
      const originalAmount = Number(amount);
      const rate = Number(exchangeRate) || 1;
      const basePath = kind === 'receipt' ? '/receipt-vouchers' : '/payment-vouchers';
      if (editing) {
        await httpClient.put(`${basePath}/${editing.id}`, {
          cashboxId,
          status,
          notes: notes || undefined,
          originalAmount,
          originalCurrency: currency,
          exchangeRateToUsd: rate,
          baseAmountUsd: originalAmount * rate,
          agentId: partyType === 'agent' ? partyId : undefined,
          customerId: partyType === 'customer' ? partyId : undefined,
          senderReceiverId: partyType === 'sender_receiver' ? partyId : undefined,
        });
        showToast('تم تحديث السند', 'success');
      } else {
        const payload: Record<string, unknown> = {
          voucherNo: `${kind === 'receipt' ? 'RV' : 'PV'}-${Date.now()}`,
          branchId: branchId ?? undefined,
          cashboxId,
          status,
          notes: notes || undefined,
          originalAmount,
          originalCurrency: currency,
          exchangeRateToUsd: rate,
          baseAmountUsd: originalAmount * rate,
          createdByUserId: userId ?? undefined,
          agentId: partyType === 'agent' ? partyId : undefined,
          customerId: partyType === 'customer' ? partyId : undefined,
          senderReceiverId: partyType === 'sender_receiver' ? partyId : undefined,
        };
        await httpClient.post(basePath, payload);
        showToast(kind === 'receipt' ? 'تم إنشاء سند القبض' : 'تم إنشاء سند الدفع', 'success');
      }
      onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ السند', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)' }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 'min(520px, calc(100vw - 32px))', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0 }}>
            {editing ? `تعديل ${kind === 'receipt' ? 'سند القبض' : 'سند الدفع'} رقم ${editing.displayNo}` : kind === 'receipt' ? 'سند قبض جديد' : 'سند دفع جديد'}
          </h2>
          {!editing && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className={`toolbar-btn ${kind === 'receipt' ? 'primary' : ''}`} onClick={() => onKindChange('receipt')}>قبض</button>
              <button type="button" className={`toolbar-btn ${kind === 'payment' ? 'primary' : ''}`} onClick={() => onKindChange('payment')}>دفع</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group">
            <label className="form-label">نوع الطرف</label>
            <select className="form-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)}>
              <option value="agent">وكيل</option>
              <option value="customer">عميل</option>
              <option value="sender_receiver">مرسل/مستلم</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">الطرف</label>
            <select className="form-select" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">اختر...</option>
              {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">المبلغ</label>
              <input type="number" className="form-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="form-group" style={{ width: '120px' }}>
              <label className="form-label">العملة</label>
              <FinanceCurrencySelect value={currency} onChange={(v) => setCurrency(v as CurrencyCode)} />
            </div>
          </div>
          {currency !== 'USD' && (
            <div className="form-group">
              <label className="form-label">سعر الصرف مقابل الدولار</label>
              <input type="number" className="form-input" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">الصندوق</label>
            <select className="form-select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
              <option value="">اختر...</option>
              {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">الحالة</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value as VoucherStatus)}>
              <option value="draft">مسودة</option>
              <option value="confirmed">مرحّل</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">ملاحظات</label>
            <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : editing ? 'تحديث' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Create manual journal entry — free-form multi-line debit/credit form.
// Only reachable once the chart-of-accounts foundation exists (accounts
// list is non-empty); the client-side balance check below is for
// immediate feedback only — the database's deferred balance-check trigger
// on journal_entry_lines is the final authority, per spec.
// ─────────────────────────────────────────────────────────────────────────

interface JournalLineDraft {
  accountId: string;
  side: 'debit' | 'credit';
  amount: string;
  partyType: '' | PartyType;
  partyId: string;
  notes: string;
}

function emptyLine(): JournalLineDraft {
  return { accountId: '', side: 'debit', amount: '', partyType: '', partyId: '', notes: '' };
}

function CreateJournalModal({
  accounts, branchId, onClose, onCreated,
}: {
  accounts: ChartOfAccount[];
  branchId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { showToast } = useToast();
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<JournalLineDraft[]>([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      const amt = Number(line.amount) || 0;
      if (line.side === 'debit') debit += amt;
      else credit += amt;
    }
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<JournalLineDraft>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const save = async () => {
    const incomplete = lines.some((l) => !l.accountId || !Number(l.amount));
    if (incomplete) {
      showToast('أكملي الحساب والمبلغ لكل سطر', 'error');
      return;
    }
    if (!totals.balanced) {
      showToast(`القيد غير متوازن: مدين ${totals.debit} ≠ دائن ${totals.credit}`, 'error');
      return;
    }
    setSaving(true);
    try {
      await httpClient.post('/journal-entries', {
        branchId: branchId ?? undefined,
        description: description || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debitAmount: l.side === 'debit' ? Number(l.amount) : 0,
          creditAmount: l.side === 'credit' ? Number(l.amount) : 0,
          partyType: l.partyType || undefined,
          partyId: l.partyType && l.partyId ? l.partyId : undefined,
          notes: l.notes || undefined,
        })),
      });
      showToast('تم حفظ القيد', 'success');
      onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ القيد', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)' }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 'min(720px, calc(100vw - 32px))', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 14px' }}>قيد يدوي جديد</h2>

        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label className="form-label">وصف القيد</label>
          <input type="text" className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="form-select" style={{ flex: '2 1 200px' }} value={line.accountId} onChange={(e) => updateLine(idx, { accountId: e.target.value })}>
                <option value="">اختر الحساب...</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
              </select>
              <select className="form-select" style={{ flex: '0 0 90px' }} value={line.side} onChange={(e) => updateLine(idx, { side: e.target.value as 'debit' | 'credit' })}>
                <option value="debit">مدين</option>
                <option value="credit">دائن</option>
              </select>
              <input
                type="number"
                className="form-input"
                style={{ flex: '1 1 110px', direction: 'ltr' }}
                placeholder="المبلغ"
                value={line.amount}
                onChange={(e) => updateLine(idx, { amount: e.target.value })}
              />
              <select className="form-select" style={{ flex: '0 0 110px' }} value={line.partyType} onChange={(e) => updateLine(idx, { partyType: e.target.value as PartyType, partyId: '' })}>
                <option value="">بدون طرف</option>
                <option value="agent">وكيل</option>
                <option value="customer">عميل</option>
                <option value="sender_receiver">مرسل/مستلم</option>
              </select>
              <button type="button" className="toolbar-btn danger" style={{ flex: '0 0 auto' }} onClick={() => removeLine(idx)} disabled={lines.length <= 2}>حذف</button>
            </div>
          ))}
        </div>

        <button type="button" className="toolbar-btn" style={{ marginTop: '10px' }} onClick={addLine}>+ سطر جديد</button>

        <div style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '8px', background: totals.balanced ? '#dcfce7' : '#fef3c7', fontSize: '13px', fontWeight: 700 }}>
          مدين: {totals.debit.toLocaleString('en-US')} &nbsp;|&nbsp; دائن: {totals.credit.toLocaleString('en-US')}
          {totals.balanced ? ' — متوازن ✓' : ' — غير متوازن بعد'}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void save()} disabled={saving || !totals.balanced}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ القيد'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Create shipment-discount voucher — عند استلام الشحنة قد يطلب المستلم حسماً
// يوافق عليه الوكيل. يُدخَل رقم إيصال الشحنة فيُعرَض المطالَب به حالياً على
// الوكيل لهذه الشحنة، ثم يُسجَّل مبلغ الحسم فيُنقَص من هذا المطالَب تلقائياً
// (سطر دائن في party_financial_movements) — فلا يُطالَب الوكيل بالمبلغ
// المحسوم لاحقاً، ويظهر الحسم في كشف العميل/الوكيل بجانب المبلغ الأصلي.
// ─────────────────────────────────────────────────────────────────────────

interface ShipmentLookupResult {
  shipmentId: string;
  shipmentNo: string;
  agentId: string;
  agentName: string | null;
  amountOwedUsd: number;
}

function CreateDiscountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { showToast } = useToast();
  const [shipmentNo, setShipmentNo] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [shipment, setShipment] = useState<ShipmentLookupResult | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const lookup = async () => {
    const no = shipmentNo.trim();
    if (!no) return;
    setLooking(true);
    setLookupError('');
    setShipment(null);
    try {
      const result = await httpClient.get<ShipmentLookupResult>(`/shipment-discounts/lookup?shipmentNo=${encodeURIComponent(no)}`);
      setShipment(result);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : 'تعذر العثور على الشحنة');
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (!shipment) return;
    const amountNum = Number(amount);
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      showToast('أدخلي مبلغ حسم صحيحاً أكبر من صفر', 'error');
      return;
    }
    if (amountNum > shipment.amountOwedUsd + 0.0001) {
      showToast(`مبلغ الحسم أكبر من المطالَب به حالياً (${shipment.amountOwedUsd}$)`, 'error');
      return;
    }
    setSaving(true);
    try {
      await httpClient.post('/shipment-discounts', {
        shipmentNo: shipment.shipmentNo,
        amountUsd: amountNum,
        notes: notes.trim() || undefined,
      });
      showToast('تم تسجيل الحسم', 'success');
      onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ الحسم', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)' }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 'min(460px, calc(100vw - 32px))', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 14px' }}>حسم على شحنة واصلة</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group">
            <label className="form-label">رقم إيصال الشحنة</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                className="form-input"
                value={shipmentNo}
                onChange={(e) => {
                  setShipmentNo(e.target.value);
                  setShipment(null);
                  setLookupError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void lookup();
                }}
              />
              <button type="button" className="toolbar-btn" onClick={() => void lookup()} disabled={looking || !shipmentNo.trim()}>
                {looking ? '...' : 'بحث'}
              </button>
            </div>
            {lookupError && <p style={{ color: '#dc2626', fontSize: '13px', margin: '6px 0 0' }}>{lookupError}</p>}
          </div>

          {shipment && (
            <>
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', fontSize: '13.5px' }}>
                <div>الوكيل: <strong>{shipment.agentName ?? '—'}</strong></div>
                <div>المطالَب به حالياً على هذه الشحنة: <strong style={{ color: '#b45309' }}>{shipment.amountOwedUsd}$</strong></div>
              </div>
              <div className="form-group">
                <label className="form-label">مبلغ الحسم ($)</label>
                <input type="number" className="form-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void save()} disabled={saving || !shipment}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ الحسم'}
          </button>
        </div>
      </div>
    </div>
  );
}
