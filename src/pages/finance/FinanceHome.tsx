import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthProvider';

interface FinanceCard {
  icon: string;
  label: string;
  path: string;
  permission: string;
  built: boolean;
}

interface FinanceGroup {
  title: string;
  cards: FinanceCard[];
}

// Every route below was verified against the current App.tsx route table
// before this screen was built — "built: false" means no destination page
// exists yet (custody/shifts and suppliers), everything else routes to a
// real, already-working screen.
const GROUPS: FinanceGroup[] = [
  {
    title: 'العمليات اليومية',
    cards: [
      { icon: '🧾', label: 'السندات', path: '/finance/vouchers', permission: 'finance.vouchers.view', built: true },
      { icon: '⏱️', label: 'الورديات والعهد', path: '/finance/custody', permission: 'finance.read', built: true },
      { icon: '👤', label: 'الأطراف والعملاء', path: '/senders-receivers', permission: 'parties.view', built: true },
      { icon: '🚚', label: 'الموردون', path: '/finance/suppliers', permission: 'finance.read', built: false },
      { icon: '🔄', label: 'الحوالات', path: '/transfers', permission: 'transfers.read', built: true },
      { icon: '💵', label: 'الصناديق', path: '/finance/cashboxes', permission: 'finance.cashboxes.view', built: true },
      { icon: '🚚', label: 'السائقين', path: '/finance/drivers', permission: 'drivers.view', built: true },
    ],
  },
  {
    title: 'الحركات والتسويات',
    cards: [
      { icon: '🖨️', label: 'كشف — مركز الكشوف', path: '/finance/statements', permission: 'finance.read', built: true },
      { icon: '🤝', label: 'مطابقة ثنائية', path: '/finance/bilateral-reconciliation', permission: 'finance.read', built: true },
      { icon: '💸', label: 'المصاريف', path: '/finance/expenses', permission: 'finance.read', built: true },
      { icon: '🧑‍💼', label: 'الرواتب والسلف', path: '/finance/salaries', permission: 'finance.read', built: true },
    ],
  },
  {
    title: 'الدفاتر والتقارير',
    cards: [
      { icon: '📘', label: 'دفتر الأستاذ', path: '/finance/general-ledger', permission: 'finance.read', built: true },
      { icon: '📅', label: 'دفتر اليومية', path: '/finance/daily-journal', permission: 'finance.read', built: true },
      { icon: '⚖️', label: 'ميزان المراجعة', path: '/finance/trial-balance', permission: 'finance.read', built: true },
      { icon: '📊', label: 'قائمة المركز المالي', path: '/finance/balance-sheet', permission: 'finance.read', built: true },
      { icon: '🔒', label: 'إقفال الفترات', path: '/finance/period-closing', permission: 'finance.read', built: true },
      { icon: '📈', label: 'التقارير المالية', path: '/finance/reports', permission: 'finance.read', built: true },
      { icon: '💹', label: 'أرباح وخسائر', path: '/finance/reports/profit-loss', permission: 'finance.read', built: true },
      { icon: '📦', label: 'الجرد الشهري', path: '/finance/monthly-inventory', permission: 'finance.read', built: true },
      { icon: '🚛', label: 'تقرير أرباح السيارة', path: '/finance/vehicle-trip-report', permission: 'finance.read', built: true },
      { icon: '◎', label: 'استلام شحنات المحافظات', path: '/finance/provincial-receiving', permission: 'finance.read', built: true },
      { icon: '🗓️', label: 'التقرير الشهري — الصندوق العام', path: '/finance/company-monthly-report', permission: 'finance.read', built: true },
      { icon: '📦', label: 'تسعير البضائع', path: '/finance/goods-pricing', permission: 'finance.read', built: true },
    ],
  },
];

function FinanceCardTile({ card }: { card: FinanceCard }) {
  const borderColor = card.built ? '#22c55e' : '#e5e7eb';
  const statusColor = card.built ? '#15803d' : '#9ca3af';
  const statusText = card.built ? 'جاهز للتجربة' : 'قيد التطوير';

  return (
    <Link
      to={card.path}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        textAlign: 'right',
        gap: '8px',
        minHeight: '150px',
        padding: '22px',
        background: '#fff',
        border: `2px solid ${borderColor}`,
        borderRadius: '12px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(15,23,42,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ fontSize: '34px' }}>{card.icon}</div>
      <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{card.label}</div>
      <div style={{ fontSize: '12.5px', fontWeight: 700, color: statusColor, marginTop: 'auto' }}>{statusText}</div>
    </Link>
  );
}

export default function FinanceHome() {
  const { hasPermission } = useAuth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', paddingBottom: '24px' }}>
      <div>
        <h1 style={{ fontSize: '23px', fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>
          الذمم والمالية
        </h1>
        <p style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>
          اختاري القسم من البطاقات أدناه
        </p>
      </div>

      {GROUPS.map((group) => {
        const visibleCards = group.cards.filter((card) => hasPermission(card.permission));
        if (visibleCards.length === 0) return null;
        return (
          <div key={group.title}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#374151', margin: '0 0 12px' }}>
              {group.title}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '14px',
              }}
            >
              {visibleCards.map((card) => (
                <FinanceCardTile key={card.path} card={card} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
