import { useState, useEffect, useCallback } from 'react';
import { getBackendIdFromSynthetic, phase15Gateway } from '../lib/api/phase15Gateway';
import { phase3FinanceGateway } from '../lib/api/phase3FinanceGateway';
import type { Delivery, Shipment } from '../types';
import { useToast } from '../components/Toast';
import { useRealtimeRefresh } from '../lib/realtime/useRealtimeRefresh';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, parseDecimalAmount, type CurrencyCode } from '../lib/currency/currency';

export default function Delivery() {
  const rates = getExchangeRatesToUsd();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [deliveryVoucherStatus, setDeliveryVoucherStatus] = useState<Record<number, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Delivery>>({
    shipmentId: 0, shipmentNo: '', recipientName: '', recipientPhone: '', receivedAmount: 0, currency: 'USD', receivedAmountUsd: 0, deliveryStatus: 'pending', notes: ''
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [deliveriesData, shipmentsData] = await Promise.all([
        phase15Gateway.deliveries.getAll(),
        phase15Gateway.shipments.getAll(),
      ]);
      setDeliveries(deliveriesData);
      setShipments(shipmentsData.filter(s =>
        s.status === 'ready_delivery' ||
        s.status === 'arrived' ||
        s.status === 'loaded' ||
        s.status === 'in_transit' ||
        s.status === 'draft'
      ));

      const statusMap: Record<number, string> = {};
      await Promise.all(
        deliveriesData.map(async (delivery) => {
          const backendDeliveryId = getBackendIdFromSynthetic(delivery.id);
          if (!backendDeliveryId) return;
          const voucher = await phase3FinanceGateway.receiptVouchers.getByDeliveryId(backendDeliveryId);
          statusMap[delivery.id] = voucher ? `موجود (${voucher.voucherNo})` : 'غير مولد';
        }),
      );
      setDeliveryVoucherStatus(statusMap);
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeRefresh(['delivery.updated', 'shipment.updated'], () => void loadData());

  const handleNew = () => {
    setSelectedDelivery(null);
    setFormData({ shipmentId: 0, shipmentNo: '', recipientName: '', recipientPhone: '', receivedAmount: 0, currency: 'USD', receivedAmountUsd: 0, deliveryStatus: 'pending', notes: '' });
    setIsEditing(true);
  };

  const handleEdit = (delivery: Delivery) => {
    setSelectedDelivery(delivery);
    setFormData(delivery);
    setIsEditing(true);
  };

  const handleShipmentChange = (shipmentId: number) => {
    const shipment = shipments.find(s => s.id === shipmentId);
    if (shipment) {
      const currency = (shipment.currency || 'USD') as CurrencyCode;
      const receivedAmount = shipment.total || 0;
      setFormData({
        ...formData,
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        recipientName: shipment.receiverName,
        recipientPhone: shipment.receiverPhone,
        receivedAmount,
        currency,
        receivedAmountUsd: convertToUsd(receivedAmount, currency, rates),
      });
    }
  };

  const handleSave = async () => {
    try {
      if (selectedDelivery) {
        await phase15Gateway.deliveries.update(selectedDelivery.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.deliveries.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadData();
      setIsEditing(false);
    } catch { showToast('حدث خطأ', 'error'); }
  };

  const handleGenerateVoucher = async () => {
    if (!selectedDelivery) return;
    const backendDeliveryId = getBackendIdFromSynthetic(selectedDelivery.id);
    if (!backendDeliveryId) {
      showToast('تعذر تحديد معرف التسليم الخلفي', 'error');
      return;
    }
    try {
      await phase3FinanceGateway.receiptVouchers.autoGenerateFromDelivery(backendDeliveryId);
      showToast('تم توليد سند قبض مرتبط بالتسليم', 'success');
      await loadData();
    } catch (error: any) {
      showToast(error?.message || 'تعذر توليد السند (قد يكون موجودًا مسبقًا)', 'error');
    }
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    delivered: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    refused: 'bg-orange-100 text-orange-800',
  };

  const statusLabels: Record<string, string> = {
    pending: 'بانتظار التسليم', delivered: 'مسلّم', failed: 'فشل التسليم', refused: 'رفض الاستلام'
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">التسليم</h2>
        <button onClick={loadData} className="toolbar-btn">تحميل</button>
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
                <th>رقم الشحنة</th>
                <th>اسم المستلم</th>
                <th>الهاتف</th>
                <th>المبلغ الأصلي</th>
                <th>المبلغ USD</th>
                <th>حالة التسليم</th>
                <th>الأثر المالي</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className={selectedDelivery?.id === d.id ? 'selected' : ''} onClick={() => handleEdit(d)}>
                  <td>{d.shipmentNo}</td>
                  <td>{d.recipientName}</td>
                  <td>{d.recipientPhone}</td>
                  <td className="text-left">{formatCurrency(d.receivedAmount, (d.currency || 'USD') as CurrencyCode)}</td>
                  <td className="text-left">{formatCurrency(d.receivedAmountUsd || convertToUsd(d.receivedAmount, (d.currency || 'USD') as CurrencyCode, rates), 'USD')}</td>
                  <td><span className={`status-badge ${statusColors[d.deliveryStatus]}`}>{statusLabels[d.deliveryStatus]}</span></td>
                  <td>{deliveryVoucherStatus[d.id] || '-'}</td>
                  <td>{d.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">{selectedDelivery ? 'تعديل تسليم' : 'تسليم جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">اختر الشحنة</label>
                <select className="form-select w-full" value={formData.shipmentId || ''} onChange={(e) => handleShipmentChange(Number(e.target.value))}>
                  <option value="">اختر...</option>
                  {shipments.map(s => <option key={s.id} value={s.id}>{s.shipmentNo} - {s.receiverName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">اسم المستلم</label>
                <input type="text" className="form-input w-full" value={formData.recipientName || ''} onChange={(e) => setFormData({...formData, recipientName: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">هاتف المستلم</label>
                <input type="text" className="form-input w-full" value={formData.recipientPhone || ''} onChange={(e) => setFormData({...formData, recipientPhone: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">المبلغ المستلم</label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input w-full"
                  value={formData.receivedAmount || 0}
                  onChange={(e) => {
                    const amount = parseDecimalAmount(e.target.value);
                    const currency = (formData.currency || 'USD') as CurrencyCode;
                    setFormData({ ...formData, receivedAmount: amount, receivedAmountUsd: convertToUsd(amount, currency, rates) });
                  }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">العملة</label>
                <select
                  className="form-select w-full"
                  value={(formData.currency || 'USD') as CurrencyCode}
                  onChange={(e) => {
                    const currency = e.target.value as CurrencyCode;
                    const amount = formData.receivedAmount || 0;
                    setFormData({ ...formData, currency, receivedAmountUsd: convertToUsd(amount, currency, rates) });
                  }}
                >
                  <option value="USD">USD</option>
                  <option value="SYP">SYP</option>
                  <option value="TRY">TRY</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المكافئ بالدولار</label>
                <input
                  type="text"
                  className="form-input w-full bg-gray-100"
                  value={formatCurrency(formData.receivedAmountUsd || convertToUsd(formData.receivedAmount || 0, (formData.currency || 'USD') as CurrencyCode, rates), 'USD')}
                  readOnly
                />
              </div>
              <div className="form-group">
                <label className="form-label">حالة التسليم</label>
                <select className="form-select w-full" value={formData.deliveryStatus || 'pending'} onChange={(e) => setFormData({...formData, deliveryStatus: e.target.value as any})}>
                  <option value="pending">بانتظار التسليم</option>
                  <option value="delivered">مسلّم</option>
                  <option value="failed">فشل التسليم</option>
                  <option value="refused">رفض الاستلام</option>
                </select>
              </div>
              {formData.deliveryStatus === 'failed' && (
                <div className="form-group">
                  <label className="form-label">سبب الفشل</label>
                  <input type="text" className="form-input w-full" value={formData.failureReason || ''} onChange={(e) => setFormData({...formData, failureReason: e.target.value})} />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea className="form-input w-full" rows={2} value={formData.notes || ''} onChange={(e) => setFormData({...formData, notes: e.target.value})} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
                {selectedDelivery?.deliveryStatus === 'delivered' && (
                  <button onClick={handleGenerateVoucher} className="toolbar-btn">
                    توليد سند قبض
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
