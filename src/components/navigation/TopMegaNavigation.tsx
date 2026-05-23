import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthProvider';

// ── Module tree ───────────────────────────────────────────────────────────────
interface NavChild {
  label: string;
  path: string;
  icon?: string;
  permission?: string;
  divider?: boolean;
}

interface NavModule {
  id: string;
  label: string;
  icon: string;
  path?: string;
  permission?: string;
  children?: NavChild[];
}

const NAV_MODULES: NavModule[] = [
  { id: 'home', label: 'الرئيسية', icon: '🏠', path: '/dashboard' },
  { id: 'transfers', label: 'الحوالات', icon: '🔄', path: '/transfers', permission: 'transfers.read' },
  {
    id: 'shipping', label: 'الشحن', icon: '📦',
    children: [
      { label: 'دفتر إدخال سريع', path: '/shipment-quick-ledger', icon: '▦', permission: 'shipments.write' },
      { label: 'قائمة الشحنات', path: '/shipments', icon: '📋', permission: 'shipments.read' },
      { label: 'تحميل الشحنات', path: '/manifest', icon: '🚚', permission: 'manifests.read' },
      { label: 'المراكز', path: '/centers', icon: '◎', permission: 'deliveries.read' },
      { label: 'لصاقات الشحن', path: '/print-preview', icon: '🖨️', permission: 'shipping.label.read' },
    ],
  },
  { id: 'delivery', label: 'التسليم', icon: '📤', path: '/delivery', permission: 'deliveries.read' },
  { id: 'agents', label: 'الوكلاء', icon: '🤝', path: '/agents', permission: 'settings.agents.read' },
  { id: 'branches', label: 'الفروع', icon: '🏢', path: '/branches', permission: 'settings.branches.read' },
  { id: 'customers', label: 'العملاء', icon: '👥', path: '/customers', permission: 'customers.view' },
  { id: 'agent-portal', label: 'بوابة الوكيل', icon: '📦', path: '/agent-portal', permission: 'agent_portal.view' },
  { id: 'permissions', label: 'مركز الصلاحيات', icon: '🛡️', path: '/permissions', permission: 'permissions.view' },
  { id: 'admin-events', label: 'الأحداث', icon: '📜', path: '/admin/events', permission: 'admin.events.read' },
  { id: 'parties', label: 'الأطراف والعملاء', icon: '◇', path: '/senders-receivers', permission: 'parties.view' },
  {
    id: 'vehicles', label: 'المركبات والسائقون', icon: '🚛',
    children: [
      { label: 'المركبات', path: '/vehicles', icon: '🚚', permission: 'settings.system.read' },
      { label: 'السائقون', path: '/drivers', icon: '👤', permission: 'settings.system.read' },
    ],
  },
  {
    id: 'finance', label: 'المالية', icon: '💰',
    children: [
      { label: 'السندات', path: '/finance/vouchers', icon: '📜', permission: 'finance.vouchers.view' },
      { label: 'الصناديق', path: '/finance/cashboxes', icon: '💵', permission: 'finance.cashboxes.view' },
      { label: 'المصاريف', path: '/finance/expenses', icon: '💳', permission: 'finance.read' },
      { label: 'الرواتب والسلف', path: '/finance/salaries', icon: '👨‍💼', permission: 'finance.read' },
      { label: 'تعريف الأسعار', path: '/finance/tariffs', icon: '💲', permission: 'finance.read' },
      { label: 'الدائن والمدين', path: '/finance/debit-credit', icon: '↔', permission: 'finance.read' },
      { label: 'كشف حساب تفصيلي', path: '/finance/account-statement', icon: '≣', permission: 'finance.read' },
      { label: 'كشف مبالغ التسليم', path: '/finance/agent-cod-statement', icon: '◈', permission: 'finance.read' },
      { label: 'التقارير المالية', path: '/finance/reports', icon: '📈', permission: 'finance.read' },
      { label: 'تقارير قبل التسليم', path: '/finance/delivery-reports', icon: '✅', permission: 'finance.read' },
    ],
  },
  { id: 'reports', label: 'التقارير', icon: '📊', path: '/reports', permission: 'reports.view' },
  {
    id: 'settings', label: 'الإعدادات', icon: '⚙️',
    children: [
      { label: 'معلومات الشركة', path: '/settings/company', icon: '🏢', permission: 'settings.system.read' },
      { label: 'المستخدمون والصلاحيات', path: '/settings/users_roles', icon: '👤', permission: 'permissions.view' },
      { label: 'العملات وأسعار الصرف', path: '/settings/currencies', icon: '💱', permission: 'settings.currencies.read' },
      { label: 'الطابعات', path: '/settings/printers', icon: '🖨️', permission: 'settings.printers.read', divider: true },
      { label: 'الأجهزة المرتبطة', path: '/settings/linked_devices', icon: '🖥️', permission: 'settings.devices.read' },
      { label: 'النسخ الاحتياطي', path: '/settings/backup', icon: '💾', permission: 'settings.backup.read' },
      { label: 'سجل النشاط', path: '/settings/audit_log', icon: '📋', permission: 'settings.audit.read', divider: true },
      { label: 'إعدادات تيليجرام', path: '/settings/telegram', icon: '✈️', permission: 'settings.telegram.read' },
    ],
  },
];

