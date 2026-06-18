import { useMemo } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { STATEMENT_NAV, findStatementNavItem } from './statementNav';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded text-sm ${isActive ? 'bg-primary text-white font-semibold' : 'text-gray-700 hover:bg-gray-100'}`;

export default function FinanceStatementsShell() {
  const location = useLocation();
  const active = useMemo(() => findStatementNavItem(location.pathname), [location.pathname]);

  if (location.pathname === '/finance/statements' || location.pathname === '/finance/statements/') {
    return <Navigate to="/finance/statements/parties/agent" replace />;
  }

  return (
    <div className="h-full flex flex-col min-h-0 gap-3">
      <div>
        <h2 className="text-xl font-bold">كشف</h2>
        <p className="text-sm text-gray-600 mt-1">
          مركز موحّد لكل الكشوف المالية والذمم والنقد — اختر النوع ثم الفترة والطرف.
        </p>
        {active && (
          <p className="text-xs text-gray-500 mt-1">
            {active.group.label} / {active.item.label}
          </p>
        )}
      </div>

      <div className="flex flex-1 min-h-0 gap-4 flex-col lg:flex-row">
        <aside className="card p-3 lg:w-56 shrink-0 overflow-auto max-h-[40vh] lg:max-h-none">
          <nav className="space-y-4">
            {STATEMENT_NAV.map((group) => (
              <div key={group.id}>
                <div className="text-xs font-bold text-gray-500 mb-1 px-1">{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.id} to={item.path} className={linkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
