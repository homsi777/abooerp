import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import {
  goodsPricingGateway,
  type GoodsPricingGroup,
  type PartyPriceRow,
  type PartySearchResult,
  type PricingUnit,
  type UnclassifiedGoodsType,
} from '../../lib/api/goodsPricingGateway';

type TabKey = 'general' | 'vip' | 'unclassified' | 'history';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'الأسعار العامة' },
  { key: 'vip', label: 'أسعار VIP' },
  { key: 'unclassified', label: 'أصناف غير مصنفة' },
  { key: 'history', label: 'سجل التغييرات' },
];

const unitLabel = (u: PricingUnit | null | undefined) => (u === 'kg' ? 'كيلو' : 'طرد');

// ── shared large-accessible primitives (18px+ body, 48px+ controls) ──────
const bigCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '2px solid #e5e7eb',
  borderRadius: '16px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const bigButtonStyle = (variant: 'primary' | 'default' | 'danger' = 'default'): React.CSSProperties => ({
  minHeight: '48px',
  padding: '10px 22px',
  fontSize: '17px',
  fontWeight: 700,
  borderRadius: '10px',
  border: variant === 'default' ? '2px solid #d1d5db' : 'none',
  background: variant === 'primary' ? '#4f46e5' : variant === 'danger' ? '#dc2626' : '#fff',
  color: variant === 'default' ? '#111827' : '#fff',
  cursor: 'pointer',
});

const bigInputStyle: React.CSSProperties = {
  minHeight: '48px',
  fontSize: '18px',
  padding: '8px 14px',
  borderRadius: '10px',
  border: '2px solid #d1d5db',
  width: '100%',
  boxSizing: 'border-box',
};