/** مدخل بيانات: شحن وتسليم وحوالات (حسب الصلاحية) ومرافق؛ بدون مركز صلاحيات وإعدادات عامة؛ أسعار ضمن قائمة الشحن. */
function buildNavDataEntry(): NavModule[] {
  const excluded = new Set(['finance', 'permissions', 'settings', 'agent-portal']);
  return NAV_MODULES.filter((m) => !excluded.has(m.id)).map((mod) => {
    if (mod.id === 'vehicles' && mod.children) {
      return {
        ...mod,
        children: [
          { label: 'المركبات', path: '/vehicles', icon: '🚚', permission: 'vehicles.view' },
          { label: 'السائقون', path: '/drivers', icon: '👤', permission: 'drivers.view' },
        ],
      };
    }
    if (mod.id === 'shipping' && mod.children) {
      return {
        ...mod,
        children: [
          ...mod.children,
          { label: 'تعريف الأسعار', path: '/finance/tariffs', icon: '💲', permission: 'finance.read' },
        ],
      };
    }
    return mod;
  });
}

const NAV_DATA_ENTRY: NavModule[] = buildNavDataEntry();

/** محاسب: مالية + حوالات + تقارير (بدون قوائم الشحن التشغيلية في الشريط). */
const NAV_ACCOUNTANT: NavModule[] = [
  { id: 'home', label: 'الرئيسية', icon: '🏠', path: '/dashboard' },
  ...(NAV_MODULES.filter((m) => m.id === 'transfers')),
  ...(NAV_MODULES.filter((m) => m.id === 'finance')),
  ...(NAV_MODULES.filter((m) => m.id === 'reports')),
];

/** Mini-ERP navigation for logged-in agent users (scoped operational modules only). */
const NAV_MODULES_AGENT: NavModule[] = [
  {
    id: 'agent-home',
    label: 'لوحة الوكيل',
    icon: '📊',
    path: '/agent-portal',
    permission: 'agent_portal.view',
  },
  {
    id: 'shipping', label: 'الشحن', icon: '📦',
    children: [
      { label: 'دفتر إدخال الشحن', path: '/shipment-quick-ledger', icon: '▦', permission: 'shipments.write' },
      { label: 'قائمة الشحنات', path: '/shipments', icon: '📋', permission: 'shipments.read' },
    ],
  },
  {
    id: 'delivery', label: 'التسليم', icon: '📤',
    children: [
      { label: 'شحنات بانتظار التسليم', path: '/delivery-queue/pending', icon: '⏳', permission: 'deliveries.read' },
      { label: 'شحنات خارجة للتسليم', path: '/delivery-queue/out', icon: '🚚', permission: 'deliveries.read' },
      { label: 'شحنات مسلمة', path: '/delivery-queue/done', icon: '✅', permission: 'deliveries.read' },
      { label: 'مرتجعات', path: '/delivery-queue/returns', icon: '↩️', permission: 'deliveries.read' },
    ],
  },
  {
    id: 'parties', label: 'الأطراف والعملاء', icon: '◇',
    children: [
      { label: 'عملاء الوكيل / المرسلون والمستلمون', path: '/senders-receivers', icon: '👥', permission: 'parties.view' },
      { label: 'العملاء الدائمون', path: '/customers', icon: '👤', permission: 'customers.view' },
    ],
  },
  {
    id: 'vehicles', label: 'المركبات والسائقون', icon: '🚛',
    children: [
      { label: 'مركبات الوكيل', path: '/vehicles', icon: '🚚', permission: 'vehicles.view' },
      { label: 'سائقو الوكيل', path: '/drivers', icon: '👤', permission: 'drivers.view' },
    ],
  },
  {
    id: 'finance', label: 'ماليتي', icon: '💰',
    children: [
      { label: 'الصناديق الخاصة بي', path: '/finance/cashboxes', icon: '💵', permission: 'finance.cashboxes.view' },
      { label: 'سند قبض', path: '/finance/vouchers?new=receipt', icon: '📥', permission: 'finance.vouchers.view' },
      { label: 'سند دفع', path: '/finance/vouchers?new=payment', icon: '📤', permission: 'finance.vouchers.view' },
      { label: 'مصاريفي', path: '/finance/expenses', icon: '💳', permission: 'finance.read' },
      { label: 'مبالغ التسليم الخاصة بي', path: '/finance/agent-cod-statement', icon: '◈', permission: 'finance.read' },
    ],
  },
];

