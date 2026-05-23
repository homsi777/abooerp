import { Link } from 'react-router-dom';

/**
 * صفحة الموظفين أُدمجت في قسم "الرواتب والسلف"
 * حيث يمكن إدارة الموظفين وكشف الرواتب والسلف من مكان واحد.
 */
export default function FinanceEmployees() {
  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-xl font-bold">الموظفون</h2>
      <div className="card space-y-3 text-gray-700 text-sm leading-relaxed">
        <p>
          إدارة الموظفين والرواتب والسلف متاحة الآن من قسم واحد متكامل:
        </p>
        <Link to="/finance/salaries" className="toolbar-btn primary inline-block">
          انتقل إلى الرواتب والسلف ←
        </Link>
        <p className="text-xs text-gray-500 mt-2">
          يمكنك من هناك: إضافة موظفين، تسجيل كشف الرواتب الشهري، منح سلف وتتبع سدادها.
        </p>
      </div>
    </div>
  );
}
