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
          مركز موحّد لكل الكشوف — اختر القسم ثم نوع الكشف، ثم حدّد الفترة والطرف.
        </p>
        {active && (
          <p className="text-xs text-primary-700 font-medium mt-2">
            {active.group.label} — {active.item.label}
          </p>
        )}
      </div>

      <div
        className="card p-3 border border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-white shadow-sm"
        dir="rtl"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {STATEMENT_NAV.map((group) => {
            const value = groupActivePath(location.pathname, group);
            const isGroupActive = Boolean(value);
            const sole = group.items.length === 1 ? group.items[0] : null;

            return (
              <div
                key={group.id}
                className={`block text-sm rounded-lg p-2 transition-colors ${
                  isGroupActive ? 'bg-primary/5 ring-1 ring-primary/25' : 'bg-white/60'
                }`}
              >
                <span className="block text-xs font-bold text-slate-500 mb-1.5">{group.label}</span>
                {sole ? (
                  <button
                    type="button"
                    className={`form-select w-full text-sm text-right cursor-pointer ${
                      isGroupActive ? 'border-primary bg-primary/10 font-semibold text-primary-800' : ''
                    }`}
                    onClick={() => navigate(sole.path)}
                  >
                    {sole.label}
                  </button>
                ) : (
                  <select
                    className="form-select w-full text-sm"
                    value={value}
                    onChange={(e) => {
                      const path = e.target.value;
                      if (path) navigate(path);
                    }}
                    aria-label={group.label}
                  >
                    <option value="" disabled>
                      اختر من {group.label}
                    </option>
                    {group.items.map((item) => (
                      <option key={item.id} value={item.path}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
