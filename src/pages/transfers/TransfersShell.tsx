import { NavLink, Outlet } from 'react-router-dom';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `toolbar-btn ${isActive ? 'primary' : ''}`;

export default function TransfersShell() {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-xl font-bold">قسم الحوالات</h2>
        <div className="flex gap-2 flex-wrap">
          <NavLink to="/transfers" end className={tabClass}>
            قائمة الحوالات
          </NavLink>
          <NavLink to="/transfers/reports" className={tabClass}>
            تقارير الحوالات
          </NavLink>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
