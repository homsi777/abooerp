import { useMemo } from 'react';
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { STATEMENT_NAV, findStatementNavItem, type StatementNavGroup } from './statementNav';

function groupActivePath(pathname: string, group: StatementNavGroup): string {
  const hit = group.items.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  return hit?.path ?? '';
}

export default function FinanceStatementsShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = useMemo(() => findStatementNavItem(location.pathname), [location.pathname]);

  if (location.pathname === '/finance/statements' || location.pathname === '/finance/statements/') {
    return <Navigate to="/finance/statements/parties/agent" replace />;
  }

  return (
    <div className="h-full flex flex-col min-h-0 gap-3">
      <div>
        <h2 className="text-xl font-bold">كشف</h2>
        <p className="text-sm text-gray-600 mt-1">
          مركز موحّد لكل الكشوف — اختاري القسم ثم نوع الكشف، ثم حدّدي الفترة والطرف.
        </p>
      </div>

      {/* Same large, high-contrast card language as the Finance hub (/finance) —
          replaces the previous tiny <select> dropdowns, which were the exact
          hard-to-read pattern this whole redesign was meant to fix. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {STATEMENT_NAV.map((group) => {
          const activePath = groupActivePath(location.pathname, group);
          return (
            <div key={group.id}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#374151', margin: '0 0 8px' }}>
                {group.label}
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                  gap: '10px',
                }}
              >
                {group.items.map((item) => {
                  const isActive = item.path === activePath;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.path)}
                      style={{
                        textAlign: 'right',
                        padding: '14px 16px',
                        fontSize: '14.5px',
                        fontWeight: isActive ? 700 : 600,
                        color: isActive ? '#1e40af' : '#111827',
                        background: isActive ? '#eff6ff' : '#fff',
                        border: `2px solid ${isActive ? '#1e40af' : '#e5e7eb'}`,
                        borderRadius: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {active && (
          <p className="text-xs text-primary-700 font-medium mb-2">
            {active.group.label} — {active.item.label}
          </p>
        )}
        <Outlet />
      </div>
    </div>
  );
}
