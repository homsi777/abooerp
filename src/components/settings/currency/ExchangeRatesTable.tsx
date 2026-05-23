import { parseDecimalAmount } from '../../../lib/currency/currency';
import { type ExchangeRateRow } from '../../../lib/settings/currencySettingsStore';

interface ExchangeRatesTableProps {
  rows: ExchangeRateRow[];
  onRowsChange: (rows: ExchangeRateRow[]) => void;
}

export default function ExchangeRatesTable({ rows, onRowsChange }: ExchangeRatesTableProps) {
  const updateRate = (from: ExchangeRateRow['from'], value: string) => {
    const parsed = parseDecimalAmount(value);
    onRowsChange(
      rows.map((row) =>
        row.from === from
          ? {
              ...row,
              rate: parsed,
              updatedAt: new Date().toLocaleString('ar-SY'),
              updatedBy: 'مسؤول',
            }
          : row
      )
    );
  };

  return (
    <div className="card">
      <div className="card-header">إدارة أسعار الصرف</div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>من</th>
            <th>إلى</th>
            <th>سعر الصرف</th>
            <th>معاينة معكوسة</th>
            <th>آخر تحديث</th>
            <th>المحدّث</th>
            <th>المصدر</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.from}-${row.to}`}>
              <td>{row.from}</td>
              <td>{row.to}</td>
              <td>
                <input
                  type="number"
                  step="0.000001"
                  className="form-input w-40"
                  value={row.rate}
                  onChange={(e) => updateRate(row.from, e.target.value)}
                />
              </td>
              <td>{row.rate > 0 ? (1 / row.rate).toFixed(4) : '-'}</td>
              <td>{row.updatedAt}</td>
              <td>{row.updatedBy}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
