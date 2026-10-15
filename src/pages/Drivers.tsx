import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { phase15Gateway, getBackendIdFromSynthetic } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import { Driver } from '../types';
import { useToast } from '../components/Toast';
import { driverAdvancesGateway, type DriverAdvanceSummary, type DriverReportEntry } from '../lib/api/driverAdvancesGateway';

interface AgentOption {
  id: string;
  name: string;
  governorate?: string | null;
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '2px solid #e5e7eb',
  borderRadius: '14px',
  padding: '18px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  textAlign: 'right',
};

const bigButtonStyle = (variant: 'primary' | 'default' | 'danger' = 'default'): React.CSSProperties => ({
  minHeight: '42px',
  padding: '8px 18px',
  fontSize: '14.5px',
  fontWeight: 700,
  borderRadius: '9px',
  border: variant === 'default' ? '1px solid #d1d5db' : 'none',
  background: variant === 'primary' ? '#4f46e5' : variant === 'danger' ? '#dc2626' : '#fff',
  color: variant === 'default' ? '#111827' : '#fff',
  cursor: 'pointer',
});

const inputStyle: React.CSSProperties = {
  minHeight: '40px',
  fontSize: '15px',
  padding: '7px 12px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  width: '100%',
  boxSizing: 'border-box',
};

export default function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [isEditingForm, setIsEditingForm] = useState(false);
  const [advancesDriver, setAdvancesDriver] = useState<Driver | null>(null);
  const [showReport, setShowReport] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Driver>>({
    code: '', name: '', phone: '', licenseNumber: '', licenseExpiry: '', address: '', isActive: true, tripWageUsd: 0,
  });

  useEffect(() => {
    void loadDrivers();
    void httpClient.get<AgentOption[]>('/agents').then(setAgents).catch(() => setAgents([]));
  }, []);

  const loadDrivers = async () => {
    setLoading(true);
    try {
      setDrivers(await phase15Gateway.drivers.getAll());
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setEditingDriver(null);
    setFormData({ code: '', name: '', phone: '', licenseNumber: '', licenseExpiry: '', address: '', isActive: true, tripWageUsd: 0 });
    setIsEditingForm(true);
  };

  const handleEditForm = (driver: Driver) => {
    setEditingDriver(driver);
    setFormData(driver);
    setIsEditingForm(true);
  };

  const handleSave = async () => {
    try {
      if (editingDriver) {
        await phase15Gateway.drivers.update(editingDriver.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.drivers.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadDrivers();
      setIsEditingForm(false);
    } catch {
      showToast('حدث خطأ', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: '16px' }}>
      <Link to="/finance" style={{ fontSize: '13.5px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
        ← الذمم والمالية
      </Link>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">🚚 السائقين</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowReport(true)} style={bigButtonStyle()}>📄 تقرير السائقين</button>
          <button onClick={handleNew} style={bigButtonStyle('primary')}>＋ سائق جديد</button>
          <button onClick={() => void loadDrivers()} style={bigButtonStyle()}>تحديث</button>
        </div>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>جاري التحميل...</p>
      ) : drivers.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>لا يوجد سائقون بعد.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
          {drivers.map((driver) => (
            <div key={driver.id} style={cardStyle} onClick={() => setAdvancesDriver(driver)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '17px', fontWeight: 800 }}>{driver.name}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    background: driver.isActive ? '#dcfce7' : '#f3f4f6',
                    color: driver.isActive ? '#166534' : '#6b7280',
                  }}
                >
                  {driver.isActive ? 'نشط' : 'غير نشط'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>كود: {driver.code} {driver.phone ? `· ${driver.phone}` : ''}</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#4f46e5' }}>
                أجرة السفرة: {driver.tripWageUsd ? `${driver.tripWageUsd}$` : 'غير محدَّدة'}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button
                  type="button"
                  style={{ ...bigButtonStyle(), flex: 1, fontSize: '13px', minHeight: '34px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditForm(driver);
                  }}
                >
                  تعديل البيانات
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isEditingForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: 'min(420px, 92vw)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>{editingDriver ? 'تعديل سائق' : 'سائق جديد'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>الكود</label>
                <input style={inputStyle} value={formData.code || ''} onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>الاسم</label>
                <input style={inputStyle} value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>الهاتف</label>
                <input style={inputStyle} value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>رقم الرخصة</label>
                <input style={inputStyle} value={formData.licenseNumber || ''} onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600 }}>العنوان</label>
                <input style={inputStyle} value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 700, color: '#4f46e5' }}>أجرة السفرة الثابتة ($)</label>
                <input
                  style={inputStyle}
                  value={formData.tripWageUsd ?? ''}
                  onChange={(e) => setFormData({ ...formData, tripWageUsd: e.target.value === '' ? null : Number(e.target.value) })}
                  inputMode="decimal"
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                <input type="checkbox" checked={formData.isActive || false} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
                نشط
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button onClick={() => void handleSave()} style={{ ...bigButtonStyle('primary'), flex: 1 }}>حفظ</button>
                <button onClick={() => setIsEditingForm(false)} style={bigButtonStyle()}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {advancesDriver && (
        <DriverAdvancesPanel
          driver={advancesDriver}
          agents={agents}
          onClose={() => setAdvancesDriver(null)}
          showToast={showToast}
        />
      )}

      {showReport && <DriverReportPanel drivers={drivers} onClose={() => setShowReport(false)} showToast={showToast} />}
    </div>
  );
}

