import { type CurrencyFormattingSettings } from '../../../lib/settings/currencySettingsStore';

interface CurrencyFormattingPanelProps {
  value: CurrencyFormattingSettings;
  onChange: (next: CurrencyFormattingSettings) => void;
}

export default function CurrencyFormattingPanel({ value, onChange }: CurrencyFormattingPanelProps) {
  const update = (patch: Partial<CurrencyFormattingSettings>) => onChange({ ...value, ...patch });

  return (
    <div className="card">
      <div className="card-header">قواعد التنسيق والكسور العشرية</div>
      <div className="grid grid-cols-4 gap-3">
        <div className="form-group">
          <label className="form-label">الكسور — الدولار</label>
          <input type="number" min={0} max={6} className="form-input w-full" value={value.decimalPlacesUsd} onChange={(e) => update({ decimalPlacesUsd: Number(e.target.value) || 0 })} />
        </div>
        <div className="form-group">
          <label className="form-label">الكسور — الليرة السورية</label>
          <input type="number" min={0} max={6} className="form-input w-full" value={value.decimalPlacesSyp} onChange={(e) => update({ decimalPlacesSyp: Number(e.target.value) || 0 })} />
        </div>
        <div className="form-group">
          <label className="form-label">الكسور — الليرة التركية</label>
          <input type="number" min={0} max={6} className="form-input w-full" value={value.decimalPlacesTry} onChange={(e) => update({ decimalPlacesTry: Number(e.target.value) || 0 })} />
        </div>
        <div className="form-group">
          <label className="form-label">عرض العملة</label>
          <select className="form-select w-full" value={value.showCurrencyAs} onChange={(e) => update({ showCurrencyAs: e.target.value as 'symbol' | 'code' })}>
            <option value="code">رمز العملة (دولار/ليرة سورية/ليرة تركية)</option>
            <option value="symbol">الرمز ($ / £ / ₺)</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.normalizeTotalsToUsd} onChange={(e) => update({ normalizeTotalsToUsd: e.target.checked })} />تطبيع المجاميع إلى الدولار</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.showOriginalCurrencyInRows} onChange={(e) => update({ showOriginalCurrencyInRows: e.target.checked })} />إظهار العملة الأصلية في الصفوف</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.showUsdEquivalent} onChange={(e) => update({ showUsdEquivalent: e.target.checked })} />إظهار مكافئ الدولار بجانب الأصل</label>
      </div>
      <div className="text-xs text-gray-500 mt-2">
        يدعم النظام القيم العشرية بالكامل مثل: 0.10 - 1.00 - 1.50 - 125.75
      </div>
    </div>
  );
}