function ConfirmDialog({ text, onConfirm, onCancel }: { text: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '420px', textAlign: 'center' }}>
        <p style={{ fontSize: '19px', fontWeight: 700, color: '#111827', marginBottom: '22px' }}>{text}</p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button type="button" style={bigButtonStyle('danger')} onClick={onConfirm}>تأكيد</button>
          <button type="button" style={bigButtonStyle()} onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function PriceEditPanel({
  title,
  initialUnit,
  initialPrice,
  compareLabel,
  compareValue,
  onSave,
  onCancel,
}: {
  title: string;
  initialUnit: PricingUnit;
  initialPrice: string;
  compareLabel?: string;
  compareValue?: string;
  onSave: (unit: PricingUnit, price: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [unit, setUnit] = useState<PricingUnit>(initialUnit);
  const [price, setPrice] = useState(initialPrice);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError('');
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) {
      setError('أدخلي سعراً صحيحاً (رقم غير سالب، بحد أقصى رقمين عشريين) — مثل 3 أو 3.50');
      return;
    }
    setSaving(true);
    try {
      await onSave(unit, price.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
      <div style={{ background: '#fff', borderRadius: '18px', padding: '26px', width: 'min(440px, 92vw)' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '18px' }}>{title}</h3>

        {compareLabel && (
          <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '16px' }}>
            {compareLabel}: <strong>{compareValue ?? '—'}</strong>
          </div>
        )}

        <label style={{ display: 'block', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>وحدة التسعير</label>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
          <button type="button" onClick={() => setUnit('parcel')} style={{ ...bigButtonStyle(unit === 'parcel' ? 'primary' : 'default'), flex: 1 }}>
            لكل طرد
          </button>
          <button type="button" onClick={() => setUnit('kg')} style={{ ...bigButtonStyle(unit === 'kg' ? 'primary' : 'default'), flex: 1 }}>
            لكل كيلوغرام
          </button>
        </div>

        <label style={{ display: 'block', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>السعر (USD)</label>
        <input
          style={{ ...bigInputStyle, fontSize: '24px', fontWeight: 800, textAlign: 'center' }}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          autoFocus
        />
        {error && <p style={{ color: '#dc2626', fontSize: '15px', marginTop: '10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '12px', marginTop: '22px', justifyContent: 'flex-end' }}>
          <button type="button" style={bigButtonStyle()} onClick={onCancel} disabled={saving}>إلغاء</button>
          <button type="button" style={bigButtonStyle('primary')} onClick={() => void save()} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GoodsPricing() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabKey>('general');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', paddingBottom: '32px', fontSize: '18px' }}>
      <div>
        <Link to="/finance" style={{ fontSize: '15px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
          ← الذمم والمالية
        </Link>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111827', margin: '8px 0 4px' }}>📦 تسعير البضائع</h1>
        <p style={{ fontSize: '16px', color: '#6b7280' }}>إدارة الأسعار العامة وأسعار العملاء الخاصة (VIP) لأنواع البضائع.</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              minHeight: '52px',
              padding: '10px 26px',
              fontSize: '18px',
              fontWeight: 800,
              borderRadius: '12px',
              border: tab === t.key ? '2px solid #4f46e5' : '2px solid #e5e7eb',
              background: tab === t.key ? '#eef2ff' : '#fff',
              color: tab === t.key ? '#3730a3' : '#374151',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralPricesTab showToast={showToast} />}
      {tab === 'vip' && <VipPricesTab showToast={showToast} />}
      {tab === 'unclassified' && <UnclassifiedTab showToast={showToast} />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

// ───────────────────────── Tab 1: General prices ──────────────────────────
function GeneralPricesTab({ showToast }: { showToast: (msg: string, kind: 'success' | 'error') => void }) {
  const [groups, setGroups] = useState<GoodsPricingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<GoodsPricingGroup | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<GoodsPricingGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGroups(await goodsPricingGateway.groups.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المجموعات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await goodsPricingGateway.groups.create({ name: newGroupName.trim() });
      showToast('تم إنشاء المجموعة', 'success');
      setNewGroupName('');
      setAddingGroup(false);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إنشاء المجموعة', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <button type="button" style={bigButtonStyle('primary')} onClick={() => setAddingGroup(true)}>
        ＋ إضافة مجموعة
      </button>

      {addingGroup && (
        <div style={bigCardStyle}>
          <label style={{ fontSize: '16px', fontWeight: 600 }}>اسم المجموعة (مثل: ألبسة، أحذية، قطع تبديل)</label>
          <input style={bigInputStyle} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" style={bigButtonStyle('primary')} onClick={() => void createGroup()}>حفظ</button>
            <button type="button" style={bigButtonStyle()} onClick={() => setAddingGroup(false)}>إلغاء</button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: '18px', color: '#6b7280', textAlign: 'center', padding: '40px' }}>جاري التحميل...</p>
      ) : error ? (
        <p style={{ fontSize: '18px', color: '#dc2626', textAlign: 'center', padding: '40px' }}>{error}</p>
      ) : groups.length === 0 ? (
        <p style={{ fontSize: '18px', color: '#6b7280', textAlign: 'center', padding: '40px' }}>لا توجد مجموعات تسعير بعد.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {groups.map((g) => (
            <div key={g.id} style={{ ...bigCardStyle, opacity: g.is_active ? 1 : 0.6 }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827' }}>{g.name}</div>
              {g.general_price_usd ? (
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#166534' }}>
                  {Number(g.general_price_usd).toFixed(2)} $
                  <span style={{ fontSize: '15px', color: '#6b7280', fontWeight: 600, marginRight: '8px' }}>
                    / {unitLabel(g.general_unit)}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: '17px', color: '#9ca3af', fontWeight: 700 }}>بدون سعر</div>
              )}
              <div style={{ fontSize: '14px', color: '#6b7280' }}>
                {g.member_count} صنف مرتبط · {g.vip_count} سعر VIP
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button type="button" style={{ ...bigButtonStyle('primary'), flex: 1 }} onClick={() => setEditing(g)}>
                  تعديل السعر
                </button>
                {g.general_price_usd && (
                  <button type="button" style={bigButtonStyle('danger')} onClick={() => setConfirmDeactivate(g)}>
                    تعطيل
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PriceEditPanel
          title={`سعر مجموعة: ${editing.name}`}
          initialUnit={editing.general_unit ?? 'parcel'}
          initialPrice={editing.general_price_usd ?? ''}
          onCancel={() => setEditing(null)}
          onSave={async (unit, price) => {
            await goodsPricingGateway.groups.setPrice(editing.id, { pricingUnit: unit, unitPriceUsd: price });
            showToast('تم حفظ السعر', 'success');
            setEditing(null);
            void load();
          }}
        />
      )}

      {confirmDeactivate && (
        <ConfirmDialog
          text={`تعطيل السعر العام لمجموعة "${confirmDeactivate.name}"؟`}
          onConfirm={async () => {
            try {
              await goodsPricingGateway.groups.deactivatePrice(confirmDeactivate.id);
              showToast('تم تعطيل السعر', 'success');
            } catch (e) {
              showToast(e instanceof Error ? e.message : 'تعذر التعطيل', 'error');
            } finally {
              setConfirmDeactivate(null);
              void load();
            }
          }}
          onCancel={() => setConfirmDeactivate(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────── Tab 2: VIP prices ──────────────────────────────
function VipPricesTab({ showToast }: { showToast: (msg: string, kind: 'success' | 'error') => void }) {
  const [search, setSearch] = useState('');
  const [parties, setParties] = useState<PartySearchResult[]>([]);
  const [loadingParties, setLoadingParties] = useState(true);
  const [selected, setSelected] = useState<PartySearchResult | null>(null);
  const [groups, setGroups] = useState<GoodsPricingGroup[]>([]);
  const [prices, setPrices] = useState<PartyPriceRow[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GoodsPricingGroup | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<PartyPriceRow | null>(null);

  const loadParties = useCallback(async (q: string) => {
    setLoadingParties(true);
    try {
      setParties(await goodsPricingGateway.parties.search(q || undefined));
    } catch {
      setParties([]);
    } finally {
      setLoadingParties(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadParties(search), 350);
    return () => clearTimeout(t);
  }, [search, loadParties]);

  useEffect(() => {
    void goodsPricingGateway.groups.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  const loadPrices = useCallback(async (partyId: string) => {
    setLoadingPrices(true);
    try {
      setPrices(await goodsPricingGateway.parties.prices(partyId));
    } catch {
      setPrices([]);
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadPrices(selected.id);
  }, [selected, loadPrices]);

  if (!selected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <input
          style={bigInputStyle}
          placeholder="ابحثي باسم الشخص (حرفان على الأقل)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p style={{ fontSize: '14.5px', color: '#6b7280' }}>
          {search.trim().length >= 2 ? 'نتائج البحث' : 'يظهر هنا أولاً من لديهم أسعار خاصة مسجَّلة'}
        </p>
        {loadingParties ? (
          <p style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>جاري البحث...</p>
        ) : parties.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>لا نتائج.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {parties.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                style={{
                  ...bigCardStyle,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  textAlign: 'right',
                }}
              >
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 700 }}>{p.full_name}</div>
                  {p.city && <div style={{ fontSize: '14px', color: '#6b7280' }}>{p.city}</div>}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: p.vip_price_count > 0 ? '#166534' : '#9ca3af' }}>
                  {p.vip_price_count} سعر خاص
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <button type="button" style={bigButtonStyle()} onClick={() => setSelected(null)}>
        ← رجوع لاختيار شخص آخر
      </button>

      <div style={bigCardStyle}>
        <div style={{ fontSize: '22px', fontWeight: 800 }}>{selected.full_name}</div>
        {selected.city && <div style={{ fontSize: '15px', color: '#6b7280' }}>{selected.city}</div>}
      </div>

      <h3 style={{ fontSize: '19px', fontWeight: 800 }}>الأسعار الخاصة</h3>
      {loadingPrices ? (
        <p style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>جاري التحميل...</p>
      ) : prices.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '16px' }}>لا توجد أسعار خاصة لهذا الشخص بعد.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {prices.map((p) => (
            <div key={p.id} style={bigCardStyle}>
              <div style={{ fontSize: '18px', fontWeight: 800 }}>{p.group_name}</div>
              <div style={{ fontSize: '16px' }}>
                السعر الخاص: <strong style={{ color: '#166534' }}>{Number(p.unit_price_usd).toFixed(2)}$</strong>
                {' / '}{unitLabel(p.pricing_unit)}
                {p.general_price_usd && (
                  <span style={{ color: '#6b7280' }}> | العام: {Number(p.general_price_usd).toFixed(2)}$</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button
                  type="button"
                  style={{ ...bigButtonStyle('primary'), flex: 1 }}
                  onClick={() => setEditingGroup(groups.find((g) => g.id === p.group_id) ?? null)}
                >
                  تعديل
                </button>
                <button type="button" style={bigButtonStyle('danger')} onClick={() => setConfirmDeactivate(p)}>
                  تعطيل
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: '19px', fontWeight: 800, marginTop: '10px' }}>إضافة سعر خاص جديد</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
        {groups
          .filter((g) => !prices.some((p) => p.group_id === g.id))
          .map((g) => (
            <button key={g.id} type="button" style={{ ...bigButtonStyle(), textAlign: 'right' }} onClick={() => setEditingGroup(g)}>
              {g.name}
            </button>
          ))}
      </div>

      {editingGroup && (
        <PriceEditPanel
          title={`سعر خاص لـ ${selected.full_name} — ${editingGroup.name}`}
          initialUnit={prices.find((p) => p.group_id === editingGroup.id)?.pricing_unit ?? editingGroup.general_unit ?? 'parcel'}
          initialPrice={prices.find((p) => p.group_id === editingGroup.id)?.unit_price_usd ?? ''}
          compareLabel="السعر العام للمجموعة"
          compareValue={editingGroup.general_price_usd ? `${Number(editingGroup.general_price_usd).toFixed(2)}$ / ${unitLabel(editingGroup.general_unit)}` : 'بدون سعر عام'}
          onCancel={() => setEditingGroup(null)}
          onSave={async (unit, price) => {
            await goodsPricingGateway.parties.setPrice(selected.id, editingGroup.id, { pricingUnit: unit, unitPriceUsd: price });
            showToast('تم حفظ السعر الخاص', 'success');
            setEditingGroup(null);
            void loadPrices(selected.id);
          }}
        />
      )}

      {confirmDeactivate && (
        <ConfirmDialog
          text={`تعطيل السعر الخاص "${confirmDeactivate.group_name}" لـ ${selected.full_name}؟`}
          onConfirm={async () => {
            try {
              await goodsPricingGateway.parties.deactivatePrice(selected.id, confirmDeactivate.group_id);
              showToast('تم التعطيل', 'success');
            } catch (e) {
              showToast(e instanceof Error ? e.message : 'تعذر التعطيل', 'error');
            } finally {
              setConfirmDeactivate(null);
              void loadPrices(selected.id);
            }
          }}
          onCancel={() => setConfirmDeactivate(null)}
        />
      )}
    </div>
  );
}

// ───────────────────── Tab 3: Unclassified goods types ────────────────────
function UnclassifiedTab({ showToast }: { showToast: (msg: string, kind: 'success' | 'error') => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UnclassifiedGoodsType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<GoodsPricingGroup[]>([]);
  const [coverage, setCoverage] = useState<{ classifiedPct: number; pricedPct: number } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const result = await goodsPricingGateway.unclassified({ search: q || undefined, pageSize: 100 });
      setRows(result.rows);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  useEffect(() => {
    void goodsPricingGateway.groups.list().then(setGroups).catch(() => setGroups([]));
    void goodsPricingGateway.coverage().then(setCoverage).catch(() => setCoverage(null));
  }, []);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const assignToGroup = async (groupId: string) => {
    try {
      await goodsPricingGateway.groups.addMembers(groupId, Array.from(selectedIds));
      showToast(`تمت إضافة ${selectedIds.size} صنف للمجموعة`, 'success');
      setSelectedIds(new Set());
      setAssigning(false);
      void load(search);
      void goodsPricingGateway.coverage().then(setCoverage).catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر الإضافة', 'error');
    }
  };

  const createGroupAndAssign = async () => {
    if (!newGroupName.trim()) return;
    try {
      const created = await goodsPricingGateway.groups.create({ name: newGroupName.trim() });
      await assignToGroup(created.id);
      setNewGroupMode(false);
      setNewGroupName('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إنشاء المجموعة', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {coverage && (
        <div style={{ ...bigCardStyle, flexDirection: 'row', justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#4f46e5' }}>{coverage.classifiedPct}%</div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>من الأسطر مصنَّفة</div>
          </div>
          <div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#166534' }}>{coverage.pricedPct}%</div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>من الأسطر مُسعَّرة فعلاً</div>
          </div>
        </div>
      )}

      <input style={bigInputStyle} placeholder="بحث عن صنف..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {selectedIds.size > 0 && (
        <div style={{ ...bigCardStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', background: '#eef2ff' }}>
          <span style={{ fontSize: '17px', fontWeight: 700 }}>{selectedIds.size} صنف محدَّد</span>
          <button type="button" style={bigButtonStyle('primary')} onClick={() => setAssigning(true)}>
            إضافة إلى مجموعة
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>جاري التحميل...</p>
      ) : rows.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>لا توجد أصناف غير مصنَّفة مطابقة.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map((r) => (
            <label
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px 18px',
                borderRadius: '12px',
                border: '2px solid ' + (selectedIds.has(r.id) ? '#4f46e5' : '#e5e7eb'),
                background: selectedIds.has(r.id) ? '#eef2ff' : '#fff',
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggle(r.id)} style={{ width: '22px', height: '22px' }} />
              <span style={{ fontSize: '17px', flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 700 }}>{r.rows_count} سطر</span>
            </label>
          ))}
        </div>
      )}

      {assigning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
          <div style={{ background: '#fff', borderRadius: '18px', padding: '26px', width: 'min(460px, 92vw)', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>إضافة {selectedIds.size} صنف إلى مجموعة</h3>

            {!newGroupMode ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {groups.map((g) => (
                    <button key={g.id} type="button" style={{ ...bigButtonStyle(), textAlign: 'right' }} onClick={() => void assignToGroup(g.id)}>
                      {g.name}
                    </button>
                  ))}
                </div>
                <button type="button" style={{ ...bigButtonStyle('primary'), width: '100%' }} onClick={() => setNewGroupMode(true)}>
                  ＋ مجموعة جديدة
                </button>
              </>
            ) : (
              <>
                <input style={bigInputStyle} placeholder="اسم المجموعة الجديدة" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} autoFocus />
                <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                  <button type="button" style={bigButtonStyle('primary')} onClick={() => void createGroupAndAssign()}>إنشاء وإضافة</button>
                  <button type="button" style={bigButtonStyle()} onClick={() => setNewGroupMode(false)}>رجوع</button>
                </div>
              </>
            )}

            <div style={{ marginTop: '18px', textAlign: 'left' }}>
              <button type="button" style={bigButtonStyle()} onClick={() => setAssigning(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Tab 4: History ─────────────────────────────────
function HistoryTab() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof goodsPricingGateway.history>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void goodsPricingGateway
      .history(1)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>جاري التحميل...</p>;
  if (rows.length === 0) return <p style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>لا توجد تغييرات مسجَّلة بعد.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rows.map((h) => (
        <div key={h.id} style={{ ...bigCardStyle, padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#6b7280' }}>
            <span>{new Date(h.changed_at).toLocaleString('ar-SY')}</span>
            <span>{h.changed_by_username ?? '—'}</span>
          </div>
          <div style={{ fontSize: '17px', fontWeight: 700 }}>
            {h.group_name ?? '—'}
            {h.party_name ? ` — ${h.party_name}` : ''}
          </div>
          <div style={{ fontSize: '16px' }}>
            {h.old_unit_price_usd ? `${Number(h.old_unit_price_usd).toFixed(2)}$` : '—'} ← {h.new_unit_price_usd ? `${Number(h.new_unit_price_usd).toFixed(2)}$` : 'معطَّل'}
          </div>
        </div>
      ))}
    </div>
  );
}
