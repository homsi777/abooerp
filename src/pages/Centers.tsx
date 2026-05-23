import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBackendIdFromSynthetic, phase15Gateway } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import { formatCurrency } from '../lib/currency/currency';
import { normalizeShipmentStatus } from '../lib/shipments/shipmentStatus';
import type { City, Shipment } from '../types';
import { SHIPMENT_STATUS_LABELS } from '../types';
import { useToast } from '../components/Toast';

type AgentRecord = {
  id: string;
  code: string;
  name: string;
  governorate?: string | null;
  branch_id?: string | null;
  is_active: boolean;
};

type CenterReceiptRecord = {
  id: string;
  shipment_id: string;
  branch_id?: string | null;
  agent_id?: string | null;
  center_name: string;
  status: 'received' | 'cancelled';
  received_at: string;
  notes?: string | null;
};

const SYRIAN_GOVERNORATES = [
  'دمشق',
  'ريف دمشق',
  'حلب',
  'حمص',
  'حماة',
  'اللاذقية',
  'طرطوس',
  'إدلب',
  'دير الزور',
  'الحسكة',
  'الرقة',
  'درعا',
  'السويداء',
  'القنيطرة',
  'القامشلي',
];

/** شحنات ما زالت ضمن مسار التشغيل (قبل التسليم النهائي / الإغلاق) — تشمل الحالات الكنسية والقديمة. */
const CENTER_PIPELINE_TERMINAL = new Set([
  'DELIVERED',
  'FINANCIALLY_CLOSED',
  'CANCELLED',
  'RETURNED',
  'UNKNOWN',
]);

function normalizeArabic(value: string) {
  return value
    .trim()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function resolveLocationCenter(raw: string | undefined, cities: City[]): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return 'غير محدد';
  const normalized = normalizeArabic(trimmed);
  const city = cities.find((item) => normalizeArabic(item.name) === normalized);
  // أسماء المدن في البذرة تطابق المحافظة التشغيلية — لا نستخدم region (مثل «شمال سوريا») لئلا تختفي الأعداد عن أسماء المحافظات.
  if (city) return city.name;

  const governorate = SYRIAN_GOVERNORATES.find((item) => {
    const normalizedGovernorate = normalizeArabic(item);
    return normalized === normalizedGovernorate || normalized.includes(normalizedGovernorate);
  });

  return governorate || trimmed || 'غير محدد';
}

function isOpenForCentersPipeline(status: Shipment['status']): boolean {
  const n = normalizeShipmentStatus(status);
  return !CENTER_PIPELINE_TERMINAL.has(n);
}

