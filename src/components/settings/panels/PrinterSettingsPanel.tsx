import RequirePermission from '../../../components/RequirePermission';
import PrintersSettingsPage from '../../../pages/settings/Printers';
import PrinterRoutesSettingsPage from '../../../pages/settings/PrinterRoutes';

export default function PrinterSettingsPanel() {
  return (
    <RequirePermission
      permission="settings.printers.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات الطابعات.</div>}
    >
      <div className="space-y-4">
        <PrintersSettingsPage />
        <PrinterRoutesSettingsPage />
      </div>
    </RequirePermission>
  );
}
