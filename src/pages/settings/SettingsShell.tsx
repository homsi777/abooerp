import { NavLink, Outlet } from 'react-router-dom';

const sections = [
  { path: '/settings/company', label: 'معلومات الشركة' },
  { path: '/settings/printer', label: 'الطابعة الافتراضية' },
  { path: '/settings/exchange-rates', label: 'أسعار الصرف' },
  { path: '/settings/branches-agents', label: 'الفروع والوكلاء' },
  { path: '/settings/backup-restore', label: 'النسخ الاحتياطي' },
  { path: '/settings/roles-permissions', label: 'الأدوار والصلاحيات' },
  { path: '/settings/activity-log', label: 'سجل النشاط' },
  { path: '/settings/terminology', label: 'تخصيص المصطلحات' },
];

export default function SettingsShell() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">مركز التحكم بالنظام</h2>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        <div className="w-64 card overflow-auto">
          <div className="card-header">أقسام الإعدادات</div>
          <div className="space-y-1">
            {sections.map((section) => (
              <NavLink
                key={section.path}
                to={section.path}
                className={({ isActive }) =>
                  `block w-full text-right px-3 py-2 rounded ${isActive ? 'bg-primary text-white' : 'hover:bg-gray-100'}`
                }
                style={{ textDecoration: 'none' }}
              >
                {section.label}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
