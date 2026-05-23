import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { getExchangeRatesToUsd, parseDecimalAmount, saveExchangeRatesToUsd } from '../../lib/currency/currency';

export default function ExchangeRatesSettings() {
  const { showToast } = useToast();
  const storedRates = getExchangeRatesToUsd();
  const [rateSypToUsd, setRateSypToUsd] = useState(storedRates.SYP.toString());
  const [rateTryToUsd, setRateTryToUsd] = useState(storedRates.TRY.toString());

  const handleSave = () => {
    saveExchangeRatesToUsd({
      SYP: parseDecimalAmount(rateSypToUsd),
      TRY: parseDecimalAmount(rateTryToUsd),
    });
    showToast('تم حفظ أسعار الصرف', 'success');
  };

  return (
    <div className="card">
      <div className="card-header">أسعار الصرف</div>
      <div className="grid grid-cols-3 gap-4">
        <div className="form-group">
          <label className="form-label">العملة الأساسية</label>
          <input type="text" className="form-input w-full bg-gray-100 font-bold" value="USD (Locked Base)" readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">SYP → USD</label>
          <input
            type="number"
            step="0.000001"
            className="form-input w-full"
            value={rateSypToUsd}
            onChange={(e) => setRateSypToUsd(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">TRY → USD</label>
          <input
            type="number"
            step="0.0001"
            className="form-input w-full"
            value={rateTryToUsd}
            onChange={(e) => setRateTryToUsd(e.target.value)}
          />
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-2">تُستخدم هذه الأسعار عالميًا في كل التحويلات والتجميعات المالية.</div>
      <div className="mt-4">
        <button onClick={handleSave} className="toolbar-btn primary">حفظ</button>
      </div>
    </div>
  );
}
