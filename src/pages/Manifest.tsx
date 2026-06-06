import { useState, useEffect, useCallback, useMemo } from 'react';
import { phase15Gateway, getBackendIdFromSynthetic, syntheticEntityId } from '../lib/api/phase15Gateway';
import { manifestGateway, type LoadableShipmentRow } from '../lib/api/manifestGateway';
import type { Manifest, Vehicle, Driver } from '../types';
import { useToast } from '../components/Toast';
import { useRealtimeRefresh } from '../lib/realtime/useRealtimeRefresh';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../lib/currency/currency';
import { downloadCsv } from '../lib/export/csvDownload';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../lib/shipments/shipmentStatus';

function defaultDateFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

export default function ManifestPage() {
  const rates = getExchangeRatesToUsd();
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loadableRows, setLoadableRows] = useState<LoadableShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadableLoading, setLoadableLoading] = useState(false);
  const [selectedManifest, setSelectedManifest] = useState<Manifest | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [destinationFilter, setDestinationFilter] = useState('');
  const [loadStatus, setLoadStatus] = useState<'all' | 'pending' | 'loaded'>('pending');

  const [formData, setFormData] = useState<Partial<Manifest>>({
    manifestNo: '',
    date: new Date().toISOString().split('T')[0],
    vehicleId: 0,
    vehiclePlate: '',
    driverId: 0,
    driverName: '',
    route: '',
    shipments: [],
    notes: '',
    status: 'draft',
  });

  const loadManifests = useCallback(async () => {
    setLoading(true);
    try {
      const [manifestsData, vehiclesData, driversData] = await Promise.all([
        phase15Gateway.manifests.getAll(),
        phase15Gateway.vehicles.getAll(),
        phase15Gateway.drivers.getAll(),
      ]);
      setManifests(manifestsData);
      setVehicles(vehiclesData);
      setDrivers(driversData);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLoadableShipments = useCallback(async () => {
    setLoadableLoading(true);
    try {
      const manifestBackendId = selectedManifest ? getBackendIdFromSynthetic(selectedManifest.id) : undefined;
      const rows = await manifestGateway.listLoadableShipments({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        destination: destinationFilter.trim() || undefined,
        loadStatus: isEditing ? loadStatus : 'all',
        manifestId: isEditing ? manifestBackendId : undefined,
      });
      setLoadableRows(rows);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل الشحنات', 'error');
    } finally {
      setLoadableLoading(false);
    }
  }, [dateFrom, dateTo, destinationFilter, loadStatus, selectedManifest, isEditing, showToast]);

  useEffect(() => {
    void loadManifests();
  }, [loadManifests]);

  useEffect(() => {
    if (isEditing || selectedManifest) {
      void loadLoadableShipments();
    }
  }, [isEditing, selectedManifest, loadLoadableShipments]);

  useRealtimeRefresh(['manifest.updated', 'shipment.updated'], () => {
    void loadManifests();
    if (isEditing || selectedManifest) void loadLoadableShipments();
  });

  const handleNew = () => {
    setSelectedManifest(null);
    setFormData({
      manifestNo: '',
      date: new Date().toISOString().split('T')[0],
      vehicleId: 0,
      vehiclePlate: '',
      driverId: 0,
      driverName: '',
      route: '',
      shipments: [],
      notes: '',
      status: 'draft',
    });
    setLoadStatus('pending');
    setIsEditing(true);
  };

  const handleEdit = (manifest: Manifest) => {
    setSelectedManifest(manifest);
    setFormData(manifest);
    setLoadStatus('pending');
    setIsEditing(true);
  };

  const handleView = (manifest: Manifest) => {
    setSelectedManifest(manifest);
    setIsEditing(false);
  };

  const handleVehicleChange = (vehicleId: number) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (vehicle) {
      setFormData({ ...formData, vehicleId: vehicle.id, vehiclePlate: vehicle.plateNumber });
    }
  };

  const handleDriverChange = (driverId: number) => {
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) {
      setFormData({ ...formData, driverId: driver.id, driverName: driver.name });
    }
  };

  const handleSave = async () => {
    try {
      if (selectedManifest) {
        await phase15Gateway.manifests.update(selectedManifest.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.manifests.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadManifests();
      setIsEditing(false);
    } catch {
      showToast('حدث خطأ', 'error');
    }
  };

  const selectedShipmentIds = formData.shipments || [];

  const selectedLoadableRows = useMemo(() => {
    if (isEditing) {
      return loadableRows.filter((row) => {
        const sid = syntheticEntityId(row.shipmentId);
        return selectedShipmentIds.includes(sid);
      });
    }
    if (!selectedManifest) return [];
    return loadableRows.filter((row) => selectedManifest.shipments.includes(syntheticEntityId(row.shipmentId)));
  }, [isEditing, loadableRows, selectedShipmentIds, selectedManifest]);

  const getManifestTotalUsd = (rows: LoadableShipmentRow[]) =>
    rows.reduce(
      (sum, row) => sum + convertToUsd(row.totalAmount || 0, (row.currencyCode || 'USD') as CurrencyCode, rates),
      0,
    );

  const totalManifestUsd = manifests.reduce((sum, manifest) => {
    const rows = loadableRows.filter((row) =>
      manifest.shipments.includes(syntheticEntityId(row.shipmentId)),
    );
    return sum + (rows.length ? getManifestTotalUsd(rows) : 0);
  }, 0);

  const toggleShipmentInManifest = (row: LoadableShipmentRow) => {
    if (row.isLoaded && selectedManifest) {
      const currentManifestId = getBackendIdFromSynthetic(selectedManifest.id);
      if (row.loadedManifestId && row.loadedManifestId !== currentManifestId) {
        showToast(`الشحنة محمّلة على Manifest ${row.loadedManifestNo ?? ''}`, 'info');
        return;
      }
    } else if (row.isLoaded && !selectedManifest) {
      showToast(`الشحنة محمّلة على Manifest ${row.loadedManifestNo ?? ''}`, 'info');
      return;
    }

    const shipmentId = syntheticEntityId(row.shipmentId);
    const current = formData.shipments || [];
    const exists = current.includes(shipmentId);
    const nextShipments = exists ? current.filter((id) => id !== shipmentId) : [...current, shipmentId];
    const selected = loadableRows.filter((r) => nextShipments.includes(syntheticEntityId(r.shipmentId)));
    const totalWeight = selected.reduce((sum, item) => sum + (item.weightKg || 0), 0);
    setFormData((prev) => ({
      ...prev,
      shipments: nextShipments,
      totalShipments: nextShipments.length,
      totalWeight,
    }));
  };

  const exportCsv = (rows: LoadableShipmentRow[], label: string) => {
    if (!rows.length) {
      showToast('لا توجد بيانات للتصدير', 'info');
      return;
    }
    downloadCsv(
      `manifest-${label}-${dateFrom}_${dateTo}.csv`,
      [
        'تاريخ الدفتر',
        'رقم الوصل',
        'رقم الشحنة',
        'الوجهة',
        'المحافظة',
        'الوكيل',
        'نوع الطرد',
        'العدد',
        'الوزن',
        'المرسل',
        'المستلم',
        'تحصيل',
        'دفع مسبق',
        'حوالة',
        'أجرة حوالة',
        'الإجمالي',
        'Manifest',
        'الحالة',
      ],
      rows.map((row) => [
        row.ledgerDate ?? String(row.shipmentCreatedAt).split('T')[0],
        row.ledgerReceiptNo ?? row.shipmentNo,
        row.shipmentNo,
        row.ledgerDestination ?? '—',
        row.operationalCenter,
        row.agentName ?? '—',
        row.parcelType ?? '—',
        row.parcelCount ?? '',
        row.weightKg ?? '',
        row.senderName ?? '—',
        row.receiverName ?? '—',
        row.collectAmount,
        row.prepaidAmount,
        row.hawalaAmount,
        row.transferServiceFee,
        row.totalAmount,
        row.loadedManifestNo ?? '—',
        shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)),
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    loaded: 'bg-blue-100 text-blue-800',
    in_transit: 'bg-purple-100 text-purple-800',
    arrived: 'bg-green-100 text-green-800',
    unloaded: 'bg-amber-100 text-amber-800',
  };

  const statusLabels: Record<string, string> = {
    draft: 'مسودة',
    loaded: 'محمل',
    in_transit: 'في الطريق',
    arrived: 'وصل',
    unloaded: 'مفرغ',
  };

  const displayRows = isEditing
    ? loadableRows
    : selectedManifest
      ? selectedLoadableRows
      : [];

  return (
    <div className="h-full flex flex-col manifest-page" dir="rtl">
      <div className="flex items-center justify-between mb-4 no-print">
        <div>
          <h2 className="text-xl font-bold">Manifest / تحميل الشاحنات</h2>
          <p className="text-sm text-gray-500 mt-1">
            ربط الشحنات المنشأة من دفتر الإدخال السريع ببيان التحميل — مع بيانات الوجهة والوكيل
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => void loadManifests()} className="toolbar-btn" disabled={loading}>
            تحديث
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => exportCsv(displayRows, selectedManifest?.manifestNo ?? 'shipments')}
            disabled={!displayRows.length}
          >
            تصدير CSV
          </button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()} disabled={!displayRows.length}>
            طباعة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 no-print">
        <div className="stat-card">
          <div className="stat-value">{manifests.length}</div>
          <div className="stat-label">عدد بيانات Manifest</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{loadableRows.filter((r) => r.fromQuickLedger).length}</div>
          <div className="stat-label">شحنات من الدفتر السريع</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalManifestUsd, 'USD')}</div>
          <div className="stat-label">إجمالي قيمة الشحنات (USD)</div>
        </div>
      </div>

      <div className="card mb-4 p-4 no-print">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">الوجهة / المحافظة</label>
            <input
              className="form-input"
              placeholder="مثال: حلب"
              value={destinationFilter}
              onChange={(e) => setDestinationFilter(e.target.value)}
            />
          </div>
          {isEditing && (
            <div className="form-group">
              <label className="form-label">حالة التحميل</label>
              <select className="form-select" value={loadStatus} onChange={(e) => setLoadStatus(e.target.value as typeof loadStatus)}>
                <option value="pending">جاهزة للتحميل</option>
                <option value="loaded">محمّلة على Manifest</option>
                <option value="all">الكل</option>
              </select>
            </div>
          )}
          <div>
            <button className="toolbar-btn primary" type="button" onClick={() => void loadLoadableShipments()} disabled={loadableLoading}>
              {loadableLoading ? 'جارٍ التحميل...' : 'عرض الشحنات'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2 no-print">
            <button type="button" onClick={handleNew} className="toolbar-btn primary">
              + Manifest جديد
            </button>
          </div>
          <table className="data-grid">
            <thead>
              <tr>
                <th>رقم Manifest</th>
                <th>التاريخ</th>
                <th>المركبة</th>
                <th>السائق</th>
                <th>المسار</th>
                <th>عدد الشحنات</th>
                <th>الحالة</th>
                <th className="no-print">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {manifests.map((m) => (
                <tr key={m.id} className={selectedManifest?.id === m.id ? 'selected' : ''}>
                  <td>{m.manifestNo}</td>
                  <td>{m.date}</td>
                  <td>{m.vehiclePlate}</td>
                  <td>{m.driverName}</td>
                  <td>{m.route || '—'}</td>
                  <td className="text-center">{m.totalShipments}</td>
                  <td>
                    <span className={`status-badge ${statusColors[m.status]}`}>{statusLabels[m.status]}</span>
                  </td>
                  <td className="no-print">
                    <button type="button" className="toolbar-btn" onClick={() => handleView(m)}>
                      عرض
                    </button>
                    <button type="button" className="toolbar-btn primary" onClick={() => handleEdit(m)}>
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(isEditing || selectedManifest) && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {isEditing
                    ? selectedManifest
                      ? `تعديل Manifest ${selectedManifest.manifestNo}`
                      : 'Manifest جديد — اختر الشحنات'
                    : `شحنات Manifest ${selectedManifest?.manifestNo}`}
                </h3>
                <span className="text-sm text-gray-500">
                  المحدد: {selectedLoadableRows.length} | من الدفتر:{' '}
                  {selectedLoadableRows.filter((r) => r.fromQuickLedger).length}
                </span>
              </div>
              <div className="overflow-auto">
                <table className="data-grid">
                  <thead>
                    <tr>
                      {isEditing && <th className="no-print">تحديد</th>}
                      <th>تاريخ</th>
                      <th>رقم الوصل</th>
                      <th>الوجهة</th>
                      <th>الوكيل</th>
                      <th>نوع الطرد</th>
                      <th>عدد</th>
                      <th>وزن</th>
                      <th>المرسل</th>
                      <th>المستلم</th>
                      <th>تحصيل</th>
                      <th>مسبق</th>
                      <th>حوالة</th>
                      <th>Manifest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadableLoading && (
                      <tr>
                        <td colSpan={isEditing ? 14 : 13}>جاري تحميل الشحنات...</td>
                      </tr>
                    )}
                    {!loadableLoading && displayRows.length === 0 && (
                      <tr>
                        <td colSpan={isEditing ? 14 : 13}>لا توجد شحنات ضمن الفترة المحددة.</td>
                      </tr>
                    )}
                    {!loadableLoading &&
                      displayRows.map((row) => {
                        const sid = syntheticEntityId(row.shipmentId);
                        const checked = selectedShipmentIds.includes(sid);
                        const lockedOnOtherManifest =
                          row.isLoaded &&
                          (!selectedManifest ||
                            row.loadedManifestId !== getBackendIdFromSynthetic(selectedManifest.id));
                        return (
                          <tr key={row.shipmentId}>
                            {isEditing && (
                              <td className="no-print">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={lockedOnOtherManifest && !checked}
                                  onChange={() => toggleShipmentInManifest(row)}
                                />
                              </td>
                            )}
                            <td>{row.ledgerDate ?? String(row.shipmentCreatedAt).split('T')[0]}</td>
                            <td>{row.ledgerReceiptNo ?? row.shipmentNo}</td>
                            <td>{row.ledgerDestination ?? row.operationalCenter}</td>
                            <td>{row.agentName ?? '—'}</td>
                            <td>{row.parcelType ?? '—'}</td>
                            <td>{row.parcelCount ?? '—'}</td>
                            <td>{row.weightKg ?? '—'}</td>
                            <td>{row.senderName ?? '—'}</td>
                            <td>{row.receiverName ?? '—'}</td>
                            <td>{row.collectAmount.toLocaleString()}</td>
                            <td>{row.prepaidAmount.toLocaleString()}</td>
                            <td>{row.hawalaAmount.toLocaleString()}</td>
                            <td>{row.loadedManifestNo ?? (row.isLoaded ? 'محمّل' : '—')}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="w-96 card overflow-auto no-print">
            <div className="card-header">{selectedManifest ? 'تعديل Manifest' : 'Manifest جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">رقم Manifest</label>
                <input type="text" className="form-input w-full bg-gray-100" value={formData.manifestNo || ''} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">التاريخ</label>
                <input
                  type="date"
                  className="form-input w-full"
                  value={formData.date || ''}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">المركبة</label>
                <select
                  className="form-select w-full"
                  value={formData.vehicleId || ''}
                  onChange={(e) => handleVehicleChange(Number(e.target.value))}
                >
                  <option value="">اختر...</option>
                  {vehicles
                    .filter((v) => v.isActive)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNumber} - {v.type}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">السائق</label>
                <select
                  className="form-select w-full"
                  value={formData.driverId || ''}
                  onChange={(e) => handleDriverChange(Number(e.target.value))}
                >
                  <option value="">اختر...</option>
                  {drivers
                    .filter((d) => d.isActive)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المسار</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={formData.route || ''}
                  onChange={(e) => setFormData({ ...formData, route: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea
                  className="form-input w-full"
                  rows={2}
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              <div className="text-sm text-gray-600">
                الشحنات المحددة: <strong>{formData.totalShipments ?? 0}</strong> | الوزن:{' '}
                <strong>{formData.totalWeight ?? 0}</strong> كغ
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => void handleSave()} className="toolbar-btn primary flex-1">
                  حفظ
                </button>
                <button type="button" onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
