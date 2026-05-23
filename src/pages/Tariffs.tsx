import { useState, useEffect } from 'react';
import type { Branch, City, GoodsType, Tariff } from '../types';
import AutocompleteInput from '../components/AutocompleteInput';
import { useToast } from '../components/Toast';
import { phase15Gateway } from '../lib/api/phase15Gateway';

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function dedupeByLabel(items: Array<{ id: number; label: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeName(item.label).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveCityIdFromBranchLabel(branchLabel: string, cities: City[]): number | undefined {
  const bn = normalizeName(branchLabel);
  if (!bn) return undefined;
  const match = cities.find((c) => normalizeName(bn).includes(normalizeName(c.name)) || normalizeName(c.name).includes(normalizeName(bn)));
  return match?.id;
}

function parseDecimal(value: string) {
  const cleaned = value.trim().replace(/[٫،,]/g, '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function Tariffs() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();
  const [pricePerKgInput, setPricePerKgInput] = useState('0');
  const [minimumChargeInput, setMinimumChargeInput] = useState('0');
  const [formData, setFormData] = useState<Partial<Tariff>>({
    fromCityId: undefined,
    fromCityName: '',
    toCityId: undefined,
    toCityName: '',
    goodsTypeId: undefined,
    goodsTypeName: '',
    pricePerKg: 0,
    minimumCharge: 0,
    validFrom: new Date().toISOString().split('T')[0],
  });

  useEffect(() => { loadTariffs(); }, []);

  const loadTariffs = async () => {
    setLoading(true);
    try {
      const [tariffsData, citiesData, goodsData, branchesData] = await Promise.all([
        phase15Gateway.tariffs.getAll(),
        phase15Gateway.cities.getAll(),
        phase15Gateway.goodsTypes.getAll(),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setCities(citiesData);
      setGoodsTypes(goodsData);
      setBranches(branchesData);
      const cityMap = new Map(citiesData.map((city) => [city.id, city]));
      const goodsMap = new Map(goodsData.map((goods) => [goods.id, goods]));
      const data = tariffsData.map((tariff) => ({
        ...tariff,
        fromCityName: cityMap.get(tariff.fromCityId)?.name || tariff.fromCityName,
        toCityName: cityMap.get(tariff.toCityId)?.name || tariff.toCityName,
        goodsTypeName: goodsMap.get(tariff.goodsTypeId)?.name || tariff.goodsTypeName,
      }));
      setTariffs(data);
    } finally {
      setLoading(false);
    }
  };

  const originOptions = (() => {
    const mapped = branches
      .map((b) => {
        const cityId = resolveCityIdFromBranchLabel(b.name, cities);
        if (!cityId) return null;
        return { id: cityId, label: b.name };
      })
      .filter(Boolean) as Array<{ id: number; label: string }>;
    if (mapped.length) return dedupeByLabel(mapped);
    const fallback = cities
      .filter((c) => !normalizeName(c.name).includes('فرع'))
      .map((c) => ({ id: c.id, label: `فرع ${c.name}` }));
    return dedupeByLabel(fallback);
  })();

  const destinationOptions = (() => {
    const base = cities
      .filter((c) => !normalizeName(c.name).includes('فرع'))
      .map((c) => ({ id: c.id, label: c.name }));
    return dedupeByLabel(base);
  })();

  const handleNew = () => {
    const fromCity = originOptions[0];
    const toCity = destinationOptions[0];
    const goodsType = goodsTypes[0];
    setSelectedTariff(null);
    setPricePerKgInput('');
    setMinimumChargeInput('');
    setFormData({
      fromCityId: fromCity?.id,
      fromCityName: fromCity?.label || '',
      toCityId: toCity?.id,
      toCityName: toCity?.label || '',
      goodsTypeId: goodsType?.id,
      goodsTypeName: goodsType?.name || '',
      pricePerKg: 0,
      minimumCharge: 0,
      validFrom: new Date().toISOString().split('T')[0],
    });
    setIsEditing(true);
  };

  const handleEdit = (tariff: Tariff) => {
    setSelectedTariff(tariff);
    setPricePerKgInput(tariff.pricePerKg ? String(tariff.pricePerKg) : '');
    setMinimumChargeInput(tariff.minimumCharge ? String(tariff.minimumCharge) : '');
    setFormData(tariff);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!formData.fromCityId || !formData.toCityId || !formData.goodsTypeId) {
      showToast('يرجى اختيار المدن ونوع البضاعة', 'error');
      return;
    }
    try {
      if (selectedTariff) {
        await phase15Gateway.tariffs.update(selectedTariff.id, formData);
        showToast('تم تحديث التعرفة', 'success');
      } else {
        await phase15Gateway.tariffs.create(formData);
        showToast('تمت إضافة التعرفة', 'success');
      }
      setIsEditing(false);
      await loadTariffs();
    } catch {
      showToast('تعذر حفظ التعرفة', 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedTariff) return;
    try {
      await phase15Gateway.tariffs.delete(selectedTariff.id);
      showToast('تم حذف التعرفة', 'success');
      setSelectedTariff(null);
      setIsEditing(false);
      await loadTariffs();
    } catch {
      showToast('تعذر حذف التعرفة', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">تعريف الأسعار (الأجور)</h2>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadTariffs} className="toolbar-btn">تحميل</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الخط / المصدر</th>
                <th>الجهة</th>
                <th>نوع الطرود</th>
                <th>السعر/كغ</th>
                <th>الحد الأدنى/طرد</th>
                <th>صالح من</th>
              </tr>
            </thead>
            <tbody>
              {tariffs.map((tariff) => (
                <tr key={tariff.id} className={selectedTariff?.id === tariff.id ? 'selected' : ''} onClick={() => handleEdit(tariff)}>
                  <td>{tariff.fromCityName}</td>
                  <td>{tariff.toCityName}</td>
                  <td>{tariff.goodsTypeName}</td>
                  <td className="text-left">{tariff.pricePerKg.toLocaleString()}</td>
                  <td className="text-left">{tariff.minimumCharge.toLocaleString()}</td>
                  <td>{tariff.validFrom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">{selectedTariff ? 'تعديل سعر' : 'سعر جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">الخط / المصدر</label>
                <select
                  className="form-input w-full"
                  value={formData.fromCityId || ''}
                  onChange={(e) => {
                    const option = originOptions.find((item) => item.id === Number(e.target.value));
                    setFormData({ ...formData, fromCityId: option?.id, fromCityName: option?.label || '' });
                  }}
                >
                  {originOptions.map((opt) => (
                    <option key={`${opt.id}-${opt.label}`} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">الجهة</label>
                <select
                  className="form-input w-full"
                  value={formData.toCityId || ''}
                  onChange={(e) => {
                    const option = destinationOptions.find((item) => item.id === Number(e.target.value));
                    setFormData({ ...formData, toCityId: option?.id, toCityName: option?.label || '' });
                  }}
                >
                  {destinationOptions.map((opt) => (
                    <option key={`${opt.id}-${opt.label}`} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">نوع الطرود</label>
                <AutocompleteInput
                  value={formData.goodsTypeName || ''}
                  onChange={(value) => {
                    setFormData((prev) => {
                      const nextName = value;
                      const keepId =
                        prev.goodsTypeId != null &&
                        normalizeName(prev.goodsTypeName || '').toLowerCase() === normalizeName(nextName).toLowerCase();
                      return { ...prev, goodsTypeName: nextName, goodsTypeId: keepId ? prev.goodsTypeId : undefined };
                    });
                  }}
                  onSelect={(item) => {
                    setFormData((prev) => ({ ...prev, goodsTypeId: item.id, goodsTypeName: item.name }));
                  }}
                  onAddNew={(name) => {
                    void (async () => {
                      const normalized = normalizeName(name);
                      try {
                        const created = await phase15Gateway.goodsTypes.create({
                          code: `GT-${Date.now()}`,
                          name: normalized,
                          description: '',
                        });
                        setGoodsTypes((prev) => [...prev, created]);
                        setFormData((prev) => ({ ...prev, goodsTypeId: created.id, goodsTypeName: created.name }));
                        showToast('تمت إضافة نوع الطرود', 'success');
                      } catch {
                        showToast('تعذر إضافة نوع الطرود', 'error');
                      }
                    })();
                  }}
                  items={goodsTypes.map((g) => ({ id: g.id, name: g.name }))}
                  placeholder="حرف أو اثنان…"
                />
              </div>
              <div className="form-group">
                <label className="form-label">السعر لكل كغ</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="form-input w-full"
                  value={pricePerKgInput}
                  onChange={(e) => {
                    setPricePerKgInput(e.target.value);
                    setFormData((prev) => ({ ...prev, pricePerKg: parseDecimal(e.target.value) }));
                  }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">الحد الأدنى لكل طرد</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="form-input w-full"
                  value={minimumChargeInput}
                  onChange={(e) => {
                    setMinimumChargeInput(e.target.value);
                    setFormData((prev) => ({ ...prev, minimumCharge: parseDecimal(e.target.value) }));
                  }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">صالح من</label>
                <input type="date" className="form-input w-full" value={formData.validFrom || ''} onChange={(e) => setFormData({...formData, validFrom: e.target.value})} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
              {selectedTariff && (
                <button onClick={handleDelete} className="toolbar-btn w-full bg-red-100 text-red-700 hover:bg-red-200">
                  حذف
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
