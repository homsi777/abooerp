import RequirePermission from '../../../components/RequirePermission';
import TerminologySettingsPage from '../../../pages/settings/Terminology';

export default function TerminologyPanel() {
  return (
    <RequirePermission
      permission="settings.terminology.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات المصطلحات.</div>}
    >
      <TerminologySettingsPage />
    </RequirePermission>
  );
}
