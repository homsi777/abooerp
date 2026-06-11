import { type KeyboardEvent, useMemo, useState } from 'react';
import type { BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import {
  filterCashboxesByQuery,
  formatCashboxLabel,
  resolveCashboxFromQuery,
} from '../../lib/finance/voucherGridHelpers';

type Props = {
  boxes: BackendCashboxRecord[];
  cashboxId: string;
  cashboxText: string;
  rowIndex: number;
  disabled?: boolean;
  onChange: (patch: { cashboxId: string; cashboxText: string }) => void;
  onGridKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export default function VoucherCashboxCombo({
  boxes,
  cashboxId,
  cashboxText,
  rowIndex,
  disabled,
  onChange,
  onGridKeyDown,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const resolved = boxes.find((b) => b.id === cashboxId);
  const displayText = cashboxText || (resolved ? formatCashboxLabel(resolved) : '');

  const filtered = useMemo(() => filterCashboxesByQuery(boxes, displayText), [boxes, displayText]);

  const pick = (box: BackendCashboxRecord) => {
    onChange({ cashboxId: box.id, cashboxText: formatCashboxLabel(box) });
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (open && filtered.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActiveIdx((prev) => {
        if (e.key === 'ArrowDown') return Math.min(prev + 1, filtered.length - 1);
        return Math.max(prev - 1, 0);
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && filtered[activeIdx]) {
        pick(filtered[activeIdx]);
        onGridKeyDown(e);
        return;
      }
      const match = resolveCashboxFromQuery(displayText, boxes);
      if (match) pick(match);
      setOpen(false);
      onGridKeyDown(e);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setOpen(false);
      onGridKeyDown(e);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      onGridKeyDown(e);
    }
  };

  return (
    <div className="voucher-cashbox-combo relative">
      <input
        type="text"
        className="voucher-grid-input"
        value={displayText}
        disabled={disabled}
        placeholder="ابحث بالرمز أو الاسم أو الوكيل"
        autoComplete="off"
        data-voucher-row={rowIndex}
        data-voucher-field="cashbox"
        onChange={(e) => {
          const text = e.target.value;
          const match = resolveCashboxFromQuery(text, boxes);
          onChange({ cashboxText: text, cashboxId: match?.id ?? '' });
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && !disabled ? (
        <ul className="voucher-cashbox-dropdown" dir="rtl">
          {filtered.map((box, idx) => (
            <li
              key={box.id}
              className={idx === activeIdx ? 'active' : ''}
              onMouseDown={(ev) => {
                ev.preventDefault();
                pick(box);
              }}
            >
              <span>{formatCashboxLabel(box)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
