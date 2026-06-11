import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, CheckCircle2 } from 'lucide-react';
import SmartPartyInput from '../SmartPartyInput';
import { useToast } from '../Toast';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { formatCurrency, getExchangeRatesToUsd, parseDecimalAmount, type CurrencyCode } from '../../lib/currency/currency';
import {
  buildVoucherPayload,
  cashboxesForCurrency,
  createVoucherGridRow,
  isVoucherGridRowStarted,
  resolveAgentCashbox,
  voucherGridRowUsd,
  type VoucherGridRow,
} from '../../lib/finance/voucherGridHelpers';

const GRID_ENTRY_SLOTS = 5;

type Props = {
  cashboxes: BackendCashboxRecord[];
  canBackdate: boolean;
  canUpdate: boolean;
  todayIso: string;
  onSaved: () => void | Promise<void>;
};

function voucherStatusLabel(status: VoucherGridRow['status']): string {
  if (status === 'draft') return 'مسودة';
  if (status === 'confirmed') return 'مؤكد';
  if (status === 'cancelled') return 'ملغى';
  return 'جديد';
}

function ensureTrailingBlankRows(rows: VoucherGridRow[]): VoucherGridRow[] {
  const blanks = rows.filter((r) => r.status === 'new' && !isVoucherGridRowStarted(r));
  const trailing = blanks.length ? blanks[blanks.length - 1] : null;
  const core = rows.filter((r) => r !== trailing);
  const next = trailing ? [...core, trailing] : [...core];
  while (next.filter((r) => r.status === 'new' && !isVoucherGridRowStarted(r)).length < 1) {
    next.push(createVoucherGridRow());
  }
  return next;
}

