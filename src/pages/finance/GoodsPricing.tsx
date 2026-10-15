import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';
import SmartPartyInput, { type SelectedParty } from '../../components/SmartPartyInput';
import { goodsShippingPricesGateway, type GoodsShippingPriceRow } from '../../lib/api/goodsShippingPricesGateway';

interface AgentRow {
  governorate: string | null;
  is_active: boolean;
}

/** الفرع الرئيسي (حلب) ليس له وكيل منفصل — يُدار عبر "صندوق رئيسي" مباشرة،
 * لذا يُضاف هنا يدوياً لأنه ليس له إشارة "وكيل نشط" مثل بقية الوجهات. */
const ALWAYS_ACTIVE_DESTINATIONS = ['حلب'];

const inputStyle: React.CSSProperties = {
  minHeight: '44px',
  fontSize: '16px',
  padding: '8px 14px',
  borderRadius: '10px',
  border: '1px solid #cbd5e1',
  width: '100%',
  boxSizing: 'border-box',
  background: '#f8fafc',
};

const labelStyle: React.CSSProperties = { fontSize: '13.5px', fontWeight: 700, color: '#374151', marginBottom: '6px', display: 'block' };

const disabledInputStyle: React.CSSProperties = { background: '#f1f5f9', color: '#9ca3af', cursor: 'not-allowed' };

