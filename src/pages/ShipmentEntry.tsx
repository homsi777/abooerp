import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBackendIdFromSynthetic, phase15Gateway } from '../lib/api/phase15Gateway';
import { useAuth } from '../context/AuthProvider';
import { Shipment, ShipmentStatus, Branch, City, GoodsType, Customer, Vehicle, Driver } from '../types';
import { useToast } from '../components/Toast';
import AutocompleteInput from '../components/AutocompleteInput';
import SmartPartyInput from '../components/SmartPartyInput';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, parseDecimalAmount, type CurrencyCode } from '../lib/currency/currency';
import { CANONICAL_SHIPMENT_STATUSES, normalizeShipmentStatus, shipmentStatusLabelAr } from '../lib/shipments/shipmentStatus';

const STATUS_OPTIONS: ShipmentStatus[] = [...CANONICAL_SHIPMENT_STATUSES];
type SuggestedAgent = { id: number; name: string; code: string; branchId?: number; city?: string | null; area?: string | null; governorate?: string | null };

function formatVehicleOption(vehicle: Vehicle): string {
  const vehicleName = [vehicle.type, vehicle.model].filter(Boolean).join(' ');
  return vehicleName ? `${vehicleName} - ${vehicle.plateNumber}` : vehicle.plateNumber;
}

