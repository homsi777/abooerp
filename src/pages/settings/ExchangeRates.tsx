import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type CurrencyRecord = {
  id: string;
  code: string;
  name: string;
  is_base: boolean;
  is_active: boolean;
};

type ExchangeRateRecord = {
  id: string;
  currency_id: string;
  currency_code: string;
  currency_name: string;
  rate: number;
  effective_date: string;
  created_at: string;
};

export default function ExchangeRatesSettingsPage() {
  const { showToast } = useToast();
  const [currencies, setCurrencies] = useState<CurrencyRecord[]>([]);
  const [rates, setRates] = useState<ExchangeRateRecord[]>([]);
  const [history, setHistory] = useState<ExchangeRateRecord[]>([]);
  const [selectedCurrencyId, setSelectedCurrencyId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [rateValue, setRateValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedCurrency = useMemo(
    () => currencies.find((currency) => currency.id === selectedCurrencyId) ?? null,
    [currencies, selectedCurrencyId],
  );

  const latestByCurrency = useMemo(() => {
    const map = new Map<string, ExchangeRateRecord>();
    for (const row of rates) {
      if (!map.has(row.currency_id)) {
        map.set(row.currency_id, row);
      }
    }
    return map;
  }, [rates]);

  const loadCurrencies = async () => {
    const rows = await httpClient.get<CurrencyRecord[]>('/currencies');
    setCurrencies(rows);
    if (!selectedCurrencyId && rows.length > 0) {
      const firstNonBase = rows.find((row) => !row.is_base && row.is_active) ?? rows[0];
      if (firstNonBase) setSelectedCurrencyId(firstNonBase.id);
    }
  };

  const loadRates = async () => {
    const rows = await httpClient.get<ExchangeRateRecord[]>('/exchange-rates');
    setRates(rows);
  };

  const loadHistory = async (currencyId: string) => {
    const rows = await httpClient.get<ExchangeRateRecord[]>(`/exchange-rates/${currencyId}/history`);
    setHistory(rows);
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadCurrencies(), loadRates()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل أسعار الصرف', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!selectedCurrencyId) return;
    void loadHistory(selectedCurrencyId).catch(() => {
      setHistory([]);
      showToast('تعذر تحميل السجل التاريخي للعملة', 'error');
    });
  }, [selectedCurrencyId]);

  const submit = async () => {
    if (!selectedCurrencyId) {
      showToast('اختر عملة أولًا', 'error');
      return;
    }
    if (!effectiveDate) {
      showToast('تاريخ السريان مطلوب', 'error');
      return;
    }
    const rate = Number.parseFloat(rateValue);
    if (!selectedCurrency?.is_base && (!Number.isFinite(rate) || rate <= 0)) {
      showToast('أدخل سعر صرف صالح', 'error');
      return;
    }
    setSaving(true);
    try {
      await httpClient.post<ExchangeRateRecord>('/exchange-rates', {
        currencyId: selectedCurrencyId,
        rate: selectedCurrency?.is_base ? 1 : rate,
        effectiveDate,
      });
      showToast('تم حفظ سعر الصرف', 'success');
      setRateValue('');
      await Promise.all([loadRates(), loadHistory(selectedCurrencyId)]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ سعر الصرف', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة أسعار الصرف</div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="form-group">
          <label className="form-label">العملة</label>
          <select className="form-select w-full" value={selectedCurrencyId} onChange={(e) => setSelectedCurrencyId(e.target.value)}>
            <option value="">اختر عملة</option>
            {currencies.filter((row) => row.is_active).map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.code} - {currency.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">تاريخ السريان</label>
          <input type="date" className="form-input w-full" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">سعر الصرف إلى العملة الأساسية</label>
          <input
            type="number"
            step="0.000001"
            className="form-input w-full"
            value={selectedCurrency?.is_base ? '1' : rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            disabled={Boolean(selectedCurrency?.is_base)}
          />
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <button className="toolbar-btn primary" onClick={() => void submit()} disabled={saving}>حفظ السعر</button>
        <button className="toolbar-btn" onClick={() => void refreshAll()} disabled={loading}>تحديث</button>
      </div>

      <div className="card mb-3">
        <div className="card-header">آخر الأسعار المعتمدة</div>
        <table className="data-grid">
          <thead>
            <tr>
              <th>العملة</th>
              <th>آخر سعر</th>
              <th>تاريخ السريان</th>
            </tr>
          </thead>
          <tbody>
            {currencies.filter((row) => row.is_active).map((currency) => {
              const latest = latestByCurrency.get(currency.id);
              return (
                <tr key={currency.id}>
                  <td>{currency.code}</td>
                  <td>{currency.is_base ? 1 : latest?.rate ?? '-'}</td>
                  <td>{currency.is_base ? '-' : latest?.effective_date ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header">السجل التاريخي</div>
        <table className="data-grid">
          <thead>
            <tr>
              <th>العملة</th>
              <th>السعر</th>
              <th>تاريخ السريان</th>
              <th>وقت الإدخال</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id}>
                <td>{row.currency_code}</td>
                <td>{row.rate}</td>
                <td>{row.effective_date}</td>
                <td>{row.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