export default function Centers() {
  const { showToast } = useToast();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [centerReceipts, setCenterReceipts] = useState<CenterReceiptRecord[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedCenter, setSelectedCenter] = useState(SYRIAN_GOVERNORATES[0]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [confirmShipment, setConfirmShipment] = useState<Shipment | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [shipmentRows, receiptRows, cityRows] = await Promise.all([
        phase15Gateway.shipments.getAll(),
        httpClient.get<CenterReceiptRecord[]>('/center-receipts'),
        phase15Gateway.cities.getAll(),
      ]);
      setShipments(shipmentRows);
      setCenterReceipts(receiptRows);
      setCities(cityRows);

      try {
        const agentRows = await httpClient.get<AgentRecord[]>('/agents?includeInactive=false');
        setAgents(agentRows);
      } catch {
        setAgents([]);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل بيانات المراكز', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const receiptByShipmentId = useMemo(() => {
    const map = new Map<string, CenterReceiptRecord>();
    centerReceipts.forEach((receipt) => {
      const previous = map.get(receipt.shipment_id);
      if (!previous || receipt.received_at > previous.received_at) map.set(receipt.shipment_id, receipt);
    });
    return map;
  }, [centerReceipts]);

  const openShipments = useMemo(
    () => shipments.filter((shipment) => isOpenForCentersPipeline(shipment.status)),
    [shipments],
  );

  const centerCards = useMemo(() => {
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();
    openShipments.forEach((shipment) => {
      const dest = resolveLocationCenter(shipment.destinationName, cities);
      inbound.set(dest, (inbound.get(dest) || 0) + 1);
      const origin = resolveLocationCenter(shipment.originName, cities);
      if (origin !== 'غير محدد') {
        outbound.set(origin, (outbound.get(origin) || 0) + 1);
      }
    });

    const nameSet = new Set<string>([...SYRIAN_GOVERNORATES, ...inbound.keys(), ...outbound.keys()]);
    const rows = Array.from(nameSet).map((name) => {
      const inC = inbound.get(name) || 0;
      const outC = outbound.get(name) || 0;
      return { name, inbound: inC, outbound: outC, total: inC + outC };
    });

    return rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar'));
  }, [cities, openShipments]);

  const selectedShipments = useMemo(
    () => openShipments.filter((shipment) => resolveLocationCenter(shipment.destinationName, cities) === selectedCenter),
    [cities, openShipments, selectedCenter],
  );

  const centerAgents = useMemo(
    () => agents.filter((agent) => normalizeArabic(agent.governorate || '') === normalizeArabic(selectedCenter)),
    [agents, selectedCenter],
  );

  const completeCenterReceive = async (shipment: Shipment) => {
    setProcessingId(shipment.id);
    try {
      const shipmentBackendId = getBackendIdFromSynthetic(shipment.id);
      if (!shipmentBackendId) {
        throw new Error('تعذر تحديد معرف الشحنة الخلفي. حدث الصفحة وحاول مجدداً.');
      }

      if (receiptByShipmentId.get(shipmentBackendId)) {
        showToast('تم تسجيل استلام هذه الشحنة في المركز مسبقاً.', 'success');
        setConfirmShipment(null);
        await loadData();
        return;
      }

      await httpClient.post<CenterReceiptRecord>('/center-receipts', {
        shipmentId: shipmentBackendId,
        branchId: shipment.branchId ? getBackendIdFromSynthetic(shipment.branchId) : undefined,
        centerName: selectedCenter,
        notes: `Center received shipment ${shipment.shipmentNo}`,
      });

      showToast('تم تثبيت استلام الشحنة في المركز. التسليم المالي النهائي يتم من قسم التسليم.', 'success');
      setConfirmShipment(null);
      await loadData();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Duplicate')) {
        showToast('تم تسجيل استلام هذه الشحنة مسبقاً. تم تحديث البيانات.', 'success');
        await loadData();
      } else {
        showToast(error instanceof Error ? error.message : 'تعذر تثبيت استلام المركز', 'error');
      }
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="centers-page" dir="rtl">
      <div className="centers-header">
        <div>
          <p className="centers-eyebrow">المراكز</p>
          <h2>استلام شحنات المحافظات</h2>
        </div>
        <button className="toolbar-btn" onClick={() => void loadData()} disabled={loading}>
          تحديث
        </button>
      </div>

      <div className="centers-layout">
        <aside className="centers-sidebar">
          {centerCards.map((center) => (
            <button
              key={center.name}
              className={center.name === selectedCenter ? 'active' : ''}
              onClick={() => setSelectedCenter(center.name)}
            >
              <span>{center.name}</span>
              <strong title="وارد إلى المحافظة / صادر من المحافظة">
                {center.inbound}/{center.outbound}
              </strong>
            </button>
          ))}
        </aside>

        <main className="centers-workspace">
          <section className="centers-summary">
            <div>
              <span>المحافظة</span>
              <strong>{selectedCenter}</strong>
            </div>
            <div>
              <span>الشحنات المرحلة</span>
              <strong>{selectedShipments.length}</strong>
            </div>
            <div>
              <span>الوكلاء النشطون</span>
              <strong>{centerAgents.length}</strong>
            </div>
            <div>
              <span>الإجمالي المفتوح</span>
              <strong>
                {formatCurrency(
                  selectedShipments.reduce((sum, shipment) => sum + Number(shipment.total || 0), 0),
                  'USD',
                )}
              </strong>
            </div>
          </section>

          {centerAgents.length > 0 && (
            <section className="centers-agents">
              {centerAgents.map((agent) => (
                <span key={agent.id}>
                  {agent.code} - {agent.name}
                </span>
              ))}
            </section>
          )}

          <div className="card overflow-auto">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>رقم الشحنة</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>الوجهة</th>
                  <th>الحالة</th>
                  <th>المبلغ</th>
                  <th>إجراء المركز</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7}>جاري تحميل البيانات...</td>
                  </tr>
                )}
                {!loading && selectedShipments.length === 0 && (
                  <tr>
                    <td colSpan={7}>لا توجد شحنات مفتوحة لهذه المحافظة حالياً.</td>
                  </tr>
                )}
                {!loading &&
                  selectedShipments.map((shipment) => {
                    const shipmentBackendId = getBackendIdFromSynthetic(shipment.id);
                    const receipt = shipmentBackendId ? receiptByShipmentId.get(shipmentBackendId) : undefined;
                    const disabled = processingId === shipment.id;
                    return (
                      <tr key={shipment.id}>
                        <td>{shipment.shipmentNo}</td>
                        <td>{shipment.senderName}</td>
                        <td>{shipment.receiverName}</td>
                        <td>{shipment.destinationName}</td>
                        <td>
                          <span className="status-badge bg-blue-100">
                            {SHIPMENT_STATUS_LABELS[shipment.status]}
                          </span>
                        </td>
                        <td className="text-left">{formatCurrency(shipment.total || 0, shipment.currency || 'USD')}</td>
                        <td>
                          {!receipt && (
                            <button
                              className="toolbar-btn primary"
                              onClick={() => setConfirmShipment(shipment)}
                              disabled={disabled}
                            >
                              استلام مركز
                            </button>
                          )}
                          {receipt && <span className="status-badge bg-green-100">مستلم في المركز</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {confirmShipment && (
        <div className="quick-ledger-confirm">
          <div className="quick-ledger-confirm-panel">
            <h3>تأكيد استلام المركز</h3>
            <p>
              هذا الإجراء يثبت وصول الشحنة إلى مركز المحافظة فقط. لا يتم إنشاء سند قبض هنا؛ سند القبض وحركة الصندوق
              يتمان عند التسليم النهائي للزبون من قسم التسليم.
            </p>
            <div>
              <button className="danger" onClick={() => void completeCenterReceive(confirmShipment)} disabled={processingId !== null}>
                تأكيد استلام المركز
              </button>
              <button onClick={() => setConfirmShipment(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