export default function GoodsPricing() {
  const { showToast } = useToast();

  const [goodsName, setGoodsName] = useState('');
  const [origin, setOrigin] = useState('حلب');
  const [destination, setDestination] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [parcelCount, setParcelCount] = useState('');
  const [unitPriceUsd, setUnitPriceUsd] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [rows, setRows] = useState<GoodsShippingPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await goodsShippingPricesGateway.list());
    } catch {
      showToast('تعذر تحميل الأسعار', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void httpClient.get<AgentRow[]>('/agents').then((agents) => {
      const cities = Array.from(
        new Set([
          ...ALWAYS_ACTIVE_DESTINATIONS,
          ...agents
            .filter((a) => a.is_active && a.governorate && a.governorate.trim())
            .map((a) => a.governorate!.trim()),
        ]),
      ).sort((a, b) => a.localeCompare(b, 'ar'));
      setDestinations(cities);
    }).catch(() => setDestinations([]));
  }, []);

  const resetForm = (keepFocusField = true) => {
    setGoodsName('');
    setWeightKg('');
    setParcelCount('');
    setUnitPriceUsd('');
    setCustomerName('');
    setCustomerConfirmed(false);
    if (!keepFocusField) {
      setDestination('');
      setOrigin('حلب');
    }
  };

  const validate = (): boolean => {
    setError('');
    if (!goodsName.trim()) {
      setError('اكتبي اسم البضاعة.');
      return false;
    }
    if (!origin.trim()) {
      setError('اختاري المصدر.');
      return false;
    }
    if (!destination.trim()) {
      setError('اختاري الوجهة.');
      return false;
    }
    if (!unitPriceUsd.trim() || Number.isNaN(Number(unitPriceUsd)) || Number(unitPriceUsd) < 0) {
      setError('أدخلي سعراً صحيحاً.');
      return false;
    }
    if (customerName.trim() && !customerConfirmed) {
      setError('اسم الزبون غير موجود في النظام — اختاريه من قائمة الاقتراحات أو اتركي الحقل فارغاً.');
      return false;
    }
    return true;
  };

  const save = async (): Promise<boolean> => {
    if (!validate()) return false;
    setSaving(true);
    try {
      const created = await goodsShippingPricesGateway.create({
        goodsName: goodsName.trim(),
        origin: origin.trim(),
        destination: destination.trim(),
        weightKg: weightKg.trim() ? Number(weightKg) : null,
        parcelCount: parcelCount.trim() ? Number(parcelCount) : null,
        unitPriceUsd: Number(unitPriceUsd),
        customerName: customerName.trim() || null,
      });
      setRows((prev) => [created, ...prev]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndAddAnother = async () => {
    const ok = await save();
    if (ok) {
      resetForm(true);
      showToast('تم الحفظ', 'success');
    }
  };

  const saveAndExit = async () => {
    const ok = await save();
    if (ok) {
      resetForm(false);
      showToast('تم الحفظ', 'success');
    }
  };

  const removeRow = async (id: string) => {
    try {
      await goodsShippingPricesGateway.remove(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch {
      showToast('تعذر الحذف', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', paddingBottom: '32px' }}>
      <div>
        <Link to="/finance" style={{ fontSize: '14px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
          ← الذمم والمالية
        </Link>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '8px 0 4px' }}>📦 تسعير البضائع</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) 1fr', gap: '18px', alignItems: 'start' }}>
        {/* ───── Right: add new price ───── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#111827' }}>إضافة سعر شحن جديد</h2>
            <span style={{ fontSize: '20px' }}>⊕</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={labelStyle}>اسم البضاعة</label>
              <input style={inputStyle} value={goodsName} onChange={(e) => setGoodsName(e.target.value)} autoFocus />
            </div>

            <div>
              <label style={labelStyle}>المصدر (من أين تُحمَّل)</label>
              <select style={inputStyle} value={origin} onChange={(e) => setOrigin(e.target.value)}>
                <option value="">— اختر —</option>
                {destinations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>الوجهة (إلى أين تُشحن)</label>
              <select style={inputStyle} value={destination} onChange={(e) => setDestination(e.target.value)}>
                <option value="">— اختر —</option>
                {destinations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>الوزن (كغ)</label>
              <input
                style={{ ...inputStyle, ...(parcelCount.trim() ? disabledInputStyle : {}) }}
                value={weightKg}
                onChange={(e) => {
                  setWeightKg(e.target.value);
                  if (e.target.value.trim()) setParcelCount('');
                }}
                disabled={Boolean(parcelCount.trim())}
                inputMode="decimal"
                placeholder={parcelCount.trim() ? 'مُعطَّل — يوجد عدد طرود' : ''}
              />
            </div>

            <div>
              <label style={labelStyle}>عدد الطرود</label>
              <input
                style={{ ...inputStyle, ...(weightKg.trim() ? disabledInputStyle : {}) }}
                value={parcelCount}
                onChange={(e) => {
                  setParcelCount(e.target.value);
                  if (e.target.value.trim()) setWeightKg('');
                }}
                disabled={Boolean(weightKg.trim())}
                inputMode="numeric"
                placeholder={weightKg.trim() ? 'مُعطَّل — يوجد وزن' : ''}
              />
            </div>

            <div>
              <label style={labelStyle}>السعر ($)</label>
              <input
                style={{ ...inputStyle, fontWeight: 800 }}
                value={unitPriceUsd}
                onChange={(e) => setUnitPriceUsd(e.target.value)}
                inputMode="decimal"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveAndAddAnother();
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>الزبون/العميل (اختياري)</label>
              <SmartPartyInput
                value={customerName}
                onChange={(v) => {
                  setCustomerName(v);
                  setCustomerConfirmed(false);
                }}
                onSelect={(party: SelectedParty) => {
                  setCustomerName(party.name);
                  setCustomerConfirmed(true);
                }}
                allowAddNew={false}
                placeholder="اكتبي اسم الزبون..."
                inputClassName={
                  customerName.trim() && !customerConfirmed
                    ? 'goods-pricing-input goods-pricing-input-error'
                    : 'goods-pricing-input'
                }
              />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => void saveAndAddAnother()}
                disabled={saving}
                style={{
                  flex: 1,
                  minHeight: '46px',
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'جارٍ الحفظ...' : 'حفظ وإضافة آخر'}
              </button>
              <button
                type="button"
                onClick={() => void saveAndExit()}
                disabled={saving}
                style={{
                  flex: 1,
                  minHeight: '46px',
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                حفظ وخروج
              </button>
            </div>
          </div>
        </div>

        {/* ───── Left: saved list ───── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#111827' }}>الأسعار المحفوظة</h2>
            <span style={{ fontSize: '18px' }}>☰</span>
          </div>

          {loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '30px' }}>جاري التحميل...</p>
          ) : rows.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '30px' }}>لا توجد أسعار محفوظة بعد.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>الرقم</th>
                  <th style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>اسم البضاعة</th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>المصدر</th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>الوجهة</th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>الوزن (كغ)</th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>الطرود</th>
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>السعر ($)</th>
                  <th style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>الزبون</th>
                  <th style={{ padding: '9px 10px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#6b7280' }}>{rows.length - i}</td>
                    <td style={{ padding: '8px 10px' }}>{r.goods_name}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#6b7280' }}>{r.origin ?? '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>{r.destination}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>{r.weight_kg ?? '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>{r.parcel_count ?? '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#166534' }}>
                      {Number(r.unit_price_usd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{r.customer_name ?? '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => void removeRow(r.id)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '13px' }}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
