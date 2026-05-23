import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { useEffect, useState, useCallback } from 'react';
import type { Shipment } from '../../types';
import {
  normalizeShipmentStatus,
  shipmentStatusLabelAr,
  SHIPMENT_STATUS_META,
  type CanonicalShipmentStatus,
} from '../../lib/shipments/shipmentStatus';
import { useToast } from '../../components/Toast';

const TAB_GROUPS: Record<
  string,
  { title: string; statuses: Set<CanonicalShipmentStatus> }
> = {
  pending: {
    title: 'شحنات بانتظار التسليم',
    statuses: new Set<CanonicalShipmentStatus>([
      'HANDED_TO_AGENT',
      'AGENT_RECEIVED',
      'IN_TRANSIT',
      'ARRIVED_AT_DESTINATION',
    ]),
  },
  out: {
    title: 'شحنات خارجة للتسليم',
    statuses: new Set<CanonicalShipmentStatus>(['OUT_FOR_DELIVERY']),
  },
  done: {
    title: 'شحنات مسلمة',
    statuses: new Set<CanonicalShipmentStatus>(['DELIVERED', 'FINANCIALLY_CLOSED']),
  },
  returns: {
    title: 'شحنات مرتجعة',
    statuses: new Set<CanonicalShipmentStatus>(['RETURN_REQUESTED', 'RETURNED']),
  },
};

export default function AgentDeliveryQueues() {
  const { tab } = useParams<{ tab: string }>();
  const activeTab = tab && TAB_GROUPS[tab] ? tab : 'pending';
  const config = TAB_GROUPS[activeTab];
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.shipments.getAll();
      setRows(data);
    } catch {
      showToast('تعذر تحميل الشحنات', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((s) => {
      const n = normalizeShipmentStatus(s.status);
      return n !== 'UNKNOWN' && config.statuses.has(n);
    });
  }, [rows, config]);

  const actionLabel: Record<string, string> = {
    'agent-received': 'تأكيد استلام',
    'mark-in-transit': 'في الطريق',
    arrived: 'وصلت',
    'out-for-delivery': 'خارجة للتسليم',
    deliver: 'تم التسليم',
    'request-return': 'مرتجع',
    'mark-returned': 'تأكيد الإرجاع',
  };

  function actionsFor(status: string) {
    const normalized = normalizeShipmentStatus(status);
    if (normalized === 'UNKNOWN') return [] as Array<{ key: string }>;
    return SHIPMENT_STATUS_META[normalized].next
      .map((s) => {
        if (s === 'AGENT_RECEIVED') return { key: 'agent-received' };
        if (s === 'IN_TRANSIT') return { key: 'mark-in-transit' };
        if (s === 'ARRIVED_AT_DESTINATION') return { key: 'arrived' };
        if (s === 'OUT_FOR_DELIVERY') return { key: 'out-for-delivery' };
        if (s === 'DELIVERED') return { key: 'deliver' };
        if (s === 'RETURN_REQUESTED') return { key: 'request-return' };
        if (s === 'RETURNED') return { key: 'mark-returned' };
        return null;
      })
      .filter(Boolean) as Array<{ key: string }>;
  }

  const runAction = async (shipmentId: number, action: string) => {
    try {
      if (action === 'agent-received') await phase15Gateway.shipments.confirmAgentReceived(shipmentId);
      else if (action === 'mark-in-transit') await phase15Gateway.shipments.markShipmentInTransit(shipmentId);
      else if (action === 'arrived') await phase15Gateway.shipments.markShipmentArrived(shipmentId);
      else if (action === 'out-for-delivery') await phase15Gateway.shipments.markShipmentOutForDelivery(shipmentId);
      else if (action === 'deliver') await phase15Gateway.shipments.deliverShipment(shipmentId);
      else if (action === 'request-return') await phase15Gateway.shipments.requestShipmentReturn(shipmentId);
      else if (action === 'mark-returned') await phase15Gateway.shipments.markShipmentReturned(shipmentId);
      showToast('تم تنفيذ الإجراء', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تنفيذ الإجراء', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap gap-2 mb-3">
        {Object.keys(TAB_GROUPS).map((k) => (
          <Link
            key={k}
            to={`/delivery-queue/${k}`}
            className={`toolbar-btn no-underline ${activeTab === k ? 'ring-2 ring-indigo-400' : ''}`}
          >
            {TAB_GROUPS[k].title}
          </Link>
        ))}
      </div>
      <h2 className="text-xl font-bold mb-2">{config.title}</h2>
      {loading ? <div className="text-gray-500 text-sm">جاري التحميل...</div> : null}
      <div className="card flex-1 overflow-auto">
        <table className="data-grid">
          <thead>
            <tr>
              <th>رقم الشحنة</th>
              <th>التاريخ</th>
              <th>المرسل</th>
              <th>المستلم</th>
              <th>الوجهة</th>
              <th>الحالة</th>
              <th>المبلغ</th>
              <th>العملة</th>
              <th>آخر تحديث</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const st = normalizeShipmentStatus(row.status);
              const acts = actionsFor(row.status);
              return (
                <tr key={row.id}>
                  <td>{row.shipmentNo}</td>
                  <td>{row.date}</td>
                  <td>{row.senderName}</td>
                  <td>{row.receiverName}</td>
                  <td>{row.destinationName}</td>
                  <td>{shipmentStatusLabelAr(st)}</td>
                  <td>{Number(row.total || 0).toLocaleString()}</td>
                  <td>{row.currency}</td>
                  <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('ar-SY') : '—'}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {acts.map((a) => (
                        <button
                          key={a.key}
                          type="button"
                          className="toolbar-btn text-xs"
                          onClick={() => void runAction(row.id, a.key)}
                        >
                          {actionLabel[a.key] ?? a.key}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center p-6 text-gray-500">
                  لا توجد شحنات ضمن نطاق هذا الوكيل حالياً في هذه القائمة.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
