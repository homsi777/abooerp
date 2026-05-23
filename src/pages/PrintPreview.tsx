import { useEffect, useState } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { phase3FinanceGateway } from '../lib/api/phase3FinanceGateway';

type PrintTemplate = 'shipment' | 'manifest' | 'receipt' | 'customer-statement' | '80mm-receipt';

export default function PrintPreview() {
  const [selectedTemplate, setSelectedTemplate] = useState<PrintTemplate>('shipment');
  const [shipment, setShipment] = useState<any>({
    shipmentNo: '-',
    date: '-',
    branchName: '-',
    senderName: '-',
    senderPhone: '-',
    receiverName: '-',
    receiverPhone: '-',
    destinationName: '-',
    goodsTypeName: '-',
    quantity: 0,
    weight: 0,
    volume: 0,
    freightCharge: 0,
    transferFee: 0,
    total: 0,
    paymentMethod: 'cash',
    deliveryType: 'door',
    notes: '',
  });
  const [receipt, setReceipt] = useState<any>({
    voucherNo: '-',
    date: '-',
    customerName: '-',
    paymentMethod: 'cash',
    amount: 0,
    description: '-',
  });
  const [manifest, setManifest] = useState<any>({
    manifestNo: '-',
    date: '-',
    vehiclePlate: '-',
    driverName: '-',
    route: '-',
    totalShipments: 0,
    totalWeight: 0,
  });
  const [customer, setCustomer] = useState<any>({
    name: '-',
    code: '-',
    address: '-',
  });

  useEffect(() => {
    Promise.all([
      phase15Gateway.shipments.getAll(),
      phase3FinanceGateway.receiptVouchers.getAll(),
      phase15Gateway.manifests.getAll(),
      phase15Gateway.customers.getAll(),
    ])
      .then(([shipments, receipts, manifests, customers]) => {
        setShipment(shipments[0] ?? null);
        setReceipt(receipts[0] ?? null);
        setManifest(manifests[0] ?? null);
        setCustomer(customers[0] ?? null);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  const templates = [
    { id: 'shipment', label: 'إشعار شحنة A4' },
    { id: 'manifest', label: 'Manifest A4' },
    { id: 'receipt', label: 'سند قبض A4' },
    { id: 'customer-statement', label: 'كشف حساب عميل A4' },
    { id: '80mm-receipt', label: 'إيصال 80mm' },
  ];

  const noDataPlaceholder = (label: string) => (
    <div className="print-preview flex items-center justify-center min-h-64 text-gray-400 text-sm">
      لا توجد بيانات {label} — أضف سجلات أولاً ثم افتح معاينة الطباعة.
    </div>
  );

  const renderShipmentA4 = () => {
    if (!shipment) return noDataPlaceholder('شحنات');
    return (
      <div className="print-preview">
        <div className="print-header">
          <div className="print-title">شركة عبو المحمود لنقل والخدمات الوجستية — الفرع الرئيسي</div>
          <div className="print-subtitle">إشعار شحنة / بوليصة الشحن</div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div><strong>رقم الشحنة:</strong> {shipment.shipmentNo}</div>
            <div><strong>التاريخ:</strong> {shipment.date}</div>
            <div><strong>الفرع:</strong> {shipment.branchName}</div>
          </div>
          <div className="text-left">
            <div><strong>المرسل:</strong> {shipment.senderName}</div>
            <div><strong>الهاتف:</strong> {shipment.senderPhone}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div><strong>المستلم:</strong> {shipment.receiverName}</div>
            <div><strong>الهاتف:</strong> {shipment.receiverPhone}</div>
          </div>
          <div className="text-left">
            <div><strong>الوجهة:</strong> {shipment.destinationName}</div>
            <div><strong>نوع البضاعة:</strong> {shipment.goodsTypeName}</div>
          </div>
        </div>

        <table className="print-table mb-4">
          <thead>
            <tr>
              <th>الكمية</th>
              <th>الوزن</th>
              <th>الحجم</th>
              <th>رسوم الشحن</th>
              <th>تحصيل (COD)</th>
              <th>المجموع</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{shipment.quantity ?? 0}</td>
              <td>{shipment.weight ?? 0} كغ</td>
              <td>{shipment.volume ?? 0} م³</td>
              <td>{(shipment.freightCharge ?? 0).toLocaleString()}</td>
              <td>{(shipment.transferFee ?? 0).toLocaleString()}</td>
              <td className="font-bold">{(shipment.total ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><strong>طريقة الدفع:</strong> {shipment.paymentMethod === 'cash' ? 'نقدي' : shipment.paymentMethod === 'credit' ? 'آجل' : 'مدفوع مسبقاً'}</div>
          <div><strong>نوع التسليم:</strong> {shipment.deliveryType === 'door' ? 'باب إلى باب' : 'من الفرع'}</div>
        </div>

        {shipment.notes && <div className="mb-4 text-sm"><strong>ملاحظات:</strong> {shipment.notes}</div>}

        <div className="print-footer">
          <div>التوقيع: _______________</div>
          <div>الختم</div>
        </div>
      </div>
    );
  };

  const renderManifestA4 = () => {
    if (!manifest) return noDataPlaceholder('بيانات');
    return (
      <div className="print-preview">
        <div className="print-header">
          <div className="print-title">شركة عبو المحمود لنقل والخدمات الوجستية — الفرع الرئيسي</div>
          <div className="print-subtitle">بيان شحنات — Manifest</div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><strong>رقم البيان:</strong> {manifest.manifestNo}</div>
          <div><strong>التاريخ:</strong> {manifest.date}</div>
          <div><strong>المركبة:</strong> {manifest.vehiclePlate}</div>
          <div><strong>السائق:</strong> {manifest.driverName}</div>
          <div className="col-span-2"><strong>المسار:</strong> {manifest.route}</div>
        </div>

        <table className="print-table mb-4">
          <thead>
            <tr>
              <th>م</th><th>رقم الشحنة</th><th>المرسل</th>
              <th>المستلم</th><th>الوجهة</th><th>الوزن</th>
            </tr>
          </thead>
          <tbody>
            {shipment && (
              <tr>
                <td>1</td>
                <td>{shipment.shipmentNo}</td>
                <td>{shipment.senderName}</td>
                <td>{shipment.receiverName}</td>
                <td>{shipment.destinationName}</td>
                <td>{shipment.weight ?? 0}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="text-left font-bold">الإجمالي</td>
              <td className="font-bold">{manifest.totalShipments ?? 0}</td>
              <td className="font-bold">{manifest.totalWeight ?? 0}</td>
            </tr>
          </tfoot>
        </table>

        <div className="print-footer">
          <div>توقيع السائق: _______________</div>
          <div>توقيع المشرف: _______________</div>
        </div>
      </div>
    );
  };

  const renderReceiptA4 = () => {
    if (!receipt) return noDataPlaceholder('سندات قبض');
    return (
      <div className="print-preview">
        <div className="print-header">
          <div className="print-title">شركة عبو المحمود لنقل والخدمات الوجستية — الفرع الرئيسي</div>
          <div className="print-subtitle">سند قبض</div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><strong>رقم السند:</strong> {receipt.voucherNo}</div>
          <div><strong>التاريخ:</strong> {receipt.date}</div>
          <div><strong>اسم العميل:</strong> {receipt.customerName}</div>
          <div><strong>طريقة الدفع:</strong> {receipt.paymentMethod === 'cash' ? 'نقدي' : receipt.paymentMethod === 'transfer' ? 'تحويل' : 'شيك'}</div>
        </div>

        <div className="mb-4 text-sm">
          <strong>المبلغ:</strong> {(receipt.amount ?? 0).toLocaleString()} ل.س
        </div>

        <div className="mb-4 text-sm">
          <strong>والمبلغ كتابة:</strong> {(receipt.amount ?? 0).toLocaleString()} فقط لاغير
        </div>

        {receipt.description && (
          <div className="mb-4 text-sm">
            <strong>الوصف:</strong> {receipt.description}
          </div>
        )}

        <div className="print-footer">
          <div>توقيع المستلم: _______________</div>
          <div>الختم والتوقيع</div>
        </div>
      </div>
    );
  };

  const renderCustomerStatement = () => {
    if (!customer) return noDataPlaceholder('عملاء');
    return (
      <div className="print-preview">
        <div className="print-header">
          <div className="print-title">شركة عبو المحمود لنقل والخدمات الوجستية — الفرع الرئيسي</div>
          <div className="print-subtitle">كشف حساب عميل</div>
        </div>

        <div className="mb-4 text-sm">
          <div><strong>اسم العميل:</strong> {customer.name}</div>
          <div><strong>الكود:</strong> {customer.code}</div>
          <div><strong>العنوان:</strong> {customer.address ?? '—'}</div>
        </div>

        <table className="print-table mb-4">
          <thead>
            <tr>
              <th>التاريخ</th><th>رقم المستند</th><th>البيان</th>
              <th>مدين</th><th>دائن</th><th>الرصيد</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={6} className="text-center text-gray-400 py-4">لا حركات مالية مسجّلة لهذا العميل</td></tr>
          </tbody>
        </table>

        <div className="print-footer">
          <div>تاريخ الكشف: {new Date().toLocaleDateString('ar')}</div>
        </div>
      </div>
    );
  };

  const render80mm = () => {
    if (!shipment) return noDataPlaceholder('شحنات');
    return (
      <div className="print-preview-80mm">
        <div className="text-center border-b border-black pb-2 mb-2">
          <div className="font-bold">شركة عبو المحمود لنقل والخدمات الوجستية</div>
          <div className="text-sm">إيصال استلام</div>
        </div>

        <div className="text-sm mb-2">
          <div>رقم: {shipment.shipmentNo}</div>
          <div>التاريخ: {shipment.date}</div>
          <div>المرسل: {shipment.senderName}</div>
          <div>المستلم: {shipment.receiverName}</div>
          <div>الوجهة: {shipment.destinationName}</div>
        </div>

        <table className="w-full text-sm mb-2">
          <tbody>
            <tr><td>الكمية:</td><td>{shipment.quantity ?? 0}</td></tr>
            <tr><td>الوزن:</td><td>{shipment.weight ?? 0} كغ</td></tr>
            <tr><td>المجموع:</td><td>{(shipment.total ?? 0).toLocaleString()}</td></tr>
          </tbody>
        </table>

        <div className="text-center text-sm mt-4 pt-2 border-t border-black">
          شكراً لتعاملكم معنا
        </div>
      </div>
    );
  };

  const renderTemplate = () => {
    switch (selectedTemplate) {
      case 'shipment': return renderShipmentA4();
      case 'manifest': return renderManifestA4();
      case 'receipt': return renderReceiptA4();
      case 'customer-statement': return renderCustomerStatement();
      case '80mm-receipt': return render80mm();
      default: return null;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">معاينة الطباعة</h2>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        <div className="w-64 card overflow-auto">
          <div className="card-header">اختر النموذج</div>
          <div className="space-y-1">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTemplate(t.id as PrintTemplate)}
                className={`w-full text-right px-3 py-2 rounded ${selectedTemplate === t.id ? 'bg-primary text-white' : 'hover:bg-gray-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-gray-200 p-4">
          {renderTemplate()}
        </div>
      </div>
    </div>
  );
}