function DriverReportPanel({
  drivers,
  onClose,
  showToast,
}: {
  drivers: Driver[];
  onClose: () => void;
  showToast: (msg: string, kind: 'success' | 'error') => void;
}) {
  const [driverId, setDriverId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [entries, setEntries] = useState<DriverReportEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const runReport = async () => {
    setLoading(true);
    try {
      const backendDriverId = driverId ? getBackendIdFromSynthetic(Number(driverId)) ?? undefined : undefined;
      const result = await driverAdvancesGateway.report({
        driverId: backendDriverId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      setEntries(result.entries);
    } catch {
      showToast('تعذر تحميل التقرير', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = (entries ?? []).reduce((sum, e) => sum + Number(e.amount_usd), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
      <div style={{ background: '#fff', borderRadius: '18px', padding: '24px', width: 'min(720px, 95vw)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '19px', fontWeight: 800 }}>📄 تقرير السائقين</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#9ca3af', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <select style={{ ...inputStyle, width: '220px' }} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">— جميع السائقين —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <div>
            <label style={{ fontSize: '12px', color: '#6b7280' }}>من تاريخ رحلة</label>
            <input type="date" style={{ ...inputStyle, width: '160px' }} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6b7280' }}>إلى تاريخ رحلة</label>
            <input type="date" style={{ ...inputStyle, width: '160px' }} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button onClick={() => void runReport()} style={{ ...bigButtonStyle('primary'), alignSelf: 'flex-end' }}>
            عرض التقرير
          </button>
        </div>

        {loading || !entries ? (
          <p style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>جاري التحميل...</p>
        ) : entries.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>لا توجد سجلات ضمن هذا الفلتر.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'right' }}>
                    <th style={{ padding: '8px' }}>السائق</th>
                    <th style={{ padding: '8px' }}>الوكيل</th>
                    <th style={{ padding: '8px' }}>المبلغ ($)</th>
                    <th style={{ padding: '8px' }}>تاريخ الرحلة</th>
                    <th style={{ padding: '8px' }}>تاريخ الاستلام</th>
                    <th style={{ padding: '8px' }}>ملاحظات</th>
                    <th style={{ padding: '8px' }}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{e.driver_name}</td>
                      <td style={{ padding: '8px' }}>{e.agent_name ?? 'بدون وكيل'}</td>
                      <td style={{ padding: '8px', color: '#b45309', fontWeight: 700 }}>{e.amount_usd}</td>
                      <td style={{ padding: '8px' }}>{e.trip_date ?? '—'}</td>
                      <td style={{ padding: '8px' }}>{e.received_date ?? '—'}</td>
                      <td style={{ padding: '8px', color: '#6b7280' }}>{e.notes ?? ''}</td>
                      <td style={{ padding: '8px' }}>{e.settled_at ? 'مسوّاة' : 'مفتوحة'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '14px', fontWeight: 800, fontSize: '15px', textAlign: 'left' }}>
              الإجمالي: {Math.round(total * 100) / 100}$
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DriverAdvancesPanel({
  driver,
  agents,
  onClose,
  showToast,
}: {
  driver: Driver;
  agents: AgentOption[];
  onClose: () => void;
  showToast: (msg: string, kind: 'success' | 'error') => void;
}) {
  const [summary, setSummary] = useState<DriverAdvanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmSettle, setConfirmSettle] = useState(false);

  const backendId = getBackendIdFromSynthetic(driver.id);

  const load = async () => {
    if (!backendId) return;
    setLoading(true);
    try {
      setSummary(await driverAdvancesGateway.summary(backendId));
    } catch {
      showToast('تعذر تحميل بيانات السائق', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId]);

  const addAdvance = async () => {
    setError('');
    if (!backendId) return;
    if (!amount.trim() || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('أدخلي مبلغاً صحيحاً أكبر من صفر.');
      return;
    }
    setSaving(true);
    try {
      const next = await driverAdvancesGateway.add(backendId, {
        agentId: agentId || null,
        amountUsd: Number(amount),
        notes: notes.trim() || null,
        tripDate: tripDate || null,
        receivedDate: receivedDate || null,
      });
      setSummary(next);
      setAmount('');
      setNotes('');
      setTripDate('');
      setReceivedDate('');
      showToast('تم تسجيل المبلغ', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (id: string) => {
    if (!backendId) return;
    try {
      setSummary(await driverAdvancesGateway.remove(backendId, id));
      showToast('تم الحذف', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر الحذف', 'error');
    }
  };

  const settle = async () => {
    if (!backendId) return;
    try {
      setSummary(await driverAdvancesGateway.settle(backendId));
      showToast('تمت تسوية الرحلة — بدأت رحلة جديدة برصيد كامل', 'success');
    } catch {
      showToast('تعذر التسوية', 'error');
    } finally {
      setConfirmSettle(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
      <div style={{ background: '#fff', borderRadius: '18px', padding: '24px', width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '19px', fontWeight: 800 }}>💰 {driver.name} — سجل السفرة</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#9ca3af', cursor: 'pointer' }}>×</button>
        </div>

        {loading || !summary ? (
          <p style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>جاري التحميل...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>أجرة السفرة</div>
                <div style={{ fontSize: '17px', fontWeight: 800 }}>{summary.tripWageUsd}$</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>مأخوذ حتى الآن</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#b45309' }}>{summary.totalTaken}$</div>
              </div>
              <div style={{ background: summary.owedByDriver > 0 ? '#fee2e2' : '#dcfce7', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>
                  {summary.owedByDriver > 0 ? 'ذمة على السائق' : 'المتبقي له'}
                </div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: summary.owedByDriver > 0 ? '#991b1b' : '#166534' }}>
                  {summary.owedByDriver > 0 ? summary.owedByDriver : summary.remainingForDriver}$
                </div>
              </div>
            </div>

            <h4 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '10px' }}>تسجيل مبلغ أخذه من وكيل</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              <select style={inputStyle} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">— بدون وكيل محدَّد —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.governorate ? ` — ${a.governorate}` : ''}
                  </option>
                ))}
              </select>
              <input style={inputStyle} placeholder="المبلغ ($)" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#6b7280' }}>تاريخ الرحلة الأساسية</label>
                  <input type="date" style={inputStyle} value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#6b7280' }}>تاريخ استلام المبلغ</label>
                  <input type="date" style={inputStyle} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                </div>
              </div>
              <input style={inputStyle} placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <p style={{ color: '#dc2626', fontSize: '13.5px', margin: 0 }}>{error}</p>}
              <button onClick={() => void addAdvance()} disabled={saving} style={bigButtonStyle('primary')}>
                {saving ? 'جارٍ الحفظ...' : 'إضافة'}
              </button>
              {agentId && (
                <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
                  سيُنشأ سند دفع حقيقي من صندوق هذا الوكيل تلقائياً بنفس المبلغ.
                </p>
              )}
            </div>

            <h4 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '8px' }}>السجل الحالي</h4>
            {summary.entries.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '14px' }}>لا توجد مبالغ مسجَّلة في هذه الرحلة بعد.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                {summary.entries.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '13.5px',
                    }}
                  >
                    <div>
                      <strong>{entry.agent_name ?? 'بدون وكيل'}</strong>
                      {entry.notes ? <span style={{ color: '#6b7280' }}> — {entry.notes}</span> : null}
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {entry.trip_date ? `تاريخ الرحلة: ${entry.trip_date}` : `سُجِّل: ${entry.created_at.split('T')[0]}`}
                        {entry.received_date ? ` · استلام: ${entry.received_date}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontWeight: 700, color: '#b45309' }}>{entry.amount_usd}$</span>
                      <button
                        onClick={() => void removeEntry(entry.id)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '12px' }}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => setConfirmSettle(true)} style={{ ...bigButtonStyle('danger'), width: '100%' }}>
              تسوية الرحلة (بدء رحلة جديدة)
            </button>
          </>
        )}

        {confirmSettle && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}>
            <div style={{ background: '#fff', borderRadius: '16px', padding: '26px', maxWidth: '380px', textAlign: 'center' }}>
              <p style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
                تسوية رحلة {driver.name}؟ سيُؤرشَف السجل الحالي وتبدأ رحلة جديدة برصيد كامل ({summary?.tripWageUsd}$).
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button onClick={() => void settle()} style={bigButtonStyle('danger')}>تأكيد</button>
                <button onClick={() => setConfirmSettle(false)} style={bigButtonStyle()}>إلغاء</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
