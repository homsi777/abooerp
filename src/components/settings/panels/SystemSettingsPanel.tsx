import RequirePermission from '../../../components/RequirePermission';
import SystemNetworkSettingsPage from '../../../pages/settings/SystemNetwork';

export default function SystemSettingsPanel() {
  return (
    <RequirePermission
      permission="settings.system.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات النظام.</div>}
    >
      <SystemNetworkSettingsPage />
    </RequirePermission>
  );
}
