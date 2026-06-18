import { formatWesternNumber } from '../../../lib/format/westernDigits';

export const DEFAULT_STATEMENT_DATE_FROM = '2026-06-01';

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtMoney(n: number, currency = 'USD'): string {
  const s = formatWesternNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s} ${currency}` : s;
}

export type DateRangeFilters = {
  dateFrom: string;
  dateTo: string;
};

type DateRangeBarProps = {
  dateFrom: string;
  dateTo: string;
  onChange: (next: Partial<DateRangeFilters>) => void;
  onApply: () => void;
  loading?: boolean;
  children?: React.ReactNode;
  extra?: React.ReactNode;
};

export function StatementDateRangeBar({
  dateFrom,
  dateTo,
  onChange,
  onApply,
  loading,
  children,
  extra,
}: DateRangeBarProps) {
  return (
    <div className="card p-3 flex flex-wrap gap-2 items-end">
      <label className="text-sm">
        <span className="block text-gray-600 mb-1">من تاريخ</span>
        <input
          type="date"
          className="form-input"
          value={dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
        />
      </label>
      <label className="text-sm">
        <span className="block text-gray-600 mb-1">إلى تاريخ</span>
        <input
          type="date"
          className="form-input"
          value={dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
        />
      </label>
      {children}
      {extra}
      <button type="button" className="toolbar-btn primary" disabled={loading} onClick={onApply}>
        {loading ? 'جاري التحميل…' : 'عرض الكشف'}
      </button>
    </div>
  );
}

export function StatementSummaryGrid({
  items,
}: {
  items: Array<{ label: string; value: string; highlight?: boolean }>;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.label} className={`card p-3 text-sm ${item.highlight ? 'border-amber-300 bg-amber-50' : ''}`}>
          <div className="text-gray-500">{item.label}</div>
          <div className="font-bold text-base mt-1">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
