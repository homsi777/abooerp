import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  dailyLedgerDispatchGateway,
  type DailyLedgerDispatchDefinition,
  type DailyLedgerDispatchScope,
} from '../../lib/shipping/dailyLedgerDispatchGateway';
import type { Driver, Vehicle } from '../../types';

type QuickLedgerDispatchPanelProps = {
  scope: DailyLedgerDispatchScope | null;
  drivers: Driver[];
  vehicles: Vehicle[];
  definitions: DailyLedgerDispatchDefinition[];
  onDefinitionsChange: (definitions: DailyLedgerDispatchDefinition[]) => void;
  onToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  disabled?: boolean;
};

export default function QuickLedgerDispatchPanel({
  scope,
  drivers,
  vehicles,
  definitions,
  onDefinitionsChange,
  onToast,
  disabled = false,
}: QuickLedgerDispatchPanelProps) {
  const [dispatchNo, setDispatchNo] = useState('1');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [tripNo, setTripNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void dailyLedgerDispatchGateway
      .list({ ...scope, suggestNext: true })
      .then((result) => {
        if (cancelled) return;
        onDefinitionsChange(result.definitions);
        if (result.nextDispatchNo) setDispatchNo(String(result.nextDispatchNo));
      })
      .catch((error) => {
        if (!cancelled) {
          onToast(error instanceof Error ? error.message : 'تعذر تحميل تعريفات الإرساليات', 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope?.branchId, scope?.ledgerDate, scope?.lineLabel]);

  const sortedDefinitions = useMemo(
    () => [...definitions].sort((a, b) => a.dispatch_no - b.dispatch_no),
    [definitions],
  );

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

  if (!scope) return null;

  return (
    <section className="quick-ledger-dispatch-panel" dir="rtl">
      <header className="quick-ledger-dispatch-panel-header">
        <button
          type="button"
          className="quick-ledger-dispatch-panel-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          تعريف إرساليات اليوم (النظام الجديد)
          <span className="quick-ledger-dispatch-panel-count">{sortedDefinitions.length}</span>
        </button>
        <p className="quick-ledger-dispatch-panel-hint">
          عرّف لكل تاريخ رقم إرسالية + سائق + مركبة. ثم اختر الرقم من عمود «إرسالية» في الجدول.
          نظام التبويبات القديم يبقى فعّالاً بجانبه.
        </p>
      </header>

      {expanded ? (
        <>
          <div className="quick-ledger-dispatch-form">
            <label>
              <span>رقم الإرسالية</span>
              <input
                type="number"
                min={1}
                value={dispatchNo}
                disabled={disabled || busy}
                onChange={(e) => setDispatchNo(e.target.value)}
              />
            </label>
            <label>
              <span>السائق</span>
              <select value={driverId} disabled={disabled || busy} onChange={(e) => setDriverId(e.target.value)}>
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
              <select value={vehicleId} disabled={disabled || busy} onChange={(e) => setVehicleId(e.target.value)}>
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
              <input value={tripNo} disabled={disabled || busy} onChange={(e) => setTripNo(e.target.value)} />
            </label>
            <button type="button" className="primary" disabled={disabled || busy} onClick={() => void handleCreate()}>
              <Plus size={14} />
              {busy ? 'جاري الحفظ...' : 'تعريف إرسالية'}
            </button>
          </div>

          {sortedDefinitions.length > 0 ? (
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
          ) : (
            <p className="quick-ledger-dispatch-empty">لا توجد إرساليات معرّفة لهذا التاريخ بعد.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
