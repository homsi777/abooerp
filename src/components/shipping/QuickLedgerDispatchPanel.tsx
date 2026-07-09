import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Truck, X } from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  dailyLedgerDispatchGateway,
  type DailyLedgerDispatchDefinition,
  type DailyLedgerDispatchScope,
} from '../../lib/shipping/dailyLedgerDispatchGateway';
import type { Driver, Vehicle } from '../../types';

type QuickLedgerDispatchPanelProps = {
  scope: DailyLedgerDispatchScope | null;
  scopeBlockedReason?: string | null;
  drivers: Driver[];
  vehicles: Vehicle[];
  definitions: DailyLedgerDispatchDefinition[];
  onDefinitionsChange: (definitions: DailyLedgerDispatchDefinition[]) => void;
  onToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  disabled?: boolean;
};

export default function QuickLedgerDispatchPanel({
  scope,
  scopeBlockedReason = null,
  drivers,
  vehicles,
  definitions,
  onDefinitionsChange,
  onToast,
  disabled = false,
}: QuickLedgerDispatchPanelProps) {
  const [open, setOpen] = useState(false);
  const [dispatchNo, setDispatchNo] = useState('1');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [tripNo, setTripNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const sortedDefinitions = useMemo(
    () => [...definitions].sort((a, b) => a.dispatch_no - b.dispatch_no),
    [definitions],
  );

  const loadDefinitions = async () => {
    if (!scope) return;
    setLoading(true);
    try {
      const result = await dailyLedgerDispatchGateway.list({ ...scope, suggestNext: true });
      onDefinitionsChange(result.definitions);
      if (result.nextDispatchNo) setDispatchNo(String(result.nextDispatchNo));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'تعذر تحميل تعريفات الإرساليات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !scope) return;
    void loadDefinitions();
  }, [open, scope?.branchId, scope?.ledgerDate, scope?.lineLabel]);

  const resetForm = (nextNo?: number) => {
    setDriverId('');
    setVehicleId('');
    setTripNo('');
    if (nextNo) setDispatchNo(String(nextNo));
  };

  const handleCreate = async () => {
    if (!scope || disabled || busy) return;
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
        ...scope,
        dispatchNo: no,
        driverId: driver ? getBackendIdFromSynthetic(driver.id) : null,
        vehicleId: vehicle ? getBackendIdFromSynthetic(vehicle.id) : null,
        driverLabel: driver?.name ?? null,
        vehicleLabel: vehicle
          ? `${vehicle.plateNumber}${vehicle.model ? ` — ${vehicle.model}` : ''}`
          : null,
        tripNo: tripNo.trim() || null,
      });
      const next = [...definitions, created].sort((a, b) => a.dispatch_no - b.dispatch_no);
      onDefinitionsChange(next);
      const suggested = await dailyLedgerDispatchGateway.list({ ...scope, suggestNext: true });
      resetForm(suggested.nextDispatchNo ?? no + 1);
      onToast(`تم تعريف الإرسالية #${created.dispatch_no}`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'تعذر إنشاء تعريف الإرسالية', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (definition: DailyLedgerDispatchDefinition) => {
    if (!scope || disabled || busy) return;
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

  const canUseForm = Boolean(scope) && !disabled && !scopeBlockedReason;

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
          className="quick-ledger-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-ledger-dispatch-modal-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="quick-ledger-confirm-panel quick-ledger-dispatch-modal"
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="quick-ledger-dispatch-modal-header">
              <div>
                <h3 id="quick-ledger-dispatch-modal-title">تعريف إرساليات اليوم</h3>
                <p className="quick-ledger-dispatch-modal-subtitle">
                  عرّف رقم إرسالية + سائق + مركبة لهذا التاريخ، ثم اختر الرقم من عمود «إرسالية» في الجدول.
                </p>
              </div>
              <button
                type="button"
                className="quick-ledger-dispatch-modal-close"
                aria-label="إغلاق"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {scopeBlockedReason ? (
              <p className="quick-ledger-dispatch-blocked" role="status">
                {scopeBlockedReason}
              </p>
            ) : null}

            {scope ? (
              <>
                <div className="quick-ledger-dispatch-form">
                  <label>
                    <span>رقم الإرسالية</span>
                    <input
                      type="number"
                      min={1}
                      value={dispatchNo}
                      disabled={!canUseForm || busy}
                      onChange={(e) => setDispatchNo(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>السائق</span>
                    <select
                      value={driverId}
                      disabled={!canUseForm || busy}
                      onChange={(e) => setDriverId(e.target.value)}
                    >
                      <option value="">اختر...</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.code ? `${driver.code} — ` : ''}{driver.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>المركبة</span>
                    <select
                      value={vehicleId}
                      disabled={!canUseForm || busy}
                      onChange={(e) => setVehicleId(e.target.value)}
                    >
                      <option value="">اختر...</option>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plateNumber}
                          {vehicle.model ? ` — ${vehicle.model}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>رقم الرحلة</span>
                    <input
                      value={tripNo}
                      disabled={!canUseForm || busy}
                      onChange={(e) => setTripNo(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={!canUseForm || busy}
                    onClick={() => void handleCreate()}
                  >
                    <Plus size={14} />
                    {busy ? 'جاري الحفظ...' : 'تعريف إرسالية'}
                  </button>
                </div>

                {loading ? (
                  <p className="quick-ledger-dispatch-empty">جاري تحميل التعريفات...</p>
                ) : sortedDefinitions.length > 0 ? (
                  <div className="quick-ledger-dispatch-table-wrap">
                    <table className="quick-ledger-dispatch-table">
                      <thead>
                        <tr>
                          <th>رقم</th>
                          <th>السائق</th>
                          <th>المركبة</th>
                          <th>رقم الرحلة</th>
                          <th>أسطر</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDefinitions.map((definition) => (
                          <tr key={definition.id}>
                            <td><strong>#{definition.dispatch_no}</strong></td>
                            <td>{definition.driver_label || '—'}</td>
                            <td>{definition.vehicle_label || '—'}</td>
                            <td>{definition.trip_no || '—'}</td>
                            <td>{definition.rows_count ?? 0}</td>
                            <td>
                              <button
                                type="button"
                                className="danger subtle"
                                disabled={disabled || busy || (definition.rows_count ?? 0) > 0}
                                title={
                                  (definition.rows_count ?? 0) > 0
                                    ? 'لا يمكن الحذف — يوجد أسطر مرتبطة'
                                    : 'حذف التعريف'
                                }
                                onClick={() => void handleDelete(definition)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="quick-ledger-dispatch-empty">لا توجد إرساليات معرّفة لهذا التاريخ بعد.</p>
                )}
              </>
            ) : null}

            <div className="quick-ledger-dispatch-modal-footer">
              <button type="button" onClick={() => setOpen(false)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
