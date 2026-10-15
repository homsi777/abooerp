import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { useAuth } from '../../context/AuthProvider';
import { useToast } from '../../components/Toast';

// "الورديات والعهد" — accountant-facing review screen for the unified
// custody model (data-entry employee shifts + driver advances). Built
// fresh, matching the same visual language as the Finance hub and the new
// Vouchers screen (plain CSS classes, no component library).
//
// Scope note: this screen covers open/close/confirm/reject — the full
// custody lifecycle an accountant needs to review and approve. It does
// NOT yet include posting individual in-shift collection movements (e.g. a
// driver collecting cash from a specific agent mid-trip) — that's the
// Android tablet app's job, tracked separately, and would call the same
// /custody-shifts backend once wired up there.

type HolderType = 'data_entry_employee' | 'driver';
type CustodyStatus = 'open' | 'pending_confirmation' | 'confirmed' | 'rejected';

interface CustodyBalance {
  currencyCode: string;
  openingAmount: string | number;
  currentAmount: string | number;
}

interface RawCustodyShift {
  id: string;
  branch_id: string | null;
  holder_type: HolderType;
  holder_name: string | null;
  holder_label: string | null;
  branch_name: string | null;
  opened_at: string;
  closed_at: string | null;
  confirmed_at: string | null;
  rejection_reason: string | null;
  status: CustodyStatus;
  balances: CustodyBalance[];
}

interface LedgerRowLite {
  id: string;
  row_no: number;
  receipt_no: string | null;
  destination: string | null;
  parcel_type: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  collect_amount_usd: string | null;
  hawala_amount_usd: string | null;
  transfer_service_fee_usd: string | null;
  created_at: string | null;
}

const TABLET_LINE_LABEL = 'استلام تابلت';

const HOLDER_TYPE_LABEL: Record<HolderType, string> = {
  data_entry_employee: 'موظف إدخال بيانات',
  driver: 'سائق',
};
const HOLDER_TYPE_ICON: Record<HolderType, string> = {
  data_entry_employee: '🧑‍💼',
  driver: '🚚',
};

const STATUS_LABEL: Record<CustodyStatus, string> = {
  open: 'مفتوحة',
  pending_confirmation: 'بانتظار تأكيد المحاسب',
  confirmed: 'مؤكَّدة',
  rejected: 'مرفوضة',
};

const STATUS_CHIP: Record<CustodyStatus, { bg: string; text: string; dot: string }> = {
  open: { bg: '#dbeafe', text: '#1e40af', dot: '#3b82f6' },
  pending_confirmation: { bg: '#fef3c7', text: '#b45309', dot: '#f59e0b' },
  confirmed: { bg: '#dcfce7', text: '#15803d', dot: '#22c55e' },
  rejected: { bg: '#fee2e2', text: '#b91c1c', dot: '#ef4444' },
};

// A tasteful "pulse" — literally the "نبض" the project owner asked for —
// reserved for the one status that genuinely needs the accountant's
// attention right now (pending confirmation), so it reads as a heartbeat
// signal, not decoration everywhere.
function PulseDot({ color, animate }: { color: string; animate: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: '8px', height: '8px' }}>
      {animate && (
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: '999px', background: color,
            animation: 'custody-pulse 1.6s ease-out infinite',
          }}
        />
      )}
      <span style={{ position: 'relative', width: '8px', height: '8px', borderRadius: '999px', background: color }} />
    </span>
  );
}

function StatusChip({ status }: { status: CustodyStatus }) {
  const c = STATUS_CHIP[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 12px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: c.bg, color: c.text }}>
      <PulseDot color={c.dot} animate={status === 'pending_confirmation'} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatBalances(balances: CustodyBalance[]): string {
  if (!balances.length) return '—';
  return balances.map((b) => `${Number(b.currentAmount).toLocaleString('en-US')} ${b.currencyCode}`).join(' + ');
}

function formatDateTime(iso: string): string {
  return `${iso.split('T')[0]} ${iso.split('T')[1]?.slice(0, 5) ?? ''}`;
}

const CURRENCY_META: Record<string, { label: string; icon: string; accent: string; bg: string }> = {
  USD: { label: 'دولار أمريكي', icon: '💵', accent: '#0e7490', bg: '#ecfeff' },
  SYP: { label: 'ليرة سورية', icon: '🪙', accent: '#1d4ed8', bg: '#eff6ff' },
};

