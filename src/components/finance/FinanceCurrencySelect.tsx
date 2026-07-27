import { FINANCE_CURRENCY_OPTIONS } from '../../lib/finance/financeArabicLabels';

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
};

export default function FinanceCurrencySelect({
  value,
  onChange,
  className = 'form-select',
  allowEmpty = false,
  emptyLabel = 'كل العملات',
}: Props) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {FINANCE_CURRENCY_OPTIONS.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  );
}