export default function ShipmentEntry() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { activeBranchId: sessionBranchUuid, user } = useAuth();
  const rates = getExchangeRatesToUsd();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [dynamicDestinations, setDynamicDestinations] = useState<Array<{ id: number; name: string }>>([]);
  const [dynamicOrigins, setDynamicOrigins] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<{ id: string; statusLabel: string; changedAt: string; changedBy: string; note: string; source: string }>>([]);
  const [suggestedAgents, setSuggestedAgents] = useState<SuggestedAgent[]>([]);
  const [agentSuggestionMessage, setAgentSuggestionMessage] = useState('');
  const [financialCard, setFinancialCard] = useState<{
    shipmentNo?: string;
    financialStatus: string;
    paymentStatus: string | null;
    totalCharge: number;
    paidAmount: number;
    remainingAmount: number;
    currency: string;
    payerNameSnapshot: string | null;
    payerPartyKind: string | null;
    financialResponsibilityType: string | null;
    financialResponsibilityId: string | null;
    defaultCashboxId: string | null;
    movements: unknown[];
    receiptVouchers: unknown[];
  } | null>(null);

  const [formData, setFormData] = useState<Partial<Shipment>>({
    shipmentNo: '',
    date: new Date().toISOString().split('T')[0],
    branchId: 1,
    branchName: 'دمشق',
    agentId: undefined,
    originName: '',
    status: 'DRAFT',
    senderId: 0,
    senderName: '',
    senderPhone: '',
    receiverId: 0,
    receiverName: '',
    receiverPhone: '',
    destinationId: 0,
    destinationName: '',
    goodsTypeId: 0,
    goodsTypeName: '',
    quantity: undefined,
    weight: undefined,
    volume: undefined,
    freightCharge: undefined,
    transferFee: undefined,
    additionalCharges: undefined,
    discount: undefined,
    total: 0,
    currency: 'USD',
    paymentMethod: 'cash',
    deliveryType: 'door',
    notes: '',
  });

  useEffect(() => {
    void loadData();
    if (id) void loadShipment(Number(id));
  }, [id]);

  useEffect(() => {
    if (id || !branches.length) return;
    const uuid = sessionBranchUuid ?? user?.branchId;
    if (!uuid) return;
    const match = branches.find((b) => getBackendIdFromSynthetic(b.id) === uuid);
    if (!match) return;
    setFormData((prev) =>
      prev.branchId === match.id && prev.branchName === match.name
        ? prev
        : { ...prev, branchId: match.id, branchName: match.name },
    );
  }, [id, branches, sessionBranchUuid, user?.branchId]);

  const loadData = async () => {
    const [branchesData, citiesData, goodsTypesData, customersData, vehiclesData, driversData] = await Promise.all([
      phase15Gateway.branches.getAll(),
      phase15Gateway.cities.getAll(),
      phase15Gateway.goodsTypes.getAll(),
      phase15Gateway.sendersReceivers.getAll(),
      phase15Gateway.vehicles.getAll(),
      phase15Gateway.drivers.getAll(),
    ]);
    setBranches(branchesData);
    setCities(citiesData);
    setGoodsTypes(goodsTypesData);
    setCustomers(customersData);
    setVehicles(vehiclesData);
    setDrivers(driversData);

    const authBranchUuid = sessionBranchUuid ?? user?.branchId ?? null;
    const branchFromSession =
      authBranchUuid && branchesData.length
        ? branchesData.find((b) => getBackendIdFromSynthetic(b.id) === authBranchUuid)
        : undefined;
    const preferred = branchFromSession ?? branchesData[0];

    if (!id && preferred) {
      setFormData((prev) => ({ ...prev, branchId: preferred.id, branchName: preferred.name }));
    } else if (!branchesData.find((b) => b.id === formData.branchId) && preferred) {
      setFormData((prev) => ({ ...prev, branchId: preferred.id, branchName: preferred.name }));
    }
  };

  const loadShipment = async (shipmentId: number) => {
    setLoading(true);
    try {
      const [shipment, history] = await Promise.all([
        phase15Gateway.shipments.getById(shipmentId),
        phase15Gateway.shipments.statusHistory(shipmentId).catch(() => []),
      ]);
      if (shipment) setFormData(shipment);
      try {
        const card = await phase15Gateway.shipments.getFinancialCard(shipmentId);
        setFinancialCard(card);
      } catch {
        setFinancialCard(null);
      }
      setStatusHistory(
        history.map((h: any) => ({
          id: h.id,
          statusLabel: h.statusLabel,
          changedAt: h.changedAt,
          changedBy: h.changedBy || '-',
          note: h.note || '',
          source: h.source || '',
        })),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const total = (formData.freightCharge || 0) + (formData.transferFee || 0) + (formData.additionalCharges || 0) - (formData.discount || 0);
    setFormData((prev) => ({ ...prev, total }));
  }, [formData.freightCharge, formData.transferFee, formData.additionalCharges, formData.discount]);

  useEffect(() => {
    const destination = String(formData.destinationName || '').trim();
    if (!destination) {
      setSuggestedAgents([]);
      setAgentSuggestionMessage('');
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      phase15Gateway.agents.lookupByDestination(destination, typeof formData.branchId === 'number' ? formData.branchId : undefined)
        .then((agents) => {
          if (cancelled) return;
          setSuggestedAgents(agents);
          if (agents.length === 1) {
            setFormData((prev) => ({ ...prev, agentId: agents[0].id, agentName: agents[0].name }));
            setAgentSuggestionMessage('تم اختيار الوكيل المطابق لهذه الوجهة تلقائياً.');
          } else if (agents.length > 1) {
            setAgentSuggestionMessage('يوجد أكثر من وكيل لهذه الوجهة، اختر الوكيل المناسب.');
          } else {
            setAgentSuggestionMessage('لا يوجد وكيل مرتبط بهذه الوجهة حالياً.');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestedAgents([]);
            setAgentSuggestionMessage('تعذر جلب وكلاء الوجهة حالياً.');
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [formData.destinationName, formData.branchId]);

  const handleSenderChange = (senderId: number) => {
    const sender = customers.find((c) => c.id === senderId);
    if (sender) setFormData((prev) => ({ ...prev, senderId: sender.id, senderName: sender.name, senderPhone: sender.phone }));
  };

  const handleReceiverChange = (receiverId: number) => {
    const receiver = customers.find((c) => c.id === receiverId);
    if (receiver) setFormData((prev) => ({ ...prev, receiverId: receiver.id, receiverName: receiver.name, receiverPhone: receiver.phone }));
  };

  const handleDestinationChange = (destinationId: number) => {
    const city = cities.find((c) => c.id === destinationId);
    if (city) setFormData((prev) => ({ ...prev, destinationId: city.id, destinationName: city.name }));
  };

  const destinationItems = [
    ...cities.map((c) => ({ id: c.id, name: c.name })),
    ...dynamicDestinations,
  ];

  const originItems = [
    ...branches.map((b) => ({ id: b.id, name: b.name })),
    ...cities.map((c) => ({ id: 1000000 + c.id, name: c.name })),
    ...dynamicOrigins,
  ];

  const addDynamicDestination = (name: string) => {
    const value = name.trim();
    if (!value) return;
    const exists = destinationItems.some((item) => item.name.toLowerCase() === value.toLowerCase());
    if (!exists) {
      setDynamicDestinations((prev) => [...prev, { id: Date.now(), name: value }]);
    }
    setFormData((prev) => ({ ...prev, destinationName: value, destinationId: 0 }));
  };

  const addDynamicOrigin = (name: string) => {
    const value = name.trim();
    if (!value) return;
    const matchedBranch = branches.find((b) => b.name.toLowerCase() === value.toLowerCase());
    const exists = originItems.some((item) => item.name.toLowerCase() === value.toLowerCase());
    if (!exists) {
      setDynamicOrigins((prev) => [...prev, { id: Date.now(), name: value }]);
    }
    setFormData((prev) => ({
      ...prev,
      originName: value,
      branchId: matchedBranch?.id ?? prev.branchId,
      branchName: matchedBranch?.name ?? prev.branchName,
    }));
  };

  const handleAddGoodsType = async (name: string) => {
    const value = name.trim();
    if (!value) return;
    const existing = goodsTypes.find((g) => g.name.toLowerCase() === value.toLowerCase());
    if (existing) {
      setFormData((prev) => ({ ...prev, goodsTypeId: existing.id, goodsTypeName: existing.name }));
      return;
    }
    try {
      const created = await phase15Gateway.goodsTypes.create({
        code: `GT-${Date.now()}`,
        name: value,
        description: '',
      });
      setGoodsTypes((prev) => [...prev, created]);
      setFormData((prev) => ({ ...prev, goodsTypeId: created.id, goodsTypeName: created.name }));
      showToast('تمت إضافة نوع طرد جديد', 'success');
    } catch {
      setFormData((prev) => ({ ...prev, goodsTypeId: 0, goodsTypeName: value }));
      showToast('تم حفظ النوع كنص حر', 'success');
    }
  };

  const handleGoodsTypeChange = (goodsTypeId: number) => {
    const goodsType = goodsTypes.find((g) => g.id === goodsTypeId);
    if (goodsType) setFormData((prev) => ({ ...prev, goodsTypeId: goodsType.id, goodsTypeName: goodsType.name }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (id) {
        await phase15Gateway.shipments.update(Number(id), formData);
        showToast('تم حفظ الشحنة بنجاح', 'success');
      } else {
        const newShipment = await phase15Gateway.shipments.create(formData);
        showToast('تم إنشاء الشحنة بنجاح', 'success');
        navigate(`/shipment-entry/${newShipment.id}`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'حدث خطأ أثناء الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!formData.shipmentNo) {
      showToast('يجب حفظ الشحنة أولا للطباعة', 'error');
      return;
    }
    window.print();
  };

  const handleNew = () => {
    navigate('/shipment-entry');
    const authBranchUuid = sessionBranchUuid ?? user?.branchId ?? null;
    const branchFromSession =
      authBranchUuid && branches.length
        ? branches.find((b) => getBackendIdFromSynthetic(b.id) === authBranchUuid)
        : undefined;
    const preferred = branchFromSession ?? branches[0];
    setFormData({
      shipmentNo: '',
      date: new Date().toISOString().split('T')[0],
      branchId: preferred?.id || 1,
      branchName: preferred?.name || '',
      originName: '',
      status: 'DRAFT',
      senderId: 0,
      senderName: '',
      senderPhone: '',
      receiverId: 0,
      receiverName: '',
      receiverPhone: '',
      destinationId: 0,
      destinationName: '',
      goodsTypeId: 0,
      goodsTypeName: '',
      quantity: undefined,
      weight: undefined,
      volume: undefined,
      freightCharge: undefined,
      transferFee: undefined,
      additionalCharges: undefined,
      discount: undefined,
      total: 0,
      currency: 'USD',
      paymentMethod: 'cash',
      deliveryType: 'door',
      notes: '',
    });
    setStatusHistory([]);
    setFinancialCard(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64">جاري التحميل...</div>;

  const normalizedStatus = normalizeShipmentStatus(formData.status || 'UNKNOWN');
  const isTerminalLocked = normalizedStatus === 'FINANCIALLY_CLOSED' || normalizedStatus === 'CANCELLED';
  const isOperationalLocked =
    normalizedStatus !== 'UNKNOWN' &&
    ['CONFIRMED', 'READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'AGENT_RECEIVED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED', 'FINANCIALLY_CLOSED', 'CANCELLED'].includes(normalizedStatus);
  const shouldLockCritical = isTerminalLocked || isOperationalLocked;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">إدخال شحنة</h2>
        <div className="flex gap-2">
          <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
          <button onClick={() => void handleSave()} disabled={saving} className="toolbar-btn success">{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
          <button onClick={handlePrint} className="toolbar-btn">طباعة</button>
        </div>
      </div>

      {shouldLockCritical && (
        <div className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          لا يمكن تعديل هذه الشحنة بعد دخولها مرحلة تشغيلية متقدمة.
        </div>
      )}

      {id && financialCard && (
        <div className="card mb-4" dir="rtl">
          <div className="card-header font-semibold">الأثر المالي للشحنة</div>
          {financialCard.financialStatus === 'UNPOSTED' && (
            <div className="mx-2 mt-2 mb-1 p-2 bg-red-50 border border-red-300 rounded text-sm text-red-800">
              ⚠️ الشحنة مؤكدة لكن لا يوجد أثر مالي. يجب إعادة الترحيل أو مراجعة النظام.
            </div>
          )}
          {/* Legacy warning: old postings were wrongly assigned to sender/receiver */}
          {(financialCard.movements as any[])?.some?.((m: any) => m.party_type === 'sender_receiver' && m.movement_type === 'shipment_charge') && (
            <div className="mx-2 mt-2 mb-1 p-2 bg-amber-50 border border-amber-400 rounded text-sm text-amber-800">
              ⚠️ هذه الشحنة مرحلة على مستلم/مرسل وفق نموذج قديم. تحتاج مراجعة أو إعادة تصنيف.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm p-2">
            <div>
              <span className="text-gray-600">المسؤول المالي:</span>{' '}
              {(() => {
                const rt = (financialCard as any).financialResponsibilityType;
                const pk = (financialCard as any).payerPartyKind;
                if (rt === 'AGENT' || pk === 'AGENT') return 'وكيل';
                if (rt === 'ACCOUNT_CUSTOMER' || pk === 'CUSTOMER') return 'عميل حسابي';
                if (rt === 'COMPANY_CASH') return 'مدفوعة مباشرة (صندوق)';
                if (rt === 'FREE') return 'بدون أجرة';
                if (pk === 'RECEIVER' || pk === 'SENDER') return 'مرسل/مستلم (قديم)';
                return '—';
              })()}
            </div>
            <div><span className="text-gray-600">اسم المسؤول:</span> {financialCard.payerNameSnapshot || '—'}</div>
            <div><span className="text-gray-600">أجرة الشحن:</span> {financialCard.totalCharge} {financialCard.currency}</div>
            <div><span className="text-gray-600">المدفوع:</span> {financialCard.paidAmount}</div>
            <div><span className="text-gray-600">المتبقي:</span> {financialCard.remainingAmount}</div>
            <div><span className="text-gray-600">الترحيل المالي:</span> {
              financialCard.financialStatus === 'UNPOSTED' ? 'غير مرحلة مالياً' :
              financialCard.financialStatus === 'POSTED' ? 'مرحلة مالياً ✓' :
              financialCard.financialStatus === 'PAID' ? 'مدفوعة ✓' :
              financialCard.financialStatus === 'PARTIALLY_PAID' ? 'مدفوعة جزئياً' :
              financialCard.financialStatus
            }</div>
            <div><span className="text-gray-600">حالة الدفع:</span> {
              financialCard.paymentStatus === 'PAID' ? 'مدفوعة' :
              financialCard.paymentStatus === 'PARTIAL' ? 'مدفوعة جزئياً' :
              financialCard.paymentStatus === 'UNPAID' ? 'غير مدفوعة' :
              financialCard.paymentStatus || '—'
            }</div>
            <div>
              <span className="text-gray-600">آخر سند قبض:</span>{' '}
              {(financialCard.receiptVouchers?.[0] as any)?.voucher_no ?? '—'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-2 pb-2">
            <button type="button" className="toolbar-btn text-sm" onClick={() => navigate('/finance/account-statement')}>
              فتح كشف الحساب التفصيلي
            </button>
            <button type="button" className="toolbar-btn text-sm" onClick={() => navigate('/finance/debit-credit')}>
              مركز الدائن والمدين
            </button>
            {financialCard.financialStatus === 'UNPOSTED' && (
              <button
                type="button"
                className="toolbar-btn text-sm bg-amber-50 border-amber-400 text-amber-800"
                onClick={async () => {
                  try {
                    const result = await phase15Gateway.shipments.repostFinancials(Number(id));
                    showToast(result.message || 'تمت إعادة الترحيل المالي', 'success');
                    const card = await phase15Gateway.shipments.getFinancialCard(Number(id));
                    setFinancialCard(card);
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : 'فشلت إعادة الترحيل المالي', 'error');
                  }
                }}
              >
                إعادة ترحيل الأثر المالي
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <fieldset disabled={shouldLockCritical} className="contents">
          <div className="card mb-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="form-group">
                <label className="form-label">رقم الشحنة</label>
                <input type="text" className="form-input w-full bg-gray-100" value={formData.shipmentNo || ''} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">التاريخ</label>
                <input type="text" className="form-input w-full" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
              </div>
              <div className="form-group">
                <AutocompleteInput
                  id="field-origin"
                  value={formData.originName || formData.branchName || ''}
                  onChange={(value) => setFormData({ ...formData, originName: value })}
                  onSelect={(item) => addDynamicOrigin(item.name)}
                  onAddNew={addDynamicOrigin}
                  items={originItems}
                  placeholder="اكتب المصدر (فرع/مركز/وكيل)..."
                  label="المصدر"
                  nextFieldId="field-status"
                />
              </div>
              <div className="form-group">
                <label className="form-label">الحالة</label>
                <select id="field-status" className="form-select w-full" value={formData.status || 'DRAFT'} onChange={(e) => setFormData({ ...formData, status: e.target.value as ShipmentStatus })}>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{shipmentStatusLabelAr(status)}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="card">
              <div className="card-header">المرسل</div>
              <div className="space-y-3">
                <SmartPartyInput
                  id="field-sender"
                  value={formData.senderName || ''}
                  onChange={(value) => setFormData({ ...formData, senderName: value })}
                  onSelect={(party) => {
                    if (party.source_table === 'senders_receivers') {
                      const local = customers.find((c) => c.name === party.name);
                      if (local) handleSenderChange(local.id);
                    }
                    setFormData((prev) => ({ ...prev, senderName: party.name, senderPhone: prev.senderPhone || party.phone || '' }));
                  }}
                  onAddNew={(name) => setFormData((prev) => ({ ...prev, senderName: name }))}
                  placeholder="اختر أو اكتب اسم المرسل..."
                  label="اختر المرسل"
                  nextFieldId="field-sender-phone"
                />
                <input id="field-sender-phone" type="text" className="form-input w-full" placeholder="هاتف المرسل" value={formData.senderPhone || ''} onChange={(e) => setFormData({ ...formData, senderPhone: e.target.value })} />
                <p className="text-xs text-gray-400">الزبون السريع يستخدم كمرسل/مستلم فقط. العميل الحسابي يمكن ربطه بالذمم المالية عند الحاجة.</p>
              </div>
            </div>

            <div className="card">
              <div className="card-header">المستلم</div>
              <div className="space-y-3">
                <SmartPartyInput
                  id="field-receiver"
                  value={formData.receiverName || ''}
                  onChange={(value) => setFormData({ ...formData, receiverName: value })}
                  onSelect={(party) => {
                    if (party.source_table === 'senders_receivers') {
                      const local = customers.find((c) => c.name === party.name);
                      if (local) handleReceiverChange(local.id);
                    }
                    setFormData((prev) => ({ ...prev, receiverName: party.name, receiverPhone: prev.receiverPhone || party.phone || '' }));
                  }}
                  onAddNew={(name) => setFormData((prev) => ({ ...prev, receiverName: name }))}
                  placeholder="اختر أو اكتب اسم المستلم..."
                  label="اختر المستلم"
                  nextFieldId="field-receiver-phone"
                />
                <input id="field-receiver-phone" type="text" className="form-input w-full" placeholder="هاتف المستلم" value={formData.receiverPhone || ''} onChange={(e) => setFormData({ ...formData, receiverPhone: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="card mb-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="form-group">
                <AutocompleteInput
                  id="field-destination"
                  value={formData.destinationName || ''}
                  onChange={(value) => setFormData({ ...formData, destinationName: value })}
                  onSelect={(item) => setFormData({ ...formData, destinationId: item.id, destinationName: item.name })}
                  onAddNew={addDynamicDestination}
                  items={destinationItems}
                  placeholder="اكتب الجهة (مدينة/مركز/وكيل)..."
                  label="الجهة"
                  nextFieldId="field-goods-type"
                />
              </div>
              <div className="form-group">
                <label className="form-label">الوكيل المقترح</label>
                <select
                  className="form-select w-full"
                  value={formData.agentId || ''}
                  onChange={(e) => {
                    const agentId = e.target.value ? Number(e.target.value) : undefined;
                    const agent = suggestedAgents.find((item) => item.id === agentId);
                    setFormData({ ...formData, agentId, agentName: agent?.name });
                  }}
                >
                  <option value="">بدون وكيل محدد</option>
                  {suggestedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.code} - {agent.name}
                    </option>
                  ))}
                </select>
                {agentSuggestionMessage && (
                  <div className={`mt-1 text-xs ${suggestedAgents.length ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {agentSuggestionMessage}
                  </div>
                )}
              </div>
              <div className="form-group">
                <AutocompleteInput
                  id="field-goods-type"
                  value={formData.goodsTypeName || ''}
                  onChange={(value) => setFormData({ ...formData, goodsTypeName: value })}
                  onSelect={(item) => handleGoodsTypeChange(item.id)}
                  onAddNew={(name) => void handleAddGoodsType(name)}
                  items={goodsTypes.map((g) => ({ id: g.id, name: g.name }))}
                  placeholder="اكتب نوع الطرد..."
                  label="نوع الطرود"
                  nextFieldId="field-quantity"
                />
              </div>
              <div className="form-group"><label className="form-label">الكمية</label><input id="field-quantity" type="number" step="0.01" className="form-input w-full" value={formData.quantity ?? ''} onChange={(e) => setFormData({ ...formData, quantity: e.target.value === '' ? undefined : parseFloat(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">الوزن (كغ)</label><input type="number" step="0.01" className="form-input w-full" value={formData.weight ?? ''} onChange={(e) => setFormData({ ...formData, weight: e.target.value === '' ? undefined : parseFloat(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">الحجم</label><input type="number" step="0.01" className="form-input w-full" value={formData.volume ?? ''} onChange={(e) => setFormData({ ...formData, volume: e.target.value === '' ? undefined : parseFloat(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">مبلغ الشحن</label><input type="number" step="0.01" className="form-input w-full" value={formData.freightCharge ?? ''} onChange={(e) => setFormData({ ...formData, freightCharge: e.target.value === '' ? undefined : parseDecimalAmount(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">تحصيل (COD)</label><input type="number" step="0.01" className="form-input w-full" value={formData.transferFee ?? ''} onChange={(e) => setFormData({ ...formData, transferFee: e.target.value === '' ? undefined : parseDecimalAmount(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">رسوم إضافية</label><input type="number" step="0.01" className="form-input w-full" value={formData.additionalCharges ?? ''} onChange={(e) => setFormData({ ...formData, additionalCharges: e.target.value === '' ? undefined : parseDecimalAmount(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">الخصم</label><input type="number" step="0.01" className="form-input w-full" value={formData.discount ?? ''} onChange={(e) => setFormData({ ...formData, discount: e.target.value === '' ? undefined : parseDecimalAmount(e.target.value) })} /></div>
              <div className="form-group"><label className="form-label">المجموع</label><input type="text" className="form-input w-full bg-gray-200 font-bold" value={formatCurrency(formData.total || 0, (formData.currency || 'USD') as CurrencyCode)} readOnly /></div>
              <div className="form-group"><label className="form-label">العملة</label><select className="form-select w-full" value={(formData.currency || 'USD') as CurrencyCode} onChange={(e) => setFormData({ ...formData, currency: e.target.value as CurrencyCode })}><option value="USD">USD</option><option value="SYP">SYP</option><option value="TRY">TRY</option></select></div>
              <div className="form-group"><label className="form-label">المكافئ بالدولار</label><input type="text" className="form-input w-full bg-gray-100" value={formatCurrency(convertToUsd(formData.total || 0, (formData.currency || 'USD') as CurrencyCode, rates), 'USD')} readOnly /></div>
              <div className="form-group"><label className="form-label">طريقة الدفع</label><select className="form-select w-full" value={formData.paymentMethod || 'cash'} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as any })}><option value="cash">نقدي</option><option value="credit">آجل</option><option value="prepaid">مدفوع مسبقا</option></select></div>
              <div className="form-group"><label className="form-label">نوع التسليم</label><select className="form-select w-full" value={formData.deliveryType || 'door'} onChange={(e) => setFormData({ ...formData, deliveryType: e.target.value as any })}><option value="door">باب إلى باب</option><option value="branch">من الفرع</option></select></div>
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-header">المركبة والسائق</div>
            <div className="grid grid-cols-4 gap-4">
              <div className="form-group"><label className="form-label">المركبة</label><select className="form-select w-full" value={formData.vehicleId || ''} onChange={(e) => setFormData({ ...formData, vehicleId: Number(e.target.value) })}><option value="">اختر...</option>{vehicles.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{formatVehicleOption(v)}</option>)}</select></div>
              <div className="form-group"><label className="form-label">السائق</label><select className="form-select w-full" value={formData.driverId || ''} onChange={(e) => setFormData({ ...formData, driverId: Number(e.target.value) })}><option value="">اختر...</option>{drivers.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            </div>
          </div>
        </fieldset>

        <div className="card">
          <div className="card-header">ملاحظات</div>
          <textarea className="form-input w-full" rows={3} value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} disabled={isTerminalLocked} />
        </div>

        {id && (
          <div className="card mt-4">
            <div className="card-header">سجل تتبع الحالة</div>
            {statusHistory.length === 0 ? (
              <div className="text-sm text-gray-500 p-3">لا يوجد سجل حالة متاح.</div>
            ) : (
              <div className="space-y-2 p-3">
                {statusHistory.map((entry) => (
                  <div key={entry.id} className="border border-gray-200 rounded px-3 py-2 text-sm">
                    <div className="font-semibold">{entry.statusLabel}</div>
                    <div className="text-gray-600">{new Date(entry.changedAt).toLocaleString('ar-SY')}</div>
                    <div className="text-gray-600">المستخدم: {entry.changedBy || '-'}</div>
                    {entry.note && <div className="text-gray-700">ملاحظة: {entry.note}</div>}
                    {entry.source && <div className="text-xs text-gray-500">المصدر: {entry.source}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
