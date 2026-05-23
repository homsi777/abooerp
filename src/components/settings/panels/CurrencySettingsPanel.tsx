import RequirePermission from '../../../components/RequirePermission';
import CurrenciesSettingsPage from '../../../pages/settings/Currencies';
import ExchangeRatesSettingsPage from '../../../pages/settings/ExchangeRates';

export default function CurrencySettingsPanel() {
  return (
    <div className="space-y-4">
      <RequirePermission
        permission="settings.currencies.read"
        fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات العملات.</div>}
      >
        <CurrenciesSettingsPage />
      </RequirePermission>
      <RequirePermission
        permission="settings.exchangeRates.read"
        fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات أسعار الصرف.</div>}
      >
        <ExchangeRatesSettingsPage />
      </RequirePermission>
    </div>
  );
}
