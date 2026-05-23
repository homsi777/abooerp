/**
 * SmartPartyInput — unified sender/receiver picker.
 *
 * Searches both quick contacts (senders_receivers) and registered customers
 * via /api/v1/parties/smart-search, showing type badges for each result.
 *
 * When the user types a name that doesn't exist and presses Enter,
 * the `onAddNew` callback fires — which should create a quick contact
 * (same as the existing behaviour), NOT a full customer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { customersGateway, type SmartPartyResult } from '../lib/api/customersGateway';
import { httpClient } from '../lib/api/httpClient';

export type SelectedParty = {
  type: 'quick_contact' | 'customer' | 'account_customer' | 'agent';
  id: string;
  name: string;
  phone?: string | null;
  source_table: 'senders_receivers' | 'customers' | 'agents';
  is_account_customer?: boolean;
};

interface SmartPartyInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when an existing party is selected from dropdown */
  onSelect?: (party: SelectedParty) => void;
  /** Called when Enter is pressed on a name with no match — create quick contact */
  onAddNew?: (name: string) => void;
  restrictToCustomers?: boolean;
  allowAddNew?: boolean;
  includeAgents?: boolean;
  allowQuickContacts?: boolean;
  placeholder?: string;
  label?: string;
  id?: string;
  nextFieldId?: string;
  disabled?: boolean;
  'data-ledger-field'?: string;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const BADGE_CLASSES: Record<string, string> = {
  account_customer: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  customer: 'bg-blue-100 text-blue-700 border border-blue-300',
  quick_contact: 'bg-gray-100 text-gray-600 border border-gray-300',
  agent: 'bg-violet-100 text-violet-700 border border-violet-300',
};

type AgentLookupRow = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  is_active?: boolean;
};

type UnifiedResult = {
  id: string;
  type: SelectedParty['type'];
  display_name: string;
  phone?: string | null;
  badge_label: string;
  source_table: SelectedParty['source_table'];
  is_account_customer?: boolean | null;
};

export default function SmartPartyInput({
  value,
  onChange,
  onSelect,
  onAddNew,
  restrictToCustomers = false,
  allowAddNew = true,
  includeAgents = false,
  allowQuickContacts = true,
  placeholder = 'اكتب اسم المرسل...',
  label,
  id,
  nextFieldId,
  disabled = false,
  onFocus,
  onKeyDown,
  ...rest
}: SmartPartyInputProps) {
  const [results, setResults] = useState<UnifiedResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentsRef = useRef<AgentLookupRow[] | null>(null);

  // Click outside closes dropdown
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const search = useCallback((q: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!q.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const rawCustomers = await customersGateway.smartSearch(q.trim());
        const mappedCustomers: UnifiedResult[] = rawCustomers
          .filter((r) => (restrictToCustomers ? r.source_table === 'customers' : true))
          .filter((r) => (allowQuickContacts ? true : r.type !== 'quick_contact'))
          .map((r) => ({
            id: r.id,
            type: r.type,
            display_name: r.display_name,
            phone: r.phone,
            badge_label: r.badge_label,
            source_table: r.source_table,
            is_account_customer: r.is_account_customer,
          }));

        let mappedAgents: UnifiedResult[] = [];
        if (includeAgents) {
          if (!agentsRef.current) {
            const agents = await httpClient.get<AgentLookupRow[]>('/agents');
            agentsRef.current = agents.filter((a) => a.is_active !== false);
          }
          const needle = q.trim().toLowerCase();
          mappedAgents = (agentsRef.current ?? [])
            .filter((a) => `${a.name} ${a.code} ${a.phone ?? ''}`.toLowerCase().includes(needle))
            .slice(0, 30)
            .map((a) => ({
              id: a.id,
              type: 'agent',
              display_name: a.name,
              phone: a.phone ?? null,
              badge_label: 'وكيل',
              source_table: 'agents',
            }));
        }

        const merged = [...mappedAgents, ...mappedCustomers];
        setResults(merged);
        setIsOpen(merged.length > 0);
        setActiveIdx(-1);
      } catch {
        setResults([]);
        setIsOpen(false);
      }
    }, 250);
  }, [allowQuickContacts, includeAgents, restrictToCustomers]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    search(v);
  };

  const handleSelect = (item: UnifiedResult) => {
    onChange(item.display_name);
    setIsOpen(false);
    setResults([]);
    onSelect?.({
      type: item.type,
      id: item.id,
      name: item.display_name,
      phone: item.phone,
      source_table: item.source_table,
      is_account_customer: item.is_account_customer ?? false,
    });
    focusNextField();
  };

  const focusNextField = () => {
    if (nextFieldId) {
      const el = document.getElementById(nextFieldId) as HTMLInputElement | null;
      if (el) { el.focus(); return; }
    }
    const inputs = document.querySelectorAll<HTMLElement>('[data-ledger-field="true"], input:not([disabled]), select:not([disabled])');
    const arr = Array.from(inputs);
    const current = document.getElementById(id ?? '') ?? wrapperRef.current?.querySelector('input');
    if (!current) return;
    const idx = arr.indexOf(current as HTMLElement);
    arr[idx + 1]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && activeIdx >= 0 && results[activeIdx]) {
        handleSelect(results[activeIdx]);
        return;
      }
      if (isOpen && results.length > 0) {
        handleSelect(results[0]);
        return;
      }
      // No match — create quick contact
      if (allowAddNew && value.trim()) {
        setIsOpen(false);
        onAddNew?.(value.trim());
      }
      focusNextField();
      return;
    }
    if (e.key === 'Tab') {
      setIsOpen(false);
    }
    onKeyDown?.(e);
  };

  const showAddOption = allowAddNew && value.trim() &&
    results.every((r) => r.display_name.toLowerCase() !== value.toLowerCase());

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="form-label" htmlFor={id}>{label}</label>}
      <input
        id={id}
        type="text"
        className="form-input w-full"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        {...(rest['data-ledger-field'] ? { 'data-ledger-field': rest['data-ledger-field'] } : {})}
      />
      {isOpen && (
        <ul
          className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-auto"
          style={{ minWidth: '220px' }}
          dir="rtl"
        >
          {results.map((item, idx) => (
            <li
              key={`${item.source_table}-${item.id}`}
              className={`flex items-center justify-between px-3 py-2 cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50 ${
                idx === activeIdx ? 'bg-blue-50' : ''
              }`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
            >
              <span className="font-medium text-gray-900 truncate">{item.display_name}</span>
              <div className="flex items-center gap-1.5 mr-2 shrink-0">
                {item.phone && (
                  <span className="text-xs text-gray-400 hidden sm:inline">{item.phone}</span>
                )}
                <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${BADGE_CLASSES[item.type] ?? BADGE_CLASSES.quick_contact}`}>
                  {item.badge_label}
                </span>
              </div>
            </li>
          ))}
          {showAddOption && (
            <li
              className="px-3 py-2 cursor-pointer hover:bg-green-50 bg-green-50 text-green-700 font-medium"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsOpen(false);
                onAddNew?.(value.trim());
                focusNextField();
              }}
            >
              + إضافة زبون سريع: {value}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
