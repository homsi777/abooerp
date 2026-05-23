import { type SupportedCurrencyRow } from '../../../lib/settings/currencySettingsStore';

interface SupportedCurrenciesTableProps {
  rows: SupportedCurrencyRow[];
  onRowsChange: (rows: SupportedCurrencyRow[]) => void;
  onOpenRateEditor: (code: string) => void;
}

export default function SupportedCurrenciesTable({ rows, onRowsChange, onOpenRateEditor }: SupportedCurrenciesTableProps) {
  const updateRow = (code: SupportedCurrencyRow['code'], patch: Partial<SupportedCurrencyRow>) => {
    onRowsChange(rows.map((row) => (row.code === code ? { ...row, ...patch } : row)));
  };

  return (
    <div className="card">
      <div className="card-header">العملات المدعومة</div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>Currency Code</th>
            <th>الاسم العربي</th>
            <th>الرمز</th>
            <th>الحالة</th>
            <th>الكسور العشرية</th>
            <th>التصنيف</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td>{row.code}</td>
              <td>
                <input
                  className="form-input w-full"
                  value={row.arabicLabel}
                  onChange={(e) => updateRow(row.code, { arabicLabel: e.target.value })}
                />
              </td>
              <td>{row.symbol}</td>
              <td>
                <span className={`status-badge ${row.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {row.status === 'active' ? 'active' : 'inactive'}
                </span>
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={6}
                  className="form-input w-20"
                  value={row.decimals}
                  onChange={(e) => updateRow(row.code, { decimals: Number(e.target.value) || 0 })}
                />
              </td>
              <td>
                {row.isBase ? (
                  <span className="status-badge bg-blue-100 text-blue-800">Base (USD)</span>
                ) : (
                  <span className="status-badge bg-gray-100 text-gray-800">Non-base</span>
                )}
              </td>
              <td>
                <div className="flex gap-1">
                  {!row.isBase && (
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() =>
                        updateRow(row.code, { status: row.status === 'active' ? 'inactive' : 'active' })
                      }
                    >
                      {row.status === 'active' ? 'تعطيل' : 'تفعيل'}
                    </button>
                  )}
                  <button type="button" className="toolbar-btn" onClick={() => onOpenRateEditor(row.code)}>
                    تعديل السعر
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
