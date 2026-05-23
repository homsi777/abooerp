import { useState, useEffect, useCallback } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import type { Manifest, Vehicle, Driver, Shipment } from '../types';
import { useToast } from '../components/Toast';
import { useRealtimeRefresh } from '../lib/realtime/useRealtimeRefresh';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../lib/currency/currency';

export default function Manifest() {
  const rates = getExchangeRatesToUsd();
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedManifest, setSelectedManifest] = useState<Manifest | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Manifest>>({
    manifestNo: '', date: new Date().toISOString().split('T')[0], vehicleId: 0, vehiclePlate: '', driverId: 0, driverName: '', route: '', shipments: [], notes: '', status: 'draft'
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [manifestsData, vehiclesData, driversData, shipmentsData] = await Promise.all([
        phase15Gateway.manifests.getAll(),
        phase15Gateway.vehicles.getAll(),
        phase15Gateway.drivers.getAll(),
        phase15Gateway.shipments.getAll(),
      ]);
      setManifests(manifestsData);
      setVehicles(vehiclesData);
      setDrivers(driversData);
      setShipments(shipmentsData);
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeRefresh(['manifest.updated', 'shipment.updated'], () => void loadData());

  const handleNew = () => {
    setSelectedManifest(null);
    setFormData({ manifestNo: '', date: new Date().toISOString().split('T')[0], vehicleId: 0, vehiclePlate: '', driverId: 0, driverName: '', route: '', shipments: [], notes: '', status: 'draft' });
    setIsEditing(true);
  };

  const handleEdit = (manifest: Manifest) => {
    setSelectedManifest(manifest);
    setFormData(manifest);
    setIsEditing(true);
  };

  const handleVehicleChange = (vehicleId: number) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (vehicle) {
      setFormData({ ...formData, vehicleId: vehicle.id, vehiclePlate: vehicle.plateNumber });
    }
  };

  const handleDriverChange = (driverId: number) => {
    const driver = drivers.find(d => d.id === driverId);
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
      await loadData();
      setIsEditing(false);
    } catch { showToast('حدث خطأ', 'error'); }
  };

  const manifestShipments = (manifestId: number) => {
    const manifest = manifests.find(m => m.id === manifestId);
    if (!manifest) return [];
    return shipments.filter(s => manifest.shipments.includes(s.id));
  };

  const getManifestTotalUsd = (manifestId: number) => {
    return manifestShipments(manifestId).reduce(
      (sum, shipment) => sum + convertToUsd(shipment.total || 0, (shipment.currency || 'USD') as CurrencyCode, rates),
      0
    );
  };

  const totalManifestUsd = manifests.reduce((sum, manifest) => sum + getManifestTotalUsd(manifest.id), 0);
  const toggleShipmentInManifest = (shipmentId: number) => {
    const current = formData.shipments || [];
    const exists = current.includes(shipmentId);
    const nextShipments = exists ? current.filter((id) => id !== shipmentId) : [...current, shipmentId];
    const selected = shipments.filter((s) => nextShipments.includes(s.id));
    const totalWeight = selected.reduce((sum, item) => sum + (item.weight || 0), 0);
    setFormData((prev) => ({
      ...prev,
      shipments: nextShipments,
      totalShipments: nextShipments.length,
      totalWeight,
    }));
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    loaded: 'bg-blue-100 text-blue-800',
    in_transit: 'bg-purple-100 text-purple-800',
    arrived: 'bg-green-100 text-green-800',
    unloaded: 'bg-amber-100 text-amber-800',
  };

  const statusLabels: Record<string, string> = {
    draft: 'مسودة', loaded: 'محمل', in_transit: 'في الطريق', arrived: 'وصل', unloaded: 'مفرغ'
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Manifest / تحميل الشاحنات</h2>
        <button onClick={loadData} className="toolbar-btn">تحميل</button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="stat-card">
          <div className="stat-value">{manifests.length}</div>
          <div className="stat-label">عدد بيانات Manifest</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{shipments.length}</div>
          <div className="stat-label">الشحنات المرتبطة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalManifestUsd, 'USD')}</div>
          <div className="stat-label">إجمالي قيمة الشحنات (USD)</div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={() => window.print()} className="toolbar-btn">طباعة</button>
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
                <th>إجمالي قيمة الشحنات USD</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {manifests.map((m) => (
                <tr key={m.id} className={selectedManifest?.id === m.id ? 'selected' : ''} onClick={() => handleEdit(m)}>
                  <td>{m.manifestNo}</td>
                  <td>{m.date}</td>
                  <td>{m.vehiclePlate}</td>
                  <td>{m.driverName}</td>
                  <td>{m.route}</td>
                  <td className="text-center">{m.totalShipments}</td>
                  <td className="text-left">{formatCurrency(getManifestTotalUsd(m.id), 'USD')}</td>
                  <td><span className={`status-badge ${statusColors[m.status]}`}>{statusLabels[m.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-96 card overflow-auto">
            <div className="card-header">{selectedManifest ? 'تعديل Manifest' : 'Manifest جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">رقم Manifest</label>
                <input type="text" className="form-input w-full bg-gray-100" value={formData.manifestNo || ''} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">التاريخ</label>
                <input type="date" className="form-input w-full" value={formData.date || ''} onChange={(e) => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">المركبة</label>
                <select className="form-select w-full" value={formData.vehicleId || ''} onChange={(e) => handleVehicleChange(Number(e.target.value))}>
                  <option value="">اختر...</option>
                  {vehicles.filter(v => v.isActive).map(v => <option key={v.id} value={v.id}>{v.plateNumber} - {v.type}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">السائق</label>
                <select className="form-select w-full" value={formData.driverId || ''} onChange={(e) => handleDriverChange(Number(e.target.value))}>
                  <option value="">اختر...</option>
                  {drivers.filter(d => d.isActive).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المسار</label>
                <input type="text" className="form-input w-full" value={formData.route || ''} onChange={(e) => setFormData({...formData, route: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea className="form-input w-full" rows={2} value={formData.notes || ''} onChange={(e) => setFormData({...formData, notes: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">ربط الشحنات بالمانيفست</label>
                <div className="max-h-40 overflow-auto border rounded p-2 space-y-1">
                  {shipments.map((shipment) => (
                    <label key={shipment.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{shipment.shipmentNo} - {shipment.destinationName}</span>
                      <input
                        type="checkbox"
                        checked={(formData.shipments || []).includes(shipment.id)}
                        onChange={() => toggleShipmentInManifest(shipment.id)}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