interface DropdownState {
  id: string;
  top: number;
  right: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TopMegaNavigation() {
  const { hasPermission, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => { setDropdown(null); }, [location.pathname]);

  useEffect(() => {
    if (!dropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const navContains = navRef.current?.contains(target);
      const dropEl = document.getElementById('top-nav-dropdown');
      const dropContains = dropEl?.contains(target);
      if (!navContains && !dropContains) setDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdown]);

  const isModuleActive = (mod: NavModule): boolean => {
    if (mod.path) return location.pathname === mod.path || location.pathname.startsWith(mod.path + '/');
    if (mod.children) {
      return mod.children.some(
        (c) => location.pathname === c.path || location.pathname.startsWith(c.path + '/'),
      );
    }
    return false;
  };

  const baseModules =
    user?.userType === 'agent'
      ? NAV_MODULES_AGENT
      : user?.role === 'data_entry'
        ? NAV_DATA_ENTRY
        : user?.role === 'accountant'
          ? NAV_ACCOUNTANT
          : NAV_MODULES;

  const visibleModules = baseModules.filter((mod) => {
    if (
      mod.id === 'home' &&
      user &&
      !['admin', 'general_manager', 'branch_manager', 'accountant', 'data_entry'].includes(user.role)
    ) {
      return false;
    }
    if (mod.permission && !hasPermission(mod.permission)) return false;
    if (mod.children) {
      const visible = mod.children.filter((c) => !c.permission || hasPermission(c.permission));
      return visible.length > 0;
    }
    return true;
  });

  const handleModuleClick = (mod: NavModule, e: React.MouseEvent<HTMLButtonElement>) => {
    if (mod.path) {
      navigate(mod.path);
      setDropdown(null);
    } else {
      if (dropdown?.id === mod.id) {
        setDropdown(null);
      } else {
        const rect = e.currentTarget.getBoundingClientRect();
        setDropdown({
          id: mod.id,
          top: rect.bottom + 4,
          // RTL: anchor to the right edge of the button
          right: window.innerWidth - rect.right,
        });
      }
    }
  };

  const handleChildClick = (child: NavChild) => {
    navigate(child.path);
    setDropdown(null);
  };

  const openModule = dropdown ? visibleModules.find((m) => m.id === dropdown.id) : null;
  const openChildren = (openModule?.children ?? []).filter((c) => !c.permission || hasPermission(c.permission));

  return (
    <>
      <nav
        ref={navRef}
        dir="rtl"
        style={{
          background: '#1e293b',
          borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: '2px',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          minHeight: '44px',
          position: 'relative',
          zIndex: 9999,
        }}
      >
        {visibleModules.map((mod) => {
          const active = isModuleActive(mod);
          const open = dropdown?.id === mod.id;

          return (
            <button
              key={mod.id}
              onClick={(e) => handleModuleClick(mod, e)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '0 12px', height: '44px',
                background: active ? 'rgba(99,102,241,.2)' : open ? 'rgba(255,255,255,.06)' : 'none',
                border: 'none', borderRadius: 0,
                color: active ? '#a5b4fc' : 'rgba(255,255,255,.75)',
                fontSize: '13px', fontWeight: active ? 600 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap',
                borderBottom: active ? '2px solid #818cf8' : '2px solid transparent',
                transition: 'background .15s, color .15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!active) Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,.06)', color: '#fff' });
              }}
              onMouseLeave={(e) => {
                if (!active && !open) Object.assign(e.currentTarget.style, { background: 'none', color: 'rgba(255,255,255,.75)' });
              }}
            >
              <span style={{ fontSize: '14px' }}>{mod.icon}</span>
              <span>{mod.label}</span>
              {mod.children && (
                <span style={{
                  fontSize: '9px', opacity: 0.5,
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform .2s',
                  marginRight: '2px',
                }}>▼</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Dropdown rendered via fixed positioning — completely outside the nav's overflow context */}
      {dropdown && openChildren.length > 0 && (
        <div
          id="top-nav-dropdown"
          dir="rtl"
          style={{
            position: 'fixed',
            top: dropdown.top,
            right: dropdown.right,
            minWidth: '210px',
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,.1)',
            borderRadius: '12px',
            padding: '6px',
            boxShadow: '0 16px 40px rgba(0,0,0,.6)',
            animation: 'fadeUp .15s ease both',
            zIndex: 99999,
          }}
        >
          {openChildren.map((child, idx) => (
            <div key={`${dropdown.id}-${idx}-${child.label}`}>
              {child.divider && idx > 0 && (
                <div style={{ height: '1px', background: 'rgba(255,255,255,.07)', margin: '4px 8px' }} />
              )}
              <button
                onClick={() => handleChildClick(child)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 14px', border: 'none',
                  borderRadius: '8px', cursor: 'pointer', textAlign: 'right',
                  color: location.pathname === child.path ? '#a5b4fc' : 'rgba(255,255,255,.8)',
                  fontSize: '13px',
                  background: location.pathname === child.path ? 'rgba(99,102,241,.15)' : 'none',
                } as React.CSSProperties}
                onMouseEnter={(e) => {
                  if (location.pathname !== child.path)
                    Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,.06)', color: '#fff' });
                }}
                onMouseLeave={(e) => {
                  if (location.pathname !== child.path)
                    Object.assign(e.currentTarget.style, { background: 'none', color: 'rgba(255,255,255,.8)' });
                }}
              >
                {child.icon && <span style={{ fontSize: '14px', minWidth: '18px' }}>{child.icon}</span>}
                <span>{child.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
