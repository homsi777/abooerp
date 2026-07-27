import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, X } from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import type { Driver, Vehicle } from '../../types';

export type CustomSaveRow = {
  id: number;
  receiptNo: string;
  destination: string;
  parcelType: string;
  parcelCount: string;
  weightKg: string;
  sender: string;
  receiver: string;
  postedShipmentId?: string | null;
};

export type CustomSaveSubmit = {
  rowIds: number[];
  driverId: number;
  vehicleId?: number;
  targetDate: string;
};

type DestinationGroup = {
  key: string;
  label: string;
  rowIds: number[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CustomSaveSubmit) => void;
  submitting?: boolean;
  defaultDate: string;
  tripDriverId?: number;
  drivers: Driver[];
  vehicles: Vehicle[];
  candidateRows: CustomSaveRow[];
  isRowComplete: (row: CustomSaveRow) => boolean;
};

function driverLabel(driver: Driver): string {
  return driver.name?.trim() || `#${driver.id}`;
}

function destinationKey(value: string): string {
  const trimmed = value.trim();
  return trimmed || '—';
}

function buildDestinationGroups(rows: CustomSaveRow[]): DestinationGroup[] {
  const map = new Map<string, DestinationGroup>();
  for (const row of rows) {
    const key = destinationKey(row.destination);
    const existing = map.get(key);
    if (existing) {
      existing.rowIds.push(row.id);
      continue;
    }
    map.set(key, { key, label: key, rowIds: [row.id] });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}

export default function QuickLedgerCustomSaveDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
  defaultDate,
  tripDriverId,
  drivers,
  vehicles,
  candidateRows,
  isRowComplete,
}: Props) {
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [driverId, setDriverId] = useState<number | ''>(tripDriverId ?? '');
  const [vehicleId, setVehicleId] = useState<number | ''>('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const eligibleRows = useMemo(
    () => candidateRows.filter((row) => isRowComplete(row) && !row.postedShipmentId),
    [candidateRows, isRowComplete],
  );

  const destinationGroups = useMemo(() => buildDestinationGroups(eligibleRows), [eligibleRows]);

  const rowsByDestination = useMemo(() => {
    const groups = new Map<string, CustomSaveRow[]>();
    for (const row of eligibleRows) {
      const key = destinationKey(row.destination);
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [eligibleRows]);

  useEffect(() => {
    if (!open) return;
    setTargetDate(defaultDate);
    setDriverId(tripDriverId ?? '');
    setVehicleId('');
    setSelectedIds(new Set(eligibleRows.map((row) => row.id)));
  }, [open, defaultDate, tripDriverId, eligibleRows]);

  const driverVehicles = useMemo(() => {
    if (!driverId) return vehicles;
    const backendDriverId = getBackendIdFromSynthetic(driverId);
    if (!backendDriverId) return vehicles;
    return vehicles.filter((vehicle) => {
      const vehicleDriverId = vehicle.driverId ? getBackendIdFromSynthetic(vehicle.driverId) : undefined;
      return vehicleDriverId === backendDriverId;
    });
  }, [driverId, vehicles]);

  useEffect(() => {
    if (!driverVehicles.length) {
      setVehicleId('');
      return;
    }
    if (vehicleId && driverVehicles.some((vehicle) => vehicle.id === vehicleId)) return;
    setVehicleId(driverVehicles[0]?.id ?? '');
  }, [driverVehicles, vehicleId]);

  const toggleRow = (rowId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === eligibleRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleRows.map((row) => row.id)));
    }
  };

  const toggleDestination = (rowIds: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = rowIds.every((rowId) => next.has(rowId));
      if (allSelected) {
        rowIds.forEach((rowId) => next.delete(rowId));
      } else {
        rowIds.forEach((rowId) => next.add(rowId));
      }
      return next;
    });
  };

  const isDestinationFullySelected = (rowIds: number[]) => rowIds.every((rowId) => selectedIds.has(rowId));

  const isDestinationPartiallySelected = (rowIds: number[]) =>
    rowIds.some((rowId) => selectedIds.has(rowId)) && !isDestinationFullySelected(rowIds);

  const handleSubmit = () => {
    if (!driverId) return;
    if (!selectedIds.size) return;
    onSubmit({
      rowIds: [...selectedIds],
      driverId,
      vehicleId: vehicleId || undefined,
      targetDate,
    });
  };

  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="quick-ledger-dispatch-dialog quick-ledger-custom-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-save-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-ledger-dispatch-dialog-header">
          <div>
            <span className="quick-ledger-dispatch-dialog-eyebrow">دفتر الشحن اليومي</span>
            <h3 id="custom-save-title">حفظ مخصص — إرسالية</h3>
            <p className="quick-ledger-dispatch-dialog-sub">
              اختر الوجهات أو الأسطر، ثم حدّد السائق والتاريخ واحفظ وارحّل الشحنات في خطوة واحدة.
            </p>
          </div>
          <button type="button" className="quick-ledger-dispatch-dialog-close" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>

        <div className="quick-ledger-dispatch-dialog-body">
          <div className="quick-ledger-custom-save-fields">
            <label>
              <span>تاريخ الإرسالية</span>
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </label>
            <label>
              <span>السائق *</span>
              <select value={driverId} onChange={(e) => setDriverId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">اختر السائق</option>
                {drivers.filter((d) => d.isActive).map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driverLabel(driver)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>المركبة</span>
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : '')}
                disabled={!driverVehicles.length}
              >
                <option value="">—</option>
                {driverVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber || vehicle.name || `#${vehicle.id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {destinationGroups.length > 0 ? (
            <section className="quick-ledger-custom-save-destinations" aria-label="الوجهات">
              <div className="quick-ledger-custom-save-section-head">
                <h4>الوجهات</h4>
                <span>{destinationGroups.length} وجهة · {selectedIds.size} / {eligibleRows.length} سطر</span>
              </div>
              <div className="quick-ledger-custom-save-destination-list">
                {destinationGroups.map((group) => {
                  const selectedCount = group.rowIds.filter((rowId) => selectedIds.has(rowId)).length;
                  const fullySelected = isDestinationFullySelected(group.rowIds);
                  const partiallySelected = isDestinationPartiallySelected(group.rowIds);
                  return (
                    <div
                      key={group.key}
                      className={[
                        'quick-ledger-custom-save-destination-item',
                        fullySelected ? 'is-selected' : partiallySelected ? 'is-partial' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="quick-ledger-custom-save-destination-info">
                        <strong>{group.label}</strong>
                        <span>
                          {selectedCount} / {group.rowIds.length} سطر
                        </span>
                      </div>
                      <button
                        type="button"
                        className="quick-ledger-custom-save-destination-select"
                        onClick={() => toggleDestination(group.rowIds)}
                      >
                        {fullySelected ? 'إلغاء التحديد' : 'تحديد'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="quick-ledger-custom-save-rows-header">
            <label className="quick-ledger-custom-save-select-all">
              <input
                type="checkbox"
                checked={eligibleRows.length > 0 && selectedIds.size === eligibleRows.length}
                onChange={toggleAll}
              />
              <span>
                تحديد كل الأسطر ({selectedIds.size} / {eligibleRows.length})
              </span>
            </label>
          </div>

          <div className="quick-ledger-custom-save-rows">
            {eligibleRows.length === 0 ? (
              <p className="quick-ledger-custom-save-empty">لا توجد أسطر مكتملة جاهزة للحفظ.</p>
            ) : (
              <>
                <div className="quick-ledger-custom-save-row quick-ledger-custom-save-row-head" aria-hidden>
                  <span />
                  <span>الإيصال / النوع</span>
                  <span>المرسل / المستلم</span>
                  <span>طرود · وزن</span>
                </div>
                {rowsByDestination.map(([destKey, destRows]) => (
                  <div key={destKey} className="quick-ledger-custom-save-destination-block">
                    <div className="quick-ledger-custom-save-destination-block-title">
                      <span>{destKey}</span>
                      <button
                        type="button"
                        className="quick-ledger-custom-save-destination-select is-inline"
                        onClick={() => toggleDestination(destRows.map((row) => row.id))}
                      >
                        {isDestinationFullySelected(destRows.map((row) => row.id)) ? 'إلغاء' : 'تحديد'}
                      </button>
                    </div>
                    {destRows.map((row) => (
                      <label key={row.id} className="quick-ledger-custom-save-row">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                        />
                        <span className="quick-ledger-custom-save-row-main">
                          <strong>{row.receiptNo || `سطر ${row.id}`}</strong>
                          <span>{row.parcelType || '—'}</span>
                        </span>
                        <span className="quick-ledger-custom-save-row-parties">
                          <span>{row.sender || '—'}</span>
                          <span>{row.receiver || '—'}</span>
                        </span>
                        <span className="quick-ledger-custom-save-row-meta">
                          {row.parcelCount || '0'} طرود · {row.weightKg || '0'} كغ
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <footer className="quick-ledger-dispatch-dialog-footer">
          <button type="button" onClick={onClose} disabled={submitting}>
            إلغاء
          </button>
          <button
            type="button"
            className="primary"
            disabled={submitting || !driverId || !selectedIds.size}
            onClick={handleSubmit}
          >
            <Save size={16} />
            {submitting ? 'جاري الحفظ...' : `حفظ (${selectedIds.size})`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function resolveCustomSaveFleet(
  driverId: number,
  vehicleId: number | undefined,
  drivers: Driver[],
  vehicles: Vehicle[],
): {
  driverId: string | null;
  vehicleId: string | null;
  driverLabel: string | null;
  vehicleLabel: string | null;
} {
  const driverBackendId = getBackendIdFromSynthetic(driverId);
  const driver = drivers.find((item) => item.id === driverId);
  const vehicle = vehicleId ? vehicles.find((item) => item.id === vehicleId) : undefined;
  const vehicleBackendId = vehicle ? getBackendIdFromSynthetic(vehicle.id) : null;
  return {
    driverId: driverBackendId ?? null,
    vehicleId: vehicleBackendId,
    driverLabel: driver ? driverLabel(driver) : null,
    vehicleLabel: vehicle ? (vehicle.plateNumber || vehicle.name || null) : null,
  };
}
