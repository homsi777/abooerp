import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Search, X } from 'lucide-react';
import {
  hasLedgerGlobalSearchCriteria,
  searchLedgerRowsGlobally,
  type LedgerGlobalSearchInput,
} from '../../lib/shipping/dailyLedgerGlobalSearchGateway';
import { printGlobalSearchResults } from '../../lib/shipping/dailyLedgerGlobalSearchPrint';
import type { RemoteDailyLedgerRow } from '../../lib/shipping/dailyLedgerTypes';
import type { Branch } from '../../types';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';

type Props = {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  branchId?: string;
  allBranches?: boolean;
  includeLoaded?: boolean;
  branches: Branch[];
  onSelectRow: (row: RemoteDailyLedgerRow) => void;
};

function fmtDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return (match?.[1] ?? raw) || '—';
}

function rowStatusLabel(row: RemoteDailyLedgerRow): string {
  if (row.loaded_at) return 'محمّل';
  if (row.posted_shipment_id) return 'مُرحَّل';
  return 'غير مُرحَّل';
}

export default function QuickLedgerGlobalSearchModal({
  open,
  onClose,
  initialQuery = '',
  branchId,
  allBranches = false,
  includeLoaded = false,
  branches,
  onSelectRow,
}: Props) {
  const [receiptNo, setReceiptNo] = useState('');
  const [parcelType, setParcelType] = useState('');
  const [senderName, setSenderName] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [rows, setRows] = useState<RemoteDailyLedgerRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCriteria, setLastCriteria] = useState<LedgerGlobalSearchInput>({});

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      const backendId = getBackendIdFromSynthetic(branch.id);
      if (backendId) map.set(backendId, branch.name);
    }
    return map;
  }, [branches]);

  useEffect(() => {
    if (!open) return;
    const trimmed = initialQuery.trim();
    setReceiptNo(trimmed);
    setParcelType('');
    setSenderName('');
    setReceiverName('');
    setRows([]);
    setSearched(false);
    setError(null);
    setLastCriteria({});
  }, [open, initialQuery]);

  const scopeLabel = allBranches ? 'كل الفروع — كل التواريخ' : 'الفرع الحالي — كل التواريخ';

  const runSearch = useCallback(async () => {
    const input: LedgerGlobalSearchInput = {
      receiptNo,
      parcelType,
      senderName,
      receiverName,
    };
    if (!hasLedgerGlobalSearchCriteria(input)) {
      setError('أدخل حرفين على الأقل في أحد حقول البحث (إيصال، نوع البضاعة، مرسل، أو مستلم).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await searchLedgerRowsGlobally({
        branchId,
        allBranches,
        includeLoaded,
        receiptNo: receiptNo.trim() || undefined,
        parcelType: parcelType.trim() || undefined,
        senderName: senderName.trim() || undefined,
        receiverName: receiverName.trim() || undefined,
        limit: 200,
      });
      setRows(results);
      setLastCriteria(input);
      setSearched(true);
    } catch (searchError) {
      setRows([]);
      setSearched(true);
      setError(searchError instanceof Error ? searchError.message : 'تعذر تنفيذ البحث');
    } finally {
      setLoading(false);
    }
  }, [allBranches, branchId, includeLoaded, parcelType, receiptNo, receiverName, senderName]);

  const handlePrintResults = useCallback(async () => {
    if (rows.length === 0) return;
    setPrinting(true);
    setError(null);
    try {
      const outcome = await printGlobalSearchResults({
        rows,
        criteria: lastCriteria,
        scopeLabel,
        branchNameById,
      });
      if (outcome === 'error') {
        setError('تعذر إرسال الطباعة — تحقق من الطابعة الافتراضية أو جرّب من المتصفح.');
      }
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'تعذر طباعة نتائج البحث');
    } finally {
      setPrinting(false);
    }
  }, [branchNameById, lastCriteria, rows, scopeLabel]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="quick-ledger-dispatch-dialog quick-ledger-global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-ledger-dispatch-dialog-header">
          <div>
            <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
            <h3 id="global-search-title">بحث شامل — كل التواريخ</h3>
            <p className="quick-ledger-dispatch-dialog-sub">
              بحث تكتيكي في قاعدة البيانات عن الإيصال، نوع البضاعة، المرسل، والمستلم — ثم انتقل للسطر مباشرة.
            </p>
          </div>
          <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>

        <div className="quick-ledger-dispatch-dialog-body">
          <div className="quick-ledger-global-search-fields">
            <label>
              <span>رقم الإيصال</span>
              <input
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder="مثال: 6075"
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              />
            </label>
            <label>
              <span>نوع البضاعة</span>
              <input
                value={parcelType}
                onChange={(e) => setParcelType(e.target.value)}
                placeholder="مثال: كرتونة"
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              />
            </label>
            <label>
              <span>المرسل</span>
              <input
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="اسم المرسل"
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              />
            </label>
            <label>
              <span>المستلم</span>
              <input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="اسم المستلم"
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              />
            </label>
          </div>

          <div className="quick-ledger-global-search-actions">
            <button type="button" className="primary" onClick={() => void runSearch()} disabled={loading}>
              <Search size={16} />
              {loading ? 'جاري البحث...' : 'بحث'}
            </button>
            <span className="quick-ledger-global-search-hint">
              {allBranches ? 'نطاق البحث: كل الفروع' : 'نطاق البحث: الفرع الحالي'}
              {' · '}
              كل التواريخ المسجّلة
            </span>
          </div>

          {error ? <p className="quick-ledger-global-search-error">{error}</p> : null}

          <div className="quick-ledger-global-search-results">
            {!searched ? (
              <p className="quick-ledger-global-search-empty">أدخل معايير البحث ثم اضغط «بحث».</p>
            ) : rows.length === 0 ? (
              <p className="quick-ledger-global-search-empty">لا توجد نتائج مطابقة.</p>
            ) : (
              <>
                <div className="quick-ledger-global-search-results-head">
                  <div className="quick-ledger-global-search-results-summary">
                    <strong>{rows.length}</strong>
                    <span>نتيجة{rows.length >= 200 ? ' (أول 200 — حدّد أكثر)' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="quick-ledger-global-search-print-btn"
                    onClick={() => void handlePrintResults()}
                    disabled={printing}
                    title="طباعة كل النتائج ببيانات شاملة"
                  >
                    <Printer size={16} />
                    {printing ? 'جاري الطباعة...' : 'طباعة النتائج'}
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>إيصال</th>
                      <th>نوع البضاعة</th>
                      <th>مرسل</th>
                      <th>مستلم</th>
                      <th>جهة</th>
                      <th>خط / فرع</th>
                      <th>حالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="quick-ledger-global-search-row"
                        onClick={() => onSelectRow(row)}
                        title="اضغط للانتقال إلى السطر في الدفتر"
                      >
                        <td>{fmtDate(row.ledger_date)}</td>
                        <td><strong>{row.receipt_no || '—'}</strong></td>
                        <td>{row.parcel_type || '—'}</td>
                        <td>{row.sender_name || '—'}</td>
                        <td>{row.receiver_name || '—'}</td>
                        <td>{row.destination || '—'}</td>
                        <td>
                          <div>{row.line_label || '—'}</div>
                          <div className="quick-ledger-global-search-muted">
                            {branchNameById.get(row.branch_id) ?? row.branch_id.slice(0, 8)}
                          </div>
                        </td>
                        <td>
                          <span className={`quick-ledger-global-search-status is-${row.loaded_at ? 'loaded' : row.posted_shipment_id ? 'posted' : 'draft'}`}>
                            {rowStatusLabel(row)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
