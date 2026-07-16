import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Search, X } from 'lucide-react';
import {
  hasLedgerGlobalSearchCriteria,
  searchLedgerRowsGlobally,
  type LedgerGlobalSearchInput,
} from '../../lib/shipping/dailyLedgerGlobalSearchGateway';
import { printGlobalSearchResults } from '../../lib/shipping/dailyLedgerGlobalSearchPrint';
import {
  remoteCollectAmountLabel,
  remoteRowCollectionUsd,
} from '../../lib/shipping/dailyLedgerPrintable';
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

function fmtCell(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const raw = String(value).trim();
  return raw || '—';
}

function fmtMoney(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '0' || raw === '0.00' || raw === '0.0') return '—';
  return raw;
}

function fmtCollect(row: RemoteDailyLedgerRow): string {
  const labeled = remoteCollectAmountLabel(row);
  if (labeled.trim()) return labeled;
  const total = remoteRowCollectionUsd(row);
  return total > 0 ? String(total) : '—';
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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [rows, setRows] = useState<RemoteDailyLedgerRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCriteria, setLastCriteria] = useState<LedgerGlobalSearchInput>({});
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

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
    setQuery(initialQuery.trim());
    setRows([]);
    setSearched(false);
    setError(null);
    setLastCriteria({});
  }, [open, initialQuery]);

  useEffect(() => {
    if (!searched || !rows.length) return;
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    wrap.scrollLeft = 0;
    wrap.scrollTop = 0;
  }, [rows, searched]);

  const scopeLabel = allBranches ? 'كل الفروع — كل التواريخ' : 'الفرع الحالي — كل التواريخ';

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    const input: LedgerGlobalSearchInput = { q: trimmed };
    if (!hasLedgerGlobalSearchCriteria(input)) {
      setError('أدخل كلمة بحث واحدة على الأقل — اسم جهة، مرسل، مستلم، رقم إشعار/إيصال، أو نوع بضاعة.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await searchLedgerRowsGlobally({
        branchId,
        allBranches,
        includeLoaded,
        q: trimmed,
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
  }, [allBranches, branchId, includeLoaded, query]);

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
              ابحث باسم الجهة أو المرسل أو المستلم أو رقم الإشعار/الإيصال أو نوع البضاعة — خانة واحدة تكفي.
            </p>
          </div>
          <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>

        <div className="quick-ledger-dispatch-dialog-body">
          <label className="quick-ledger-global-search-unified">
            <span>بحث ذكي</span>
            <div className="quick-ledger-global-search-unified-row">
              <Search size={18} aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="اسم الجهة، مرسل، مستلم، رقم إشعار/إيصال، نوع بضاعة..."
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                autoFocus
              />
            </div>
          </label>

          <div className="quick-ledger-global-search-actions">
            <button type="button" className="primary" onClick={() => void runSearch()} disabled={loading}>
              <Search size={16} />
              {loading ? 'جاري البحث...' : 'بحث'}
            </button>
            <span className="quick-ledger-global-search-hint">
              {allBranches ? 'كل الفروع' : 'الفرع الحالي'}
              {' · '}
              كل التواريخ
              {' · '}
              حرف واحد على الأقل
            </span>
          </div>

          {error ? <p className="quick-ledger-global-search-error">{error}</p> : null}

          <div className="quick-ledger-global-search-results">
            {!searched ? (
              <p className="quick-ledger-global-search-empty">اكتب كلمة البحث ثم اضغط «بحث».</p>
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
                    title="طباعة النتائج — نفس أعمدة سطر الشحنة"
                  >
                    <Printer size={16} />
                    {printing ? 'جاري الطباعة...' : 'طباعة النتائج'}
                  </button>
                </div>
                <div ref={tableWrapRef} className="quick-ledger-global-search-table-wrap">
                  <table className="quick-ledger-global-search-shipment-table">
                    <thead>
                      <tr>
                        <th className="col-party">الجهة</th>
                        <th className="col-type">نوع البضاعة</th>
                        <th className="col-count">عدد الطرود</th>
                        <th className="col-weight">الوزن كغ</th>
                        <th className="col-money">تحصيل $</th>
                        <th className="col-money">حوالة</th>
                        <th className="col-money">أجرة الحوالة</th>
                        <th className="col-money">دفع مسبق $</th>
                        <th className="col-party">المرسل</th>
                        <th className="col-party">المرسل إليه</th>
                        <th className="col-receipt">رقم الإيصال</th>
                        <th className="col-notes">ملاحظات</th>
                        <th className="col-meta">التاريخ · الفرع</th>
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
                          <td className="col-party">{fmtCell(row.destination)}</td>
                          <td className="col-type">{fmtCell(row.parcel_type)}</td>
                          <td className="col-count">{fmtCell(row.parcel_count)}</td>
                          <td className="col-weight">{fmtCell(row.weight_kg)}</td>
                          <td className="col-money">{fmtCollect(row)}</td>
                          <td className="col-money">{fmtMoney(row.hawala_amount_usd)}</td>
                          <td className="col-money">{fmtMoney(row.transfer_service_fee_usd)}</td>
                          <td className="col-money">{fmtMoney(row.prepaid_amount_usd)}</td>
                          <td className="col-party">{fmtCell(row.sender_name)}</td>
                          <td className="col-party">{fmtCell(row.receiver_name)}</td>
                          <td className="col-receipt"><strong>{fmtCell(row.receipt_no)}</strong></td>
                          <td className="col-notes">{fmtCell(row.notes)}</td>
                          <td className="col-meta">
                            <div>{fmtDate(row.ledger_date)}</div>
                            <div className="quick-ledger-global-search-muted">
                              {branchNameById.get(row.branch_id) ?? fmtCell(row.branch_id)}
                              {row.line_label ? ` · ${row.line_label}` : ''}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
