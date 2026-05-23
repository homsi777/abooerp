import { useState, useEffect, useCallback, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { Shipment } from '../types';
import { useRealtimeRefresh } from '../lib/realtime/useRealtimeRefresh';
import {
  CANONICAL_SHIPMENT_STATUSES,
  normalizeShipmentStatus,
  SHIPMENT_STATUS_META,
  shipmentStatusColorClass,
  shipmentStatusLabelAr,
  type CanonicalShipmentStatus,
} from '../lib/shipments/shipmentStatus';
import { useToast } from '../components/Toast';

export default function ShipmentList() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [loadDialogShipment, setLoadDialogShipment] = useState<Shipment | null>(null);
  const [loadQuantity, setLoadQuantity] = useState('1');
  const [bulkLoadMode, setBulkLoadMode] = useState(false);
  const [bulkLoadSelection, setBulkLoadSelection] = useState<number[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [filters, setFilters] = useState({
    search: '',
    status: '',
    destination: '',
    dateFrom: '',
    dateTo: '',
  });

  const loadShipments = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const data = await phase15Gateway.shipments.getAll();
      setShipments(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل الشحنات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShipments();
  }, [loadShipments]);

  useRealtimeRefresh(['shipment.created', 'shipment.updated', 'shipment.deleted'], () => void loadShipments());

  const filteredShipments = shipments.filter((s) => {
    if (filters.search && !s.shipmentNo.includes(filters.search) && !s.senderName.includes(filters.search) && !s.receiverName.includes(filters.search)) return false;
    if (filters.status && normalizeShipmentStatus(s.status) !== filters.status) return false;
    if (filters.destination && s.destinationName !== filters.destination) return false;
    if (filters.dateFrom && s.date < filters.dateFrom) return false;
    if (filters.dateTo && s.date > filters.dateTo) return false;
    return true;
  });

  const handleRowClick = (shipment: Shipment) => {
    navigate(`/shipment-entry/${shipment.id}`);
  };

  const statusCounts = shipments.reduce((acc, s) => {
    const normalized = normalizeShipmentStatus(s.status);
    if (normalized !== 'UNKNOWN') {
      acc[normalized] = (acc[normalized] || 0) + 1;
    }
    return acc;
  }, {} as Record<CanonicalShipmentStatus, number>);

  const actionLabel: Record<string, string> = {
    confirm: 'تأكيد',
    'mark-ready': 'جاهزة للاستلام',
    'handover-driver': 'تحميل',
    'handover-agent': 'تسليم للوكيل',
    'agent-received': 'تأكيد استلام الوكيل',
    'mark-in-transit': 'في الطريق',
    arrived: 'وصلت',
    'out-for-delivery': 'خارجة للتسليم',
    deliver: 'تسليم للعميل',
    'request-return': 'طلب إرجاع',
    'mark-returned': 'تأكيد الإرجاع',
    cancel: 'إلغاء',
  };

  function actionsFor(status: string) {
    const normalized = normalizeShipmentStatus(status);
    if (normalized === 'UNKNOWN') return [] as Array<{ key: string; target: CanonicalShipmentStatus }>;
    return SHIPMENT_STATUS_META[normalized].next
      .map((s) => {
        if (s === 'CONFIRMED') return { key: 'confirm', target: s };
        if (s === 'READY_FOR_PICKUP') return { key: 'mark-ready', target: s };
        if (s === 'HANDED_TO_DRIVER') return { key: 'handover-driver', target: s };
        if (s === 'HANDED_TO_AGENT') return { key: 'handover-agent', target: s };
        if (s === 'AGENT_RECEIVED') return { key: 'agent-received', target: s };
        if (s === 'IN_TRANSIT') return { key: 'mark-in-transit', target: s };
        if (s === 'ARRIVED_AT_DESTINATION') return { key: 'arrived', target: s };
        if (s === 'OUT_FOR_DELIVERY') return { key: 'out-for-delivery', target: s };
        if (s === 'DELIVERED') return { key: 'deliver', target: s };
        if (s === 'RETURN_REQUESTED') return { key: 'request-return', target: s };
        if (s === 'RETURNED') return { key: 'mark-returned', target: s };
        if (s === 'CANCELLED') return { key: 'cancel', target: s };
        return null;
      })
      .filter(Boolean) as Array<{ key: string; target: CanonicalShipmentStatus }>;
  }

  const formatQuantity = (shipment: Shipment) => {
    const total = Number(shipment.quantity || 0);
    const loaded = Number(shipment.loadedQuantity || 0);
    return loaded > 0 ? `${total}/${loaded}` : String(total);
  };

  const isLoadable = (shipment: Shipment) => actionsFor(shipment.status).some((action) => action.key === 'handover-driver');

  const visibleLoadableShipmentIds = filteredShipments.filter(isLoadable).map((shipment) => shipment.id);
  const allVisibleLoadableSelected =
    visibleLoadableShipmentIds.length > 0 && visibleLoadableShipmentIds.every((id) => bulkLoadSelection.includes(id));

  const toggleBulkLoadMode = () => {
    setBulkLoadMode((current) => {
      if (current) {
        setBulkLoadSelection([]);
      } else {
        setBulkLoadSelection(visibleLoadableShipmentIds);
      }
      return !current;
    });
  };

  const toggleBulkSelection = (shipmentId: number) => {
    setBulkLoadSelection((current) =>
      current.includes(shipmentId)
        ? current.filter((id) => id !== shipmentId)
        : [...current, shipmentId],
    );
  };

  const toggleAllVisibleLoadable = () => {
    setBulkLoadSelection((current) => {
      if (allVisibleLoadableSelected) {
        return current.filter((id) => !visibleLoadableShipmentIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleLoadableShipmentIds]));
    });
  };

  const openLoadDialog = (shipment: Shipment) => {
    const total = Math.max(1, Number(shipment.quantity || 1));
    const currentLoaded = Number(shipment.loadedQuantity || 0);
    setLoadQuantity(String(currentLoaded > 0 ? currentLoaded : total));
    setLoadDialogShipment(shipment);
  };

  const openLoadDialogFromRow = (event: SyntheticEvent, shipment: Shipment) => {
    event.preventDefault();
    event.stopPropagation();
    openLoadDialog(shipment);
  };

  const confirmLoad = async () => {
    if (!loadDialogShipment) return;

    const total = Number(loadDialogShipment.quantity || 0);
    const quantity = Number(loadQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > total) {
      const msg = `يجب أن تكون كمية التحميل بين 1 و ${total}`;
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    setActionLoading(loadDialogShipment.id);
    setErrorMessage('');
    try {
      await phase15Gateway.shipments.handoverShipmentToDriver(loadDialogShipment.id, {
        note: `تحميل ${quantity} من ${total} طرد`,
        metadata: {
          loadedPiecesCount: quantity,
          totalPiecesCount: total,
        },
      });
      setShipments((current) =>
        current.map((shipment) =>
          shipment.id === loadDialogShipment.id
            ? { ...shipment, status: 'HANDED_TO_DRIVER', loadedQuantity: quantity }
            : shipment,
        ),
      );
      showToast('تم تحميل الشحنة بنجاح', 'success');
      setLoadDialogShipment(null);
      const refreshed = await phase15Gateway.shipments.getAll();
      setShipments((current) => {
        const localLoaded = current.find((shipment) => shipment.id === loadDialogShipment.id)?.loadedQuantity;
        return refreshed.map((shipment) =>
          shipment.id === loadDialogShipment.id && !shipment.loadedQuantity && localLoaded
            ? { ...shipment, loadedQuantity: localLoaded }
            : shipment,
        );
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'تعذر تنفيذ التحميل';
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const confirmBulkLoad = async () => {
    const selectedShipments = shipments.filter((shipment) => bulkLoadSelection.includes(shipment.id) && isLoadable(shipment));
    if (selectedShipments.length === 0) {
      const msg = 'حدد شحنة واحدة على الأقل قابلة للتحميل';
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    setBulkLoading(true);
    setErrorMessage('');
    try {
      for (const shipment of selectedShipments) {
        const total = Math.max(1, Number(shipment.quantity || 1));
        await phase15Gateway.shipments.handoverShipmentToDriver(shipment.id, {
          note: `تحميل جماعي ${total} من ${total} طرد`,
          metadata: {
            loadedPiecesCount: total,
            totalPiecesCount: total,
            bulkLoad: true,
          },
        });
      }
      showToast(`تم تحميل ${selectedShipments.length} شحنة بنجاح`, 'success');
      setBulkLoadSelection([]);
      setBulkLoadMode(false);
      await loadShipments();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'تعذر تنفيذ التحميل الجماعي';
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const runAction = async (shipmentId: number, action: string) => {
    setActionLoading(shipmentId);
    setErrorMessage('');
    try {
      if (action === 'confirm') await phase15Gateway.shipments.confirmShipment(shipmentId);
      else if (action === 'mark-ready') await phase15Gateway.shipments.markShipmentReady(shipmentId);
      else if (action === 'handover-driver') await phase15Gateway.shipments.handoverShipmentToDriver(shipmentId);
      else if (action === 'handover-agent') await phase15Gateway.shipments.handoverShipmentToAgent(shipmentId);
      else if (action === 'agent-received') await phase15Gateway.shipments.confirmAgentReceived(shipmentId);
      else if (action === 'mark-in-transit') await phase15Gateway.shipments.markShipmentInTransit(shipmentId);
      else if (action === 'arrived') await phase15Gateway.shipments.markShipmentArrived(shipmentId);
      else if (action === 'out-for-delivery') await phase15Gateway.shipments.markShipmentOutForDelivery(shipmentId);
      else if (action === 'deliver') await phase15Gateway.shipments.deliverShipment(shipmentId);
      else if (action === 'request-return') await phase15Gateway.shipments.requestShipmentReturn(shipmentId);
      else if (action === 'mark-returned') await phase15Gateway.shipments.markShipmentReturned(shipmentId);
      else if (action === 'cancel') await phase15Gateway.shipments.cancelShipment(shipmentId);
      showToast('تم تحديث حالة الشحنة بنجاح', 'success');
      await loadShipments();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء';
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">قائمة الشحنات</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleBulkLoadMode} className={bulkLoadMode ? 'btn-primary' : 'toolbar-btn'}>
            تحميل جماعي
          </button>
          <button onClick={loadShipments} className="toolbar-btn">تحديث</button>
        </div>
      </div>
      {errorMessage && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{errorMessage}</div>}

      {bulkLoadMode && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-sm text-indigo-800">
            الشحنات المحددة للتحميل الجماعي: <span className="font-semibold">{bulkLoadSelection.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="toolbar-btn" onClick={toggleAllVisibleLoadable}>
              {allVisibleLoadableSelected ? 'إلغاء تحديد الظاهر' : 'تحديد كل الظاهر'}
            </button>
            <button type="button" className="btn-primary" disabled={bulkLoading || bulkLoadSelection.length === 0} onClick={() => void confirmBulkLoad()}>
              {bulkLoading ? 'جاري التحميل...' : 'تحميل المحدد'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {CANONICAL_SHIPMENT_STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => setFilters({ ...filters, status: filters.status === status ? '' : status })}
            className={`px-3 py-1 rounded text-sm ${filters.status === status ? 'ring-2 ring-primary' : ''} ${shipmentStatusColorClass(status)}`}
          >
            {shipmentStatusLabelAr(status)}: {statusCounts[status] || 0}
          </button>
        ))}
      </div>

      <div className="card mb-4">
        <div className="flex gap-4 flex-wrap">
          <input
            type="text"
            placeholder="بحث برقم الشحنة أو الاسم..."
            className="form-input flex-1 min-w-[200px]"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
          <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
          <button onClick={() => setFilters({ search: '', status: '', destination: '', dateFrom: '', dateTo: '' })} className="toolbar-btn">مسح</button>
        </div>
      </div>

      <div className="flex-1 card overflow-auto">
        <table className="data-grid">
          <thead>
            <tr>
              {bulkLoadMode && <th>تحديد</th>}
              <th>رقم الشحنة</th>
              <th>التاريخ</th>
              <th>الفرع</th>
              <th>المرسل</th>
              <th>المستلم</th>
              <th>الوجهة</th>
              <th>عدد الطرود</th>
              <th>الوزن</th>
              <th>المجموع</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredShipments.map((shipment) => (
              <tr key={shipment.id} className="cursor-pointer" onClick={() => handleRowClick(shipment)}>
                {bulkLoadMode && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {isLoadable(shipment) ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={bulkLoadSelection.includes(shipment.id)}
                        disabled={bulkLoading}
                        onChange={() => toggleBulkSelection(shipment.id)}
                        aria-label={`تحديد الشحنة ${shipment.shipmentNo} للتحميل الجماعي`}
                      />
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                )}
                <td>{shipment.shipmentNo}</td>
                <td>{shipment.date}</td>
                <td>{shipment.branchName}</td>
                <td>{shipment.senderName}</td>
                <td>{shipment.receiverName}</td>
                <td>{shipment.destinationName}</td>
                <td className="text-left">{formatQuantity(shipment)}</td>
                <td className="text-left">{shipment.weight} كغ</td>
                <td className="text-left">{shipment.total.toLocaleString()}</td>
                <td>
                  <span className={`status-badge ${shipmentStatusColorClass(shipment.status)}`}>
                    {shipmentStatusLabelAr(shipment.status)}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1">
                    {isLoadable(shipment) && (
                      <button
                        type="button"
                        className="toolbar-btn primary text-xs px-2 py-1"
                        disabled={bulkLoading}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => openLoadDialogFromRow(event, shipment)}
                      >
                        تحميل
                      </button>
                    )}
                    {actionsFor(shipment.status)
                      .filter((action) => action.key !== 'handover-driver')
                      .slice(0, 2)
                      .map((action) => (
                      <button
                        type="button"
                        key={action.key}
                        className="toolbar-btn text-xs px-2 py-1"
                        disabled={actionLoading === shipment.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAction(shipment.id, action.key);
                        }}
                      >
                        {actionLabel[action.key]}
                      </button>
                    ))}
                    {actionsFor(shipment.status).length === 0 && <span className="text-xs text-gray-500">-</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="p-3 text-sm text-gray-500">جاري التحميل...</div>}
        <div className="p-2 text-sm text-gray-600 border-t">إجمالي السجلات: {filteredShipments.length}</div>
      </div>

      {loadDialogShipment && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          style={{ zIndex: 9999 }}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setLoadDialogShipment(null);
            }
          }}
        >
          <div className="card w-full max-w-md shadow-xl">
            <div className="mb-4">
              <h3 className="text-lg font-bold">تحميل الشحنة</h3>
              <p className="text-sm text-gray-600 mt-1">رقم الشحنة: {loadDialogShipment.shipmentNo}</p>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
                <span className="text-gray-600">عدد الطرود</span>
                <span className="font-semibold">{loadDialogShipment.quantity || 0}</span>
              </div>
              <label className="block">
                <span className="block text-sm font-medium mb-1">الكمية المراد تحميلها</span>
                <input
                  type="number"
                  min={1}
                  max={loadDialogShipment.quantity || 1}
                  className="form-input w-full text-left"
                  value={loadQuantity}
                  onChange={(e) => setLoadQuantity(e.target.value)}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                className="toolbar-btn"
                disabled={actionLoading === loadDialogShipment.id}
                onClick={() => setLoadDialogShipment(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={actionLoading === loadDialogShipment.id}
                onClick={() => void confirmLoad()}
              >
                {actionLoading === loadDialogShipment.id ? 'جاري التحميل...' : 'تحميل'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
