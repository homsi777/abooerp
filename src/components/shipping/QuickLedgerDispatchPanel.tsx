import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Plus, Trash2, Truck, X } from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  dailyLedgerDispatchGateway,
  type DailyLedgerDispatchDefinition,
  type DailyLedgerDispatchScope,
} from '../../lib/shipping/dailyLedgerDispatchGateway';
import type { Branch, Driver, Vehicle } from '../../types';

type QuickLedgerDispatchPanelProps = {
  ledgerDate: string;
  lineLabel: string;
  lineOptions: string[];
  branches: Branch[];
  canPickBranch: boolean;
  preferredBranchId: string | null;
  lockedBranchId: string | null;
  drivers: Driver[];
  vehicles: Vehicle[];
  definitions: DailyLedgerDispatchDefinition[];
  onDefinitionsChange: (definitions: DailyLedgerDispatchDefinition[]) => void;
  onToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  disabled?: boolean;
};

function resolveBranchBackendId(branch: Branch | undefined): string | null {
  if (!branch) return null;
  return getBackendIdFromSynthetic(branch.id) ?? null;
}

export default function QuickLedgerDispatchPanel({
  ledgerDate,
  lineLabel,
  lineOptions,
  branches,
  canPickBranch,
  preferredBranchId,
  lockedBranchId,
  drivers,
  vehicles,
  definitions,
  onDefinitionsChange,
  onToast,
  disabled = false,
}: QuickLedgerDispatchPanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedLine, setSelectedLine] = useState('');
  const [dispatchNo, setDispatchNo] = useState('1');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [tripNo, setTripNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const branchOptions = useMemo(
    () =>
      branches
        .map((branch) => ({
          branch,
          backendId: resolveBranchBackendId(branch),
        }))
        .filter((item): item is { branch: Branch; backendId: string } => Boolean(item.backendId)),
    [branches],
  );

  useEffect(() => {
    const fallbackBranchId =
      lockedBranchId ||
      preferredBranchId ||
      branchOptions[0]?.backendId ||
      '';
    setSelectedBranchId((prev) => {
      if (lockedBranchId) return lockedBranchId;
      if (prev && branchOptions.some((item) => item.backendId === prev)) return prev;
      return fallbackBranchId;
    });
  }, [branchOptions, lockedBranchId, preferredBranchId]);

  useEffect(() => {
    setSelectedLine((prev) => {
      const next = lineLabel.trim() || prev;
      if (next) return next;
      return lineOptions[0] ?? '';
    });
  }, [lineLabel, lineOptions]);

  const effectiveScope = useMemo<DailyLedgerDispatchScope | null>(() => {
    if (!ledgerDate || !selectedLine.trim() || !selectedBranchId) return null;
    return {
      branchId: selectedBranchId,
      ledgerDate,
      lineLabel: selectedLine.trim(),
    };
  }, [ledgerDate, selectedBranchId, selectedLine]);

  const selectedBranchName = useMemo(() => {
    const hit = branchOptions.find((item) => item.backendId === selectedBranchId);
    return hit?.branch.name ?? '—';
  }, [branchOptions, selectedBranchId]);

  const sortedDefinitions = useMemo(() => {
    const scoped = canPickBranch
      ? definitions
      : definitions.filter((item) => item.branch_id === selectedBranchId);
    return [...scoped].sort((a, b) => a.dispatch_no - b.dispatch_no);
  }, [canPickBranch, definitions, selectedBranchId]);

  const scopeBlockedReason = useMemo(() => {
    if (!ledgerDate) return 'اختر التاريخ من شاشة الدفتر أولاً.';
    if (!selectedLine.trim()) return 'اختر الخط (مصدر البضاعة) من القائمة أدناه.';
    if (!selectedBranchId) return 'اختر الفرع من القائمة أدناه.';
    return null;
  }, [ledgerDate, selectedBranchId, selectedLine]);

  const loadDefinitions = async (scope: DailyLedgerDispatchScope) => {
    setLoading(true);
    try {
      const result = await dailyLedgerDispatchGateway.list({ ...scope, suggestNext: true });
      const merged = [
        ...definitions.filter((item) => item.branch_id !== scope.branchId),
        ...result.definitions,
      ].sort((a, b) => a.dispatch_no - b.dispatch_no);
      onDefinitionsChange(merged);
      if (result.nextDispatchNo) setDispatchNo(String(result.nextDispatchNo));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'تعذر تحميل تعريفات الإرساليات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !effectiveScope) return;
    void loadDefinitions(effectiveScope);
  }, [open, effectiveScope?.branchId, effectiveScope?.ledgerDate, effectiveScope?.lineLabel]);

  const resetForm = (nextNo?: number) => {
    setDriverId('');
    setVehicleId('');
    setTripNo('');
    if (nextNo) setDispatchNo(String(nextNo));
  };

  const handleCreate = async () => {
    if (!effectiveScope || disabled || busy || scopeBlockedReason) return;
    const no = Number(dispatchNo);
    if (!Number.isFinite(no) || no < 1) {
      onToast('أدخل رقم إرسالية صحيحاً (1، 2، 3…)', 'error');
      return;
    }
    if (!driverId && !vehicleId) {
      onToast('اختر سائقاً أو مركبة على الأقل', 'error');
      return;
    }
    const driver = drivers.find((item) => String(item.id) === driverId);
    const vehicle = vehicles.find((item) => String(item.id) === vehicleId);
    setBusy(true);
    try {
      const created = await dailyLedgerDispatchGateway.create({
        ...effectiveScope,
        dispatchNo: no,
        driverId: driver ? getBackendIdFromSynthetic(driver.id) : null,
        vehicleId: vehicle ? getBackendIdFromSynthetic(vehicle.id) : null,
        driverLabel: driver?.name ?? null,
        vehicleLabel: vehicle
          ? `${vehicle.plateNumber}${vehicle.model ? ` — ${vehicle.model}` : ''}`
          : null,
        tripNo: tripNo.trim() || null,
      });
      const next = [
        ...definitions.filter((item) => item.id !== created.id && item.branch_id !== effectiveScope.branchId),
        created,
      ].sort((a, b) => a.dispatch_no - b.dispatch_no);
      onDefinitionsChange(next);
      const suggested = await dailyLedgerDispatchGateway.list({ ...effectiveScope, suggestNext: true });
      resetForm(suggested.nextDispatchNo ?? no + 1);
      onToast(`تم تعريف الإرسالية #${created.dispatch_no} — ${selectedBranchName}`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'تعذر إنشاء تعريف الإرسالية', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (definition: DailyLedgerDispatchDefinition) => {
    if (!effectiveScope || disabled || busy) return;
    if (!window.confirm(`حذف تعريف الإرسالية #${definition.dispatch_no}؟`)) return;
    setBusy(true);
    try {
      await dailyLedgerDispatchGateway.remove(definition.id);
      onDefinitionsChange(definitions.filter((item) => item.id !== definition.id));
      onToast(`تم حذف تعريف الإرسالية #${definition.dispatch_no}`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'تعذر حذف تعريف الإرسالية', 'error');
    } finally {
      setBusy(false);
    }
  };

  const canUseForm = Boolean(effectiveScope) && !disabled && !scopeBlockedReason;

  return (
    <>
      <button
        type="button"
        className="quick-ledger-dispatch-open-btn"
        disabled={disabled}
        title="تعريف إرساليات اليوم — رقم + سائق + مركبة"
        onClick={() => setOpen(true)}
      >
        <Truck size={16} aria-hidden />
        تعريف إرساليات اليوم
        {sortedDefinitions.length > 0 ? (
          <span className="quick-ledger-dispatch-open-count">{sortedDefinitions.length}</span>
        ) : null}
      </button>

      {open ? (
        <div
          className="quick-ledger-dispatch-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-ledger-dispatch-modal-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="quick-ledger-dispatch-dialog"
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="quick-ledger-dispatch-dialog-hero">
              <div className="quick-ledger-dispatch-dialog-hero-text">
                <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
                <h2 id="quick-ledger-dispatch-modal-title">تعريف إرساليات اليوم</h2>
                <p>
                  {canPickBranch
                    ? 'حدّد الفرع والخط، ثم أنشئ إرساليات مرقّمة. بعدها اختر الرقم من عمود «إرسالية» في جدول الإدخال.'
                    : `فرعك: ${selectedBranchName} — أنشئ إرساليات مرقّمة واربط الأسطر بها من الجدول.`}
                </p>
              </div>
              <button
                type="button"
                className="quick-ledger-dispatch-dialog-close"
                aria-label="إغلاق"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </header>

            <div className="quick-ledger-dispatch-dialog-body">
              <section className="quick-ledger-dispatch-context-card">
                <h3>نطاق التعريف</h3>
                <div className="quick-ledger-dispatch-context-grid">
                  <label className="quick-ledger-dispatch-field">
                    <span><CalendarDays size={14} aria-hidden /> التاريخ</span>
                    <input className="quick-ledger-dispatch-input" value={ledgerDate || '—'} readOnly />
                  </label>
                  <label className="quick-ledger-dispatch-field">
                    <span><MapPin size={14} aria-hidden /> الخط (مصدر البضاعة)</span>
                    <select
                      className="quick-ledger-dispatch-input"
                      value={selectedLine}
                      disabled={!lineOptions.length}
                      onChange={(e) => setSelectedLine(e.target.value)}
                    >
                      <option value="">اختر الخط...</option>
                      {lineOptions.map((line) => (
                        <option key={line} value={line}>
                          {line}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="quick-ledger-dispatch-field">
                    <span>الفرع</span>
                    {canPickBranch ? (
                      <select
                        className="quick-ledger-dispatch-input"
                        value={selectedBranchId}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                      >
                        <option value="">اختر الفرع...</option>
                        {branchOptions.map(({ branch, backendId }) => (
                          <option key={backendId} value={backendId}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="quick-ledger-dispatch-input" value={selectedBranchName} readOnly />
                    )}
                  </label>
                </div>
                {scopeBlockedReason ? (
                  <p className="quick-ledger-dispatch-blocked" role="status">
                    {scopeBlockedReason}
                  </p>
                ) : null}
              </section>

              <div className="quick-ledger-dispatch-dialog-columns">
                <section className="quick-ledger-dispatch-create-card">
                  <div className="quick-ledger-dispatch-section-head">
                    <h3>إضافة إرسالية جديدة</h3>
                    <span className="quick-ledger-dispatch-section-hint">رقم + سائق + مركبة</span>
                  </div>
                  <div className="quick-ledger-dispatch-create-grid">
                    <label className="quick-ledger-dispatch-field">
                      <span>رقم الإرسالية</span>
                      <input
                        className="quick-ledger-dispatch-input quick-ledger-dispatch-input-number"
                        type="number"
                        min={1}
                        value={dispatchNo}
                        disabled={!canUseForm || busy}
                        onChange={(e) => setDispatchNo(e.target.value)}
                      />
                    </label>
                    <label className="quick-ledger-dispatch-field">
                      <span>السائق</span>
                      <select
                        className="quick-ledger-dispatch-input"
                        value={driverId}
                        disabled={!canUseForm || busy}
                        onChange={(e) => setDriverId(e.target.value)}
                      >
                        <option value="">اختر السائق...</option>
                        {drivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.code ? `${driver.code} — ` : ''}{driver.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="quick-ledger-dispatch-field">
                      <span>المركبة</span>
                      <select
                        className="quick-ledger-dispatch-input"
                        value={vehicleId}
                        disabled={!canUseForm || busy}
                        onChange={(e) => setVehicleId(e.target.value)}
                      >
                        <option value="">اختر المركبة...</option>
                        {vehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.plateNumber}
                            {vehicle.model ? ` — ${vehicle.model}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="quick-ledger-dispatch-field">
                      <span>رقم الرحلة</span>
                      <input
                        className="quick-ledger-dispatch-input"
                        value={tripNo}
                        disabled={!canUseForm || busy}
                        onChange={(e) => setTripNo(e.target.value)}
                        placeholder="اختياري"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="quick-ledger-dispatch-submit"
                    disabled={!canUseForm || busy}
                    onClick={() => void handleCreate()}
                  >
                    <Plus size={16} />
                    {busy ? 'جاري الحفظ...' : 'تعريف إرسالية'}
                  </button>
                </section>

                <section className="quick-ledger-dispatch-list-card">
                  <div className="quick-ledger-dispatch-section-head">
                    <h3>الإرساليات المعرّفة</h3>
                    <span className="quick-ledger-dispatch-count-badge">{sortedDefinitions.length}</span>
                  </div>

                  {loading ? (
                    <div className="quick-ledger-dispatch-empty-state">جاري تحميل التعريفات...</div>
                  ) : sortedDefinitions.length > 0 ? (
                    <div className="quick-ledger-dispatch-table-wrap">
                      <table className="quick-ledger-dispatch-table">
                        <thead>
                          <tr>
                            {canPickBranch ? <th>الفرع</th> : null}
                            <th>رقم</th>
                            <th>السائق</th>
                            <th>المركبة</th>
                            <th>رقم الرحلة</th>
                            <th>أسطر</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDefinitions.map((definition) => {
                            const branchName =
                              branchOptions.find((item) => item.backendId === definition.branch_id)?.branch
                                .name ?? '—';
                            return (
                              <tr key={definition.id}>
                                {canPickBranch ? <td>{branchName}</td> : null}
                                <td>
                                  <span className="quick-ledger-dispatch-no">#{definition.dispatch_no}</span>
                                </td>
                                <td>{definition.driver_label || '—'}</td>
                                <td>{definition.vehicle_label || '—'}</td>
                                <td>{definition.trip_no || '—'}</td>
                                <td>{definition.rows_count ?? 0}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="quick-ledger-dispatch-delete"
                                    disabled={disabled || busy || (definition.rows_count ?? 0) > 0}
                                    title={
                                      (definition.rows_count ?? 0) > 0
                                        ? 'لا يمكن الحذف — يوجد أسطر مرتبطة'
                                        : 'حذف التعريف'
                                    }
                                    onClick={() => void handleDelete(definition)}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="quick-ledger-dispatch-empty-state">
                      <Truck size={28} strokeWidth={1.5} aria-hidden />
                      <p>لا توجد إرساليات معرّفة لهذا النطاق بعد.</p>
                      <span>أضف أول إرسالية من النموذج على اليسار.</span>
                    </div>
                  )}
                </section>
              </div>
            </div>

            <footer className="quick-ledger-dispatch-dialog-footer">
              <button type="button" className="quick-ledger-dispatch-footer-btn" onClick={() => setOpen(false)}>
                إغلاق
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
