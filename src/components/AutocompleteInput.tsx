import { useState, useRef, useEffect } from 'react';

interface AutocompleteItem {
  id: number;
  name: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (item: AutocompleteItem) => void;
  onAddNew: (name: string) => void;
  items: AutocompleteItem[];
  placeholder?: string;
  label?: string;
  nextFieldId?: string;
  id?: string;
  disabled?: boolean;
  wrapperClassName?: string;
  inputClassName?: string;
  /** عند تمريره يُضاف data-ledger-field للـ wrapper (مثلاً للدفتر اليومي) */
  dataLedgerField?: boolean | 'true';
  onBlurInput?: () => void;
}

export default function AutocompleteInput({
  value,
  onChange,
  onSelect,
  onAddNew,
  items,
  placeholder = 'اكتب للبحث...',
  label,
  nextFieldId,
  id,
  disabled = false,
  wrapperClassName,
  inputClassName,
  dataLedgerField,
  onBlurInput,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredItems, setFilteredItems] = useState<AutocompleteItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [inputValue, setInputValue] = useState(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);

    if (newValue.trim()) {
      const q = newValue.trim().toLowerCase();
      const filtered = items.filter((item) => item.name.toLowerCase().includes(q));
      const pref = filtered.filter((item) => item.name.toLowerCase().startsWith(q));
      const rest = filtered.filter((item) => !item.name.toLowerCase().startsWith(q));
      setFilteredItems([...pref, ...rest]);
      setIsOpen(true);
      setActiveIdx(-1);
    } else {
      setIsOpen(false);
      setActiveIdx(-1);
    }
  };

  const handleSelect = (item: AutocompleteItem) => {
    setInputValue(item.name);
    onChange(item.name);
    onSelect(item);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const focusNext = () => {
      if (nextFieldId) {
        const nextInput = document.getElementById(nextFieldId) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (nextInput) {
          nextInput.focus();
          if (nextInput.tagName === 'INPUT' || nextInput.tagName === 'TEXTAREA') {
            nextInput.select();
          }
          return;
        }
      }
      const inputs = document.querySelectorAll('input, select, textarea');
      const currentIndex = Array.from(inputs).indexOf(e.currentTarget);
      if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
        const nextEl = inputs[currentIndex + 1] as HTMLElement;
        nextEl.focus();
        if (nextEl.tagName === 'INPUT' || nextEl.tagName === 'TEXTAREA') {
          (nextEl as HTMLInputElement).select();
        }
      }
    };

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) return;
      setActiveIdx((prev) => Math.min(prev + 1, filteredItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) return;
      setActiveIdx((prev) => Math.max(prev - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && activeIdx >= 0 && filteredItems[activeIdx]) {
        handleSelect(filteredItems[activeIdx]);
        focusNext();
        return;
      }
      setIsOpen(false);
      if (inputValue.trim()) {
        const exactMatch = items.find(
          (item) => item.name.toLowerCase() === inputValue.toLowerCase(),
        );
        if (exactMatch) {
          handleSelect(exactMatch);
        } else if (!filteredItems.length) {
          onAddNew(inputValue.trim());
        }
      }
      focusNext();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'Tab') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        focusNext();
      }
    }
  };

  const showAddOption = inputValue.trim() && 
    !items.some(item => item.name.toLowerCase() === inputValue.toLowerCase());

  return (
    <div className={`relative ${wrapperClassName ?? ''}`} ref={wrapperRef}>
      {label && <label className="form-label">{label}</label>}
      <input
        type="text"
        id={id}
        className={inputClassName ?? 'form-input w-full'}
        value={inputValue}
        disabled={disabled}
        {...(dataLedgerField ? { 'data-ledger-field': dataLedgerField === true ? 'true' : dataLedgerField } : {})}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (inputValue.trim()) {
            const q = inputValue.trim().toLowerCase();
            const filtered = items.filter((item) => item.name.toLowerCase().includes(q));
            const pref = filtered.filter((item) => item.name.toLowerCase().startsWith(q));
            const rest = filtered.filter((item) => !item.name.toLowerCase().startsWith(q));
            setFilteredItems([...pref, ...rest]);
            setIsOpen(true);
            setActiveIdx(-1);
          }
        }}
        onBlur={() => {
          setIsOpen(false);
          onBlurInput?.();
        }}
        placeholder={placeholder}
      />
      {isOpen && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredItems.map((item, idx) => (
            <li
              key={item.id}
              className={`px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-blue-50 ${
                idx === activeIdx ? 'bg-blue-50' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(item);
              }}
            >
              {item.name}
            </li>
          ))}
          {showAddOption && (
            <li
              className="px-3 py-2 cursor-pointer hover:bg-green-50 bg-green-50 text-green-700 font-medium border-b border-gray-100"
              onClick={() => {
                onAddNew(inputValue.trim());
                setIsOpen(false);
              }}
            >
              + إضافة: {inputValue}
            </li>
          )}
          {filteredItems.length === 0 && !showAddOption && (
            <li className="px-3 py-2 text-gray-500 text-center">
              لا توجد نتائج
            </li>
          )}
        </ul>
      )}
    </div>
  );
}