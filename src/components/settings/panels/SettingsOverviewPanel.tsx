import { useEffect, useMemo, useState } from 'react';
import { getExchangeRatesToUsd } from '../../../lib/currency/currency';
import { httpClient } from '../../../lib/api/httpClient';
import { useAuth } from '../../../context/AuthProvider';

type PrinterRecord = { id: string };
type BackupDiagnostics = { latestBackupAt: string | null };
type BranchRecord = { id: string; name: string; is_active?: boolean };
type CurrencyRecord = { code: string; is_base?: boolean };

export default function SettingsOverviewPanel() {
  const { activeBranchId } = useAuth();
  const rates = getExchangeRatesToUsd();
  const [printerCount, setPrinterCount] = useState(0);
  const [lastBackupAt, setLastBackupAt] = useState('-');
  const [activeBranchName, setActiveBranchName] = useState('-');
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [baseCurrency, setBaseCurrency] = useState('USD');

  useEffect(() => {
    httpClient
      .get<PrinterRecord[]>('/printers')
      .then((rows) => setPrinterCount(rows.length))
      .catch(() => setPrinterCount(0));

    httpClient
      .get<BackupDiagnostics>('/backup/diagnostics')
      .then((diag) => setLastBackupAt(diag.latestBackupAt ?? '-'))
      .catch(() => setLastBackupAt('-'));

    httpClient
      .get<BranchRecord[]>('/branches?includeInactive=true')
      .then((rows) => {
        const b = rows.find((r) => r.id === activeBranchId);
        setActiveBranchName(b?.name ?? '-');
      })
      .catch(() => setActiveBranchName('-'));

    httpClient
      .get<CurrencyRecord[]>('/currencies')
      .then((rows) => {
        const base = rows.find((c) => c.is_base);
        if (base?.code) setBaseCurrency(base.code);
      })
      .catch(() => {});

    httpClient
      .get<{ id: string }[]>('/users')
      .then((rows) => setUsersCount(rows.length))
      .catch(() => setUsersCount(null));
  }, [activeBranchId]);

  const cards = useMemo(
    () => [
      { label: 'Base Currency', value: baseCurrency },
      { label: 'Exchange Rates Status', value: `SYP:${rates.SYP} | TRY:${rates.TRY}` },
      { label: 'Active Branch', value: activeBranchName },
      { label: 'Configured Printers Count', value: String(printerCount) },
      { label: 'Users Count', value: usersCount === null ? '—' : String(usersCount) },
      { label: 'Last Backup Date', value: lastBackupAt },
      { label: 'System Version', value: '1.0.0' },
    ],
    [activeBranchName, baseCurrency, lastBackupAt, printerCount, rates.SYP, rates.TRY, usersCount]
  );

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">لوحة ملخص الإعدادات</div>
        <p className="text-sm text-gray-600">اختر قسمًا من القائمة اليمنى لإدارة إعدادات النظام بشكل تفصيلي.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((card) => (
          <div className="stat-card" key={card.label}>
            <div className="stat-value" style={{ fontSize: '15px' }}>{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