export default function VoucherExcelGrid({ cashboxes, canBackdate, canUpdate, todayIso, onSaved }: Props) {
  const rates = getExchangeRatesToUsd();
  const { showToast } = useToast();
  const [rows, setRows] = useState<VoucherGridRow[]>(() =>
    ensureTrailingBlankRows(Array.from({ length: GRID_ENTRY_SLOTS }, () => createVoucherGridRow())),
  );
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchConfirming, setBatchConfirming] = useState(false);

  const dirtyCount = useMemo(
    () => rows.filter((r) => r.saveState === 'dirty' || (r.status === 'new' && isVoucherGridRowStarted(r))).length,
    [rows],
  );
  const draftSelectedCount = useMemo(
    () => rows.filter((r) => r.status === 'draft' && r.selected).length,
    [rows],
  );

  const patchRow = useCallback((localId: string, patch: Partial<VoucherGridRow>) => {
    setRows((prev) =>
      ensureTrailingBlankRows(
        prev.map((row) => {
          if (row.localId !== localId) return row;
          const next = { ...row, ...patch };
          if (row.status !== 'confirmed' && row.status !== 'cancelled') {
            next.saveState = patch.saveState ?? (row.saveState === 'saved' ? 'dirty' : row.saveState === 'idle' ? 'dirty' : row.saveState);
          }
          return next;
        }),
      ),
    );
  }, []);

  const persistRow = async (row: VoucherGridRow, confirm: boolean): Promise<VoucherGridRow> => {
    const { payload, error } = buildVoucherPayload(row, { rates, canBackdate, todayIso, confirm });
    if (error) return { ...row, saveState: 'error', errorMessage: error };

    const gateway =
      row.kind === 'receipt' ? phase3FinanceGateway.receiptVouchers : phase3FinanceGateway.paymentVouchers;

    if (row.backendId) {
      const updated = await gateway.update(row.backendId, payload);
      return {
        ...row,
        voucherNo: updated.voucherNo,
        syntheticId: updated.id,
        backendId: gateway.getBackendIdFromSynthetic(updated.id) ?? row.backendId,
        status: confirm ? 'confirmed' : 'draft',
        saveState: 'saved',
        selected: false,
        errorMessage: undefined,
      };
    }

    const created = await gateway.create(payload);
    const backendId = gateway.getBackendIdFromSynthetic(created.id);
    return {
      ...row,
      voucherNo: created.voucherNo,
      syntheticId: created.id,
      backendId: backendId ?? undefined,
      status: confirm ? 'confirmed' : 'draft',
      saveState: 'saved',
      selected: false,
      errorMessage: undefined,
    };
  };

  const saveDraftRow = async (localId: string) => {
    const row = rows.find((r) => r.localId === localId);
    if (!row || !isVoucherGridRowStarted(row)) return;
    if (row.status === 'confirmed') {
      showToast('السند مؤكد — لا يمكن حفظه كمسودة', 'info');
      return;
    }
    patchRow(localId, { saveState: 'saving', errorMessage: undefined });
    try {
      const saved = await persistRow(row, false);
      setRows((prev) => ensureTrailingBlankRows(prev.map((r) => (r.localId === localId ? saved : r))));
      showToast(`تم حفظ مسودة ${saved.voucherNo}`, 'success');
      await onSaved();
    } catch (e) {
      patchRow(localId, {
        saveState: 'error',
        errorMessage: e instanceof Error ? e.message : 'تعذر الحفظ',
      });
    }
  };

  const saveAllDrafts = async () => {
    const targets = rows.filter(
      (r) => r.status !== 'confirmed' && r.status !== 'cancelled' && isVoucherGridRowStarted(r),
    );
    if (!targets.length) {
      showToast('لا توجد أسطر للحفظ', 'info');
      return;
    }
    setBatchSaving(true);
    let ok = 0;
    try {
      for (const row of targets) {
        try {
          const saved = await persistRow(row, false);
          setRows((prev) => ensureTrailingBlankRows(prev.map((r) => (r.localId === row.localId ? saved : r))));
          ok += 1;
        } catch (e) {
          patchRow(row.localId, {
            saveState: 'error',
            errorMessage: e instanceof Error ? e.message : 'تعذر الحفظ',
          });
        }
      }
      showToast(ok ? `تم حفظ ${ok} مسودة` : 'لم يُحفظ أي سطر', ok ? 'success' : 'error');
      await onSaved();
    } finally {
      setBatchSaving(false);
    }
  };

  const confirmSelected = async () => {
    if (!canUpdate) return;
    const targets = rows.filter((r) => r.status === 'draft' && r.selected && r.backendId);
    if (!targets.length) {
      showToast('حدّد مسودات للترحيل', 'info');
      return;
    }
    setBatchConfirming(true);
    let ok = 0;
    try {
      for (const row of targets) {
        try {
          const confirmed = await persistRow(row, true);
          setRows((prev) => ensureTrailingBlankRows(prev.map((r) => (r.localId === row.localId ? confirmed : r))));
          ok += 1;
        } catch (e) {
          patchRow(row.localId, {
            saveState: 'error',
            errorMessage: e instanceof Error ? e.message : 'تعذر الترحيل',
          });
        }
      }
      showToast(ok ? `تم ترحيل ${ok} سند` : 'لم يُرحّل أي سند', ok ? 'success' : 'error');
      await onSaved();
    } finally {
      setBatchConfirming(false);
    }
  };

  const addRow = () => {
    setRows((prev) => ensureTrailingBlankRows([...prev, createVoucherGridRow()]));
  };

  const handleGridKeyDown = (e: KeyboardEvent, rowIndex: number, field: string) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const next = document.querySelector<HTMLElement>(
      `[data-voucher-row="${rowIndex + 1}"][data-voucher-field="${field}"]`,
    );
    next?.focus();
  };

  useEffect(() => {
    setRows((prev) => ensureTrailingBlankRows(prev));
  }, []);

  return (
    <div className="voucher-excel-panel card">
      <div className="voucher-excel-toolbar">
        <div>
          <strong>إدخال سريع — شبكة السندات</strong>
          <p className="voucher-excel-hint">كل سطر = سند. احفظ مسودة ثم رحّل بعد المراجعة — الترحيل يؤثر على الصندوق والذمم.</p>
        </div>
        <div className="voucher-excel-toolbar-actions">
          <button type="button" className="toolbar-btn" onClick={addRow}>
            <Plus size={16} />
            سطر
          </button>
        </div>
      </div>

      <div className="voucher-excel-scroll">
        <table className="voucher-excel-grid">
          <thead>
            <tr>
              <th className="col-select">✓</th>
              <th className="col-kind">النوع</th>
              <th className="col-date">التاريخ</th>
              <th className="col-party">الجهة</th>
              <th className="col-amount">المبلغ</th>
              <th className="col-currency">العملة</th>
              <th className="col-cashbox">الصندوق</th>
              <th className="col-notes">البيان</th>
              <th className="col-usd">USD</th>
              <th className="col-status">الحالة</th>
              <th className="col-no">رقم السند</th>
              <th className="col-action">حفظ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const boxes = cashboxesForCurrency(cashboxes, row.currency);
              const usd = voucherGridRowUsd(row, rates);
              const readonly = row.status === 'confirmed' || row.status === 'cancelled';
              return (
                <tr
                  key={row.localId}
                  className={[
                    row.kind === 'receipt' ? 'row-receipt' : 'row-payment',
                    row.saveState === 'error' ? 'row-error' : '',
                    row.status === 'draft' ? 'row-draft' : '',
                    row.status === 'confirmed' ? 'row-confirmed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={row.errorMessage ?? undefined}
                >
                  <td className="col-select">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={row.status !== 'draft' || !row.backendId}
                      onChange={(e) => patchRow(row.localId, { selected: e.target.checked })}
                    />
                  </td>
                  <td className="col-kind">
                    <select
                      className="voucher-grid-input"
                      value={row.kind}
                      disabled={readonly || Boolean(row.backendId)}
                      data-voucher-row={index}
                      data-voucher-field="kind"
                      onChange={(e) =>
                        patchRow(row.localId, { kind: e.target.value as 'receipt' | 'payment' })
                      }
                    >
                      <option value="receipt">قبض</option>
                      <option value="payment">دفع</option>
                    </select>
                  </td>
                  <td className="col-date">
                    <input
                      type="date"
                      className="voucher-grid-input"
                      value={row.date}
                      min={canBackdate ? undefined : todayIso}
                      max={todayIso}
                      readOnly={readonly}
                      disabled={readonly}
                      data-voucher-row={index}
                      data-voucher-field="date"
                      onChange={(e) => patchRow(row.localId, { date: e.target.value })}
                      onKeyDown={(e) => handleGridKeyDown(e, index, 'party')}
                    />
                  </td>
                  <td className="col-party">
                    <SmartPartyInput
                      value={row.relatedParty}
                      disabled={readonly}
                      includeAgents
                      allowQuickContacts={false}
                      allowAddNew={false}
                      placeholder="عميل / وكيل / جهة"
                      onChange={(value) =>
                        patchRow(row.localId, {
                          relatedParty: value,
                          customerId: null,
                          agentId: null,
                        })
                      }
                      onSelect={(p) => {
                        if (p.source_table === 'customers') {
                          patchRow(row.localId, {
                            relatedParty: p.name,
                            customerId: p.id,
                            agentId: null,
                          });
                          return;
                        }
                        if (p.source_table === 'agents') {
                          const box = resolveAgentCashbox(cashboxes, p.id, row.currency);
                          patchRow(row.localId, {
                            relatedParty: p.name,
                            customerId: null,
                            agentId: p.id,
                            cashboxId: box?.id ?? row.cashboxId,
                            ...(box && box.currency_code !== row.currency
                              ? { currency: box.currency_code as CurrencyCode }
                              : {}),
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="col-amount">
                    <input
                      type="number"
                      step="0.01"
                      className="voucher-grid-input text-left"
                      value={row.amount}
                      readOnly={readonly}
                      disabled={readonly}
                      data-voucher-row={index}
                      data-voucher-field="amount"
                      onChange={(e) => patchRow(row.localId, { amount: e.target.value })}
                      onKeyDown={(e) => handleGridKeyDown(e, index, 'currency')}
                    />
                  </td>
                  <td className="col-currency">
                    <select
                      className="voucher-grid-input"
                      value={row.currency}
                      disabled={readonly}
                      data-voucher-row={index}
                      data-voucher-field="currency"
                      onChange={(e) =>
                        patchRow(row.localId, {
                          currency: e.target.value as CurrencyCode,
                          cashboxId: '',
                        })
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="SYP">SYP</option>
                      <option value="TRY">TRY</option>
                    </select>
                  </td>
                  <td className="col-cashbox">
                    <select
                      className="voucher-grid-input"
                      value={row.cashboxId}
                      disabled={readonly}
                      data-voucher-row={index}
                      data-voucher-field="cashbox"
                      onChange={(e) => patchRow(row.localId, { cashboxId: e.target.value })}
                    >
                      <option value="">—</option>
                      {boxes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="col-notes">
                    <input
                      type="text"
                      className="voucher-grid-input"
                      value={row.description}
                      readOnly={readonly}
                      disabled={readonly}
                      placeholder="بيان"
                      onChange={(e) => patchRow(row.localId, { description: e.target.value })}
                    />
                  </td>
                  <td className="col-usd text-left">{formatCurrency(usd, 'USD')}</td>
                  <td className="col-status">
                    <span className={`voucher-grid-status status-${row.status}`}>{voucherStatusLabel(row.status)}</span>
                  </td>
                  <td className="col-no">{row.voucherNo || '—'}</td>
                  <td className="col-action">
                    {!readonly && isVoucherGridRowStarted(row) ? (
                      <button
                        type="button"
                        className="voucher-grid-save-btn"
                        disabled={row.saveState === 'saving'}
                        onClick={() => void saveDraftRow(row.localId)}
                      >
                        {row.saveState === 'saving' ? '…' : 'مسودة'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="voucher-excel-actions-row">
              <td colSpan={12}>
                <div className="voucher-excel-footer">
                  <button
                    type="button"
                    className="toolbar-btn primary"
                    disabled={batchSaving || dirtyCount === 0}
                    onClick={() => void saveAllDrafts()}
                  >
                    <Save size={16} />
                    {batchSaving ? 'جاري الحفظ...' : `حفظ المسودات (${dirtyCount})`}
                  </button>
                  {canUpdate ? (
                    <button
                      type="button"
                      className="toolbar-btn primary"
                      disabled={batchConfirming || draftSelectedCount === 0}
                      onClick={() => void confirmSelected()}
                    >
                      <CheckCircle2 size={16} />
                      {batchConfirming
                        ? 'جاري الترحيل...'
                        : `تأكيد وترحيل (${draftSelectedCount})`}
                    </button>
                  ) : null}
                  <span className="voucher-excel-footer-note">
                    الترحيل يُسجّل حركة الصندوق وذمة الجهة وفق الأصول المحاسبية.
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
