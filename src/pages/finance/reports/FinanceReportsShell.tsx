import { NavLink, Outlet } from 'react-router-dom';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `toolbar-btn ${isActive ? 'primary' : ''}`;

export default function FinanceReportsShell() {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-xl font-bold">التقارير المالية</h2>
        <div className="flex gap-2 flex-wrap">
          <NavLink to="/finance/reports" end className={tabClass}>
            ملخص مالي
          </NavLink>
          <NavLink to="/finance/reports/profit-loss" className={tabClass}>
            أرباح وخسائر
          </NavLink>
          <NavLink to="/finance/trial-balance" className={tabClass}>
            ميزان المراجعة
          </NavLink>
          <NavLink to="/finance/balance-sheet" className={tabClass}>
            قائمة المركز المالي
          </NavLink>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
