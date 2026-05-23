import RequirePermission from '../../../components/RequirePermission';
import ShippingLabelPrintSettingsPage from '../../../pages/settings/ShippingLabelPrint';

export default function ShippingLabelPrintSettingsPanel() {
  return (
    <RequirePermission
      permission="settings.shippingLabel.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات لصاقة الشحن.</div>}
    >
      <ShippingLabelPrintSettingsPage />
    </RequirePermission>
  );
}
