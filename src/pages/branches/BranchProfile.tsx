import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { normalizeShipmentStatus } from '../../lib/shipments/shipmentStatus';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
  is_active: boolean;
};

type ShipmentRow = {
  id: string;
  shipment_no: string;
  branch_id?: string | null;
  status: string;
  destination_city?: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  username?: string;
  full_name?: string | null;
  branch_id?: string | null;
};

export default function BranchProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState<BranchRecord | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const [branchRows, shipmentRows, userRows] = await Promise.all([
          httpClient.get<BranchRecord[]>('/branches?includeInactive=true'),
          httpClient.get<ShipmentRow[]>('/shipments'),
          httpClient.get<UserRow[]>('/users').catch(() => []),
        ]);
        const found = branchRows.find((row) => row.id === id) || null;
        setBranch(found);
        setShipments(shipmentRows.filter((row) => row.branch_id === id));
        setUsers(userRows.filter((row) => row.branch_id === id));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل ملف الفرع.');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [id]);

  const outbound = useMemo(() => shipments.length, [shipments]);
  const inDelivery = useMemo(
    () => shipments.filter((row) => normalizeShipmentStatus(row.status) === 'OUT_FOR_DELIVERY').length,
    [shipments],
  );

  if (!loading && !branch) {
    return <div className="card text-sm text-red-700">الفرع غير موجود أو خارج نطاق الشركة.</div>;
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">ملف الفرع</h2>
          <p className="text-sm text-gray-600">عرض بيانات الفرع وربطها بالشحنات والمستخدمين</p>
        </div>
        <button type="button" className="toolbar-btn" onClick={() => navigate('/branches')}>عودة</button>
      </div>

      {error ? <div className="card text-sm text-red-700">{error}</div> : null}

      <section className="card">
        <div className="grid grid-cols-4 gap-3">
          <div><strong>الكود:</strong> {branch?.code || '-'}</div>
          <div><strong>الاسم:</strong> {branch?.name || '-'}</div>
          <div><strong>المدينة:</strong> {branch?.city || '-'}</div>
          <div><strong>الهاتف:</strong> {branch?.phone || '-'}</div>
          <div><strong>العنوان:</strong> {branch?.address || '-'}</div>
          <div><strong>الحالة:</strong> {branch?.is_active ? 'نشط' : 'معلق'}</div>
          <div><strong>الشحنات الصادرة:</strong> {outbound}</div>
          <div><strong>الشحنات قيد التسليم:</strong> {inDelivery}</div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" className="toolbar-btn" onClick={() => navigate(`/finance/debit-credit?branchId=${id}`)}>الدائن والمدين للفرع</button>
          <button type="button" className="toolbar-btn" onClick={() => navigate(`/finance/account-statement?branchId=${id}`)}>كشف الحساب للفرع</button>
        </div>
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">مستخدمو الفرع</h3>
        <div className="text-sm text-gray-700">{users.length ? users.map((user) => user.full_name || user.username || user.id).join('، ') : 'لا يوجد مستخدمون مرتبطون ظاهرياً.'}</div>
      </section>

      <section className="card flex-1 overflow-auto">
        <h3 className="font-semibold mb-2">أحدث شحنات الفرع</h3>
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th>
              <th>رقم الشحنة</th>
              <th>الوجهة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {shipments.slice(0, 10).map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.shipment_no}</td>
                <td>{row.destination_city || '-'}</td>
                <td>{row.status}</td>
                <td>{new Date(row.created_at).toLocaleString('ar-SY')}</td>
              </tr>
            ))}
            {!loading && shipments.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-6 text-gray-500">لا توجد شحنات مرتبطة بهذا الفرع حالياً.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
