export type StatementNavItem = {
  id: string;
  label: string;
  path: string;
};

export type StatementNavGroup = {
  id: string;
  label: string;
  items: StatementNavItem[];
};

export const STATEMENT_NAV: StatementNavGroup[] = [
  {
    id: 'parties',
    label: 'حسب الطرف',
    items: [
      { id: 'agent', label: 'كشف وكيل', path: '/finance/statements/parties/agent' },
      { id: 'customer', label: 'كشف عميل', path: '/finance/statements/parties/customer' },
      { id: 'sender-receiver', label: 'كشف مرسل / مستلم', path: '/finance/statements/parties/sender-receiver' },
    ],
  },
  {
    id: 'cash',
    label: 'نقد',
    items: [
      { id: 'cashbox', label: 'كشف صندوق', path: '/finance/statements/cash/cashbox' },
      { id: 'receipts', label: 'كشف سندات قبض', path: '/finance/statements/cash/receipts' },
      { id: 'payments', label: 'كشف سندات دفع', path: '/finance/statements/cash/payments' },
    ],
  },
  {
    id: 'shipping',
    label: 'شحن ودفتر',
    items: [
      { id: 'ledger-summary', label: 'ملخص يوم الدفتر', path: '/finance/statements/shipping/ledger-summary' },
      { id: 'shipments', label: 'شحنات بالتاريخ', path: '/finance/statements/shipping/shipments' },
      { id: 'cod', label: 'COD / تحصيل', path: '/finance/statements/shipping/cod' },
    ],
  },
  {
    id: 'hawala',
    label: 'حوالات',
    items: [{ id: 'hawala', label: 'كشف حوالات', path: '/finance/statements/hawala' }],
  },
  {
    id: 'reconciliation',
    label: 'مطابقة',
    items: [
      { id: 'agent-branch', label: 'وكيل ↔ فرع', path: '/finance/statements/reconciliation/agent-branch' },
      { id: 'ledger', label: 'دفتر ↔ ذمم', path: '/finance/statements/reconciliation/ledger' },
    ],
  },
];

export function findStatementNavItem(pathname: string): { group: StatementNavGroup; item: StatementNavItem } | null {
  for (const group of STATEMENT_NAV) {
    for (const item of group.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
        return { group, item };
      }
    }
  }
  return null;
}
