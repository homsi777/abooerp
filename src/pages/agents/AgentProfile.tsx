import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';

type AgentRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  governorate?: string | null;
  branch_id?: string | null;
  is_active: boolean;
};

type ShipmentRow = {
  id: string;
  shipment_no: string;
  destination_city?: string | null;
  status: string;
  created_at: string;
  agent_id?: string | null;
};

export default function AgentProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const [agentsRows, shipmentRows] = await Promise.all([
          httpClient.get<AgentRecord[]>('/agents?includeInactive=true'),
          httpClient.get<ShipmentRow[]>('/shipments'),
        ]);
        const found = agentsRows.find((row) => row.id === id) || null;
        setAgent(found);
        setShipments(shipmentRows.filter((row) => row.agent_id === id));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل ملف الوكيل.');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [id]);

  const shipmentPreview = useMemo(() => shipments.slice(0, 10), [shipments]);

  if (!loading && !agent) {
    return <div className="card text-sm text-red-700">الوكيل غير موجود أو ليس ضمن نطاق الشركة.</div>;
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">ملف الوكيل</h2>
          <p className="text-sm text-gray-600">عرض بيانات الوكيل وربطها بالشحنات والمالية</p>
        </div>
        <button type="button" className="toolbar-btn" onClick={() => navigate('/agents')}>عودة</button>
      </div>

      {error ? <div className="card text-sm text-red-700">{error}</div> : null}

      <section className="card">
        <div className="grid grid-cols-4 gap-3">
          <div><strong>الكود:</strong> {agent?.code || '-'}</div>
          <div><strong>الاسم:</strong> {agent?.name || '-'}</div>
          <div><strong>الهاتف:</strong> {agent?.phone || '-'}</div>
          <div><strong>المدينة/المنطقة:</strong> {agent?.governorate || '-'}</div>
          <div><strong>الحالة:</strong> {agent?.is_active ? 'نشط' : 'معلق'}</div>
          <div><strong>عدد الشحنات الحالية:</strong> {shipments.length}</div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" className="toolbar-btn" onClick={() => navigate(`/finance/account-statement?partyType=agent&partyId=${id}`)}>فتح كشف الحساب</button>
          <button type="button" className="toolbar-btn" onClick={() => navigate(`/finance/debit-credit?partyType=agent`)}>فتح الدائن والمدين</button>
        </div>
      </section>

      <section className="card flex-1 overflow-auto">
        <h3 className="font-semibold mb-2">شحنات الوكيل (أحدث 10)</h3>
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
            {shipmentPreview.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.shipment_no}</td>
                <td>{row.destination_city || '-'}</td>
                <td>{row.status}</td>
                <td>{new Date(row.created_at).toLocaleString('ar-SY')}</td>
              </tr>
            ))}
            {!loading && shipmentPreview.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-6 text-gray-500">لا توجد شحنات مرتبطة بهذا الوكيل حالياً.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
