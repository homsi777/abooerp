import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyLedgerDispatchDefinition } from '../lib/shipping/dailyLedgerDispatchGateway';

type LedgerDispatchComboboxProps = {
  value: string;
  dispatchId?: string;
  definitions: DailyLedgerDispatchDefinition[];
  disabled?: boolean;
  rowId: number;
  inputId?: string;
  onCommit: (dispatchId: string | undefined, dispatchNo: string) => void;
  onFocusRow?: () => void;
};

export default function LedgerDispatchCombobox({
  value,
  dispatchId,
  definitions,
  disabled = false,
  rowId,
  inputId,
  onCommit,
  onFocusRow,
}: LedgerDispatchComboboxProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value, dispatchId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = inputValue.trim();
    if (!q) return definitions;
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      return definitions.filter((item) => String(item.dispatch_no).startsWith(q) || item.dispatch_no === n);
    }
    return definitions.filter((item) => {
      const hay = `${item.dispatch_no} ${item.driver_label ?? ''} ${item.vehicle_label ?? ''}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [definitions, inputValue]);

  const commitSelection = (def: DailyLedgerDispatchDefinition | null) => {
    if (!def) {
      onCommit(undefined, '');
      setInputValue('');
      setIsOpen(false);
      return;
    }
    const label = String(def.dispatch_no);
    setInputValue(label);
    onCommit(def.id, label);
    setIsOpen(false);
  };

  const commitTypedValue = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      commitSelection(null);
      return;
    }
    if (!/^\d+$/.test(trimmed)) return;
    const no = Number(trimmed);
    const def = definitions.find((item) => item.dispatch_no === no);
    if (def) {
      commitSelection(def);
      return;
    }
    if (dispatchId && value === trimmed) return;
    setInputValue(value);
  };

  const focusNextField = (current: HTMLInputElement) => {
    const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));
    const idx = fields.indexOf(current);
    if (idx >= 0 && idx < fields.length - 1) {
      const next = fields[idx + 1];
      next.focus();
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
        next.select();
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && filtered.length) setIsOpen(true);
      setActiveIdx((prev) => Math.min(prev + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen && filtered.length) setIsOpen(true);
      setActiveIdx((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && activeIdx >= 0 && filtered[activeIdx]) {
        commitSelection(filtered[activeIdx]);
        focusNextField(e.currentTarget);
        return;
      }
      commitTypedValue();
      focusNextField(e.currentTarget);
      return;
    }
    if (e.key === 'Tab') {
      commitTypedValue();
      return;
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue(value);
    }
  };

  return (
    <div ref={wrapperRef} className="ledger-dispatch-combobox">
      <input
        id={inputId}
        data-ledger-field="true"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="ledger-dispatch-combobox-input"
        value={inputValue}
        disabled={disabled}
        placeholder="رقم"
        title="رقم الإرسالية — اكتب أو اختر من القائمة"
        aria-label={`إرسالية سطر ${rowId}`}
        aria-expanded={isOpen}
        aria-controls={`ledger-dispatch-list-${rowId}`}
        onFocus={() => {
          onFocusRow?.();
          if (definitions.length) setIsOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            commitTypedValue();
            setIsOpen(false);
          }, 120);
        }}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
          setActiveIdx(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen && filtered.length > 0 && !disabled ? (
        <ul id={`ledger-dispatch-list-${rowId}`} className="ledger-dispatch-combobox-menu" role="listbox">
          {filtered.map((item, index) => (
            <li
              key={item.id}
              role="option"
              aria-selected={index === activeIdx}
              className={index === activeIdx ? 'is-active' : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                commitSelection(item);
              }}
            >
              <strong>{item.dispatch_no}</strong>
              <span>{item.driver_label || '—'}</span>
              <span className="ledger-dispatch-combobox-vehicle">{item.vehicle_label || '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