export default function Custody() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [shifts, setShifts] = useState<RawCustodyShift[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | CustodyStatus>('');
  const [loading, setLoading] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailShift, setDetailShift] = useState<RawCustodyShift | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const rows = await httpClient.get<RawCustodyShift[]>(`/custody-shifts${qs}`);
      setShifts(rows);
      // Keep an open detail panel in sync with fresh data (e.g. after confirm/reject).
      setDetailShift((prev) => (prev ? rows.find((r) => r.id === prev.id) ?? null : prev));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل العهد', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const pendingCount = useMemo(() => shifts.filter((s) => s.status === 'pending_confirmation').length, [shifts]);

  const confirm = async (id: string) => {
    setBusyId(id);
    try {
      await httpClient.post(`/custody-shifts/${id}/confirm`, {});
      showToast('تم تأكيد وتصفية العهدة', 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر التأكيد', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string, reason: string) => {
    if (!reason.trim()) {
      showToast('الرجاء كتابة سبب الرفض', 'error');
      return;
    }
    setBusyId(id);
    try {
      await httpClient.post(`/custody-shifts/${id}/reject`, { reason });
      showToast('تم رفض العهدة — يمكن للحامل فتح عهدة جديدة الآن', 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر الرفض', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full flex flex-col gap-3">
      <style>{`
        @keyframes custody-pulse {
          0% { transform: scale(1); opacity: .7; }
          70% { transform: scale(2.6); opacity: 0; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        .custody-row { cursor: pointer; transition: background .12s ease; }
        .custody-row:hover { background: #f8fafc; }
      `}</style>

      <Link to="/finance" style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af', textDecoration: 'none', width: 'fit-content' }}>
        ← الذمم والمالية
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '19px', fontWeight: 800, color: '#111827', margin: 0 }}>الورديات والعهد</h1>
          <p style={{ fontSize: '12.5px', color: '#6b7280', margin: '2px 0 0' }}>
            عهد موظفي إدخال البيانات وسلف السائقين — {pendingCount > 0 ? `${pendingCount} بانتظار تأكيدك` : 'لا يوجد بانتظار التأكيد'}
          </p>
        </div>
        <button type="button" className="toolbar-btn primary" onClick={() => setShowOpen(true)}>
          + فتح عهدة جديدة
        </button>
      </div>

      <div className="card p-2" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="">كل الحالات</option>
          <option value="open">مفتوحة</option>
          <option value="pending_confirmation">بانتظار التأكيد</option>
          <option value="confirmed">مؤكَّدة</option>
          <option value="rejected">مرفوضة</option>
        </select>
        <button type="button" className="toolbar-btn" onClick={() => void load()}>تطبيق</button>
        <span style={{ fontSize: '11.5px', color: '#9ca3af', marginInlineStart: 'auto' }}>اضغطي على أي سطر لعرض التفاصيل</span>
      </div>

      <div className="card overflow-auto flex-1">
        {loading ? <p className="p-4 text-gray-500">جاري التحميل...</p> : null}
        <table className="data-grid">
          <thead>
            <tr>
              <th>الحامل</th><th>النوع</th><th>الفرع</th><th>وقت الفتح</th>
              <th>الرصيد الحالي</th><th>الحالة</th><th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id} className="custody-row" onClick={() => setDetailShift(shift)}>
                <td>{shift.holder_name || shift.holder_label || '—'}</td>
                <td>{HOLDER_TYPE_ICON[shift.holder_type]} {HOLDER_TYPE_LABEL[shift.holder_type]}</td>
                <td>{shift.branch_name ?? '—'}</td>
                <td>{formatDateTime(shift.opened_at)}</td>
                <td style={{ direction: 'ltr', textAlign: 'right' }}>{formatBalances(shift.balances)}</td>
                <td><StatusChip status={shift.status} /></td>
                <td onClick={(e) => e.stopPropagation()}>
                  {shift.status === 'pending_confirmation' ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button type="button" className="toolbar-btn primary" disabled={busyId === shift.id} onClick={() => setDetailShift(shift)}>
                        مراجعة وتأكيد
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: '12.5px' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && shifts.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center p-6 text-gray-500">لا توجد عهد مطابقة.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showOpen && (
        <OpenCustodyModal
          branchId={user?.branchId ?? null}
          onClose={() => setShowOpen(false)}
          onOpened={() => {
            setShowOpen(false);
            void load();
          }}
        />
      )}

      {detailShift && (
        <ShiftDetailModal
          shift={detailShift}
          busy={busyId === detailShift.id}
          onClose={() => setDetailShift(null)}
          onConfirm={() => void confirm(detailShift.id)}
          onReject={(reason) => void reject(detailShift.id, reason)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shift detail — the "قلب نابض" (beating heart) of this section: a rich,
// card-based popup instead of a plain browser confirm(). Shows the full
// financial picture with real balance cards, and — while the shift is
// still live (open/pending) — today's ledger rows the holder has actually
// written, pulled from the same real /daily-ledger/rows endpoint the
// office desktop screen uses (matched by branch + today's date + the fixed
// "استلام تابلت" line label the tablet app tags every row with).
// ─────────────────────────────────────────────────────────────────────────

function ShiftDetailModal({
  shift, busy, onClose, onConfirm, onReject,
}: {
  shift: RawCustodyShift;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReject: (reason: string) => void;
}) {
  const [rows, setRows] = useState<LedgerRowLite[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  const showLiveRows = shift.status === 'open' || shift.status === 'pending_confirmation';

  useEffect(() => {
    if (!showLiveRows || !shift.branch_id) return;
    setRowsLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    httpClient
      .get<LedgerRowLite[]>(`/daily-ledger/rows?branchId=${shift.branch_id}&dateFrom=${today}&dateTo=${today}&lineLabel=${encodeURIComponent(TABLET_LINE_LABEL)}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setRowsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id]);

  const rowsTotalUsd = rows.reduce(
    (sum, r) => sum + (Number(r.collect_amount_usd) || 0) + (Number(r.hawala_amount_usd) || 0) + (Number(r.transfer_service_fee_usd) || 0),
    0,
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.6)', padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: '20px', boxShadow: '0 30px 80px rgba(15,23,42,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '22px 24px', borderRadius: '20px 20px 0 0', color: '#fff',
            background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 55%, #2563eb 100%)',
            position: 'relative',
          }}
        >
          <button
            type="button" onClick={onClose}
            style={{ position: 'absolute', top: '16px', insetInlineStart: '16px', width: '30px', height: '30px', borderRadius: '999px', border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' }}
          >
            ✕
          </button>
          <div style={{ fontSize: '13px', opacity: .85, marginBottom: '4px' }}>
            {HOLDER_TYPE_ICON[shift.holder_type]} {HOLDER_TYPE_LABEL[shift.holder_type]} · {shift.branch_name ?? 'بدون فرع'}
          </div>
          <div style={{ fontSize: '21px', fontWeight: 800 }}>{shift.holder_name || shift.holder_label || '—'}</div>
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <StatusChip status={shift.status} />
            <span style={{ fontSize: '12px', opacity: .85 }}>فُتحت: {formatDateTime(shift.opened_at)}</span>
            {shift.closed_at && <span style={{ fontSize: '12px', opacity: .85 }}>أُغلقت: {formatDateTime(shift.closed_at)}</span>}
          </div>
        </div>

        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Balance cards */}
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#374151', margin: '0 0 10px' }}>الرصيد المالي</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {shift.balances.map((b) => {
                const meta = CURRENCY_META[b.currencyCode] ?? { label: b.currencyCode, icon: '💰', accent: '#374151', bg: '#f3f4f6' };
                return (
                  <div key={b.currencyCode} style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '16px', background: meta.bg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '18px' }}>{meta.icon}</span>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: meta.accent }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#111827', direction: 'ltr', textAlign: 'right' }}>
                      {Number(b.currentAmount).toLocaleString('en-US')}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                      افتتاحي: {Number(b.openingAmount).toLocaleString('en-US')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live rows — only while the shift is still open or pending confirmation */}
          {showLiveRows && (
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#374151', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                السطور المُدخلة اليوم
                <span style={{ background: '#eff6ff', color: '#1e40af', borderRadius: '999px', padding: '1px 9px', fontSize: '11px', fontWeight: 800 }}>{rows.length}</span>
              </h3>
              {rowsLoading ? (
                <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>جاري التحميل...</p>
              ) : rows.length === 0 ? (
                <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>لا توجد سطور بعد.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflow: 'auto' }}>
                  {rows.map((r) => {
                    const amount = (Number(r.collect_amount_usd) || 0) + (Number(r.hawala_amount_usd) || 0) + (Number(r.transfer_service_fee_usd) || 0);
                    return (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '8px 12px', background: '#fafafa' }}>
                        <div>
                          <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#111827' }}>{r.destination ?? '—'} — {r.parcel_type ?? '—'}</div>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>{r.sender_name ?? '—'} → {r.receiver_name ?? '—'} #{r.receipt_no ?? r.row_no}</div>
                        </div>
                        <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#1e40af', direction: 'ltr' }}>{amount.toLocaleString('en-US')} $</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {rows.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280', textAlign: 'left', direction: 'ltr' }}>
                  إجمالي: {rowsTotalUsd.toLocaleString('en-US')} USD
                </div>
              )}
            </div>
          )}

          {shift.status === 'rejected' && shift.rejection_reason && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px 14px', fontSize: '13px', color: '#991b1b' }}>
              سبب الرفض: {shift.rejection_reason}
            </div>
          )}

          {/* Confirm / reject actions — only meaningful state where the
              accountant needs to act, so the whole bottom of the card
              becomes an action panel, not a tucked-away button. */}
          {shift.status === 'pending_confirmation' && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
              {!showReject ? (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={busy}
                    className="toolbar-btn primary"
                    style={{ flex: 1, height: '44px', fontSize: '14px', fontWeight: 700 }}
                  >
                    {busy ? 'جارٍ التأكيد...' : '✓ تأكيد وتصفية العهدة'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReject(true)}
                    disabled={busy}
                    className="toolbar-btn danger"
                    style={{ height: '44px', fontSize: '14px', fontWeight: 700 }}
                  >
                    رفض
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    className="form-input" placeholder="سبب الرفض" value={reason}
                    onChange={(e) => setReason(e.target.value)} autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="toolbar-btn danger" disabled={busy} style={{ flex: 1 }} onClick={() => onReject(reason)}>
                      {busy ? '...' : 'تأكيد الرفض'}
                    </button>
                    <button type="button" className="toolbar-btn" onClick={() => setShowReject(false)}>تراجع</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Open a new custody — accountant picks holder type then the specific
// employee/driver, and enters the mandatory opening float (USD + SYP),
// per the originally agreed rule: opening balances must always be entered
// explicitly, even as "0" — never silently assumed.
// ─────────────────────────────────────────────────────────────────────────

function OpenCustodyModal({ branchId, onClose, onOpened }: { branchId: string | null; onClose: () => void; onOpened: () => void }) {
  const { showToast } = useToast();
  const [holderType, setHolderType] = useState<HolderType>('data_entry_employee');
  const [holderId, setHolderId] = useState('');
  const [holderOptions, setHolderOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [openingUsd, setOpeningUsd] = useState('');
  const [openingSyp, setOpeningSyp] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHolderId('');
    const path = holderType === 'driver' ? '/drivers' : '/users';
    httpClient
      .get<Array<{ id: string; name?: string; full_name?: string; username?: string }>>(path)
      .then((rows) => setHolderOptions(rows.map((r) => ({ id: r.id, name: r.name || r.full_name || r.username || '—' }))))
      .catch(() => setHolderOptions([]));
  }, [holderType]);

  const valid = holderId && openingUsd.trim() !== '' && openingSyp.trim() !== '' && !Number.isNaN(Number(openingUsd)) && !Number.isNaN(Number(openingSyp));

  const save = async () => {
    if (!valid) {
      showToast('أكملي الحامل والمبلغ الافتتاحي (حتى لو صفر)', 'error');
      return;
    }
    setSaving(true);
    try {
      await httpClient.post('/custody-shifts', {
        branchId: branchId ?? undefined,
        holderType,
        holderUserId: holderType === 'data_entry_employee' ? holderId : undefined,
        holderDriverId: holderType === 'driver' ? holderId : undefined,
        holderLabel: holderOptions.find((h) => h.id === holderId)?.name,
        openingBalances: [
          { currencyCode: 'USD', amount: Number(openingUsd) },
          { currencyCode: 'SYP', amount: Number(openingSyp) },
        ],
      });
      showToast('تم فتح العهدة', 'success');
      onOpened();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر فتح العهدة', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)' }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 'min(480px, calc(100vw - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 14px' }}>فتح عهدة جديدة</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group">
            <label className="form-label">نوع الحامل</label>
            <select className="form-select" value={holderType} onChange={(e) => setHolderType(e.target.value as HolderType)}>
              <option value="data_entry_employee">موظف إدخال بيانات</option>
              <option value="driver">سائق</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{holderType === 'driver' ? 'السائق' : 'الموظف'}</label>
            <select className="form-select" value={holderId} onChange={(e) => setHolderId(e.target.value)}>
              <option value="">اختر...</option>
              {holderOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">افتتاحي USD</label>
              <input type="number" className="form-input" value={openingUsd} onChange={(e) => setOpeningUsd(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">افتتاحي SYP</label>
              <input type="number" className="form-input" value={openingSyp} onChange={(e) => setOpeningSyp(e.target.value)} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void save()} disabled={saving || !valid}>
            {saving ? 'جارٍ الفتح...' : 'فتح العهدة'}
          </button>
        </div>
      </div>
    </div>
  );
}
