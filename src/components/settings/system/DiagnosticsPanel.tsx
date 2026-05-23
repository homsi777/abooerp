import { type DiagnosticsState, type EndpointStatus } from '../../../lib/settings/systemNetworkStore';

interface DiagnosticsPanelProps {
  diagnostics: DiagnosticsState;
  onTestConnectivity: () => void;
  onReadinessCheck: () => void;
  testing: boolean;
  checking: boolean;
}

const statusClass: Record<EndpointStatus, string> = {
  good: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  disconnected: 'bg-red-100 text-red-800',
  incomplete: 'bg-gray-100 text-gray-800',
};

const statusLabel: Record<EndpointStatus, string> = {
  good: 'جيد',
  warning: 'تنبيه',
  disconnected: 'غير متصل',
  incomplete: 'غير مكتمل',
};

export default function DiagnosticsPanel({
  diagnostics,
  onTestConnectivity,
  onReadinessCheck,
  testing,
  checking,
}: DiagnosticsPanelProps) {
  const rows = [
    { key: 'databaseConnection', label: 'اتصال قاعدة البيانات (عرضي)', value: diagnostics.databaseConnection },
    { key: 'localStorageStatus', label: 'حالة التخزين المحلي', value: diagnostics.localStorageStatus },
    { key: 'printerReadiness', label: 'جاهزية الطابعة', value: diagnostics.printerReadiness },
    { key: 'exchangeRatesAvailability', label: 'توافر أسعار التصريف', value: diagnostics.exchangeRatesAvailability },
    { key: 'branchConfigCompleteness', label: 'اكتمال إعداد الفروع', value: diagnostics.branchConfigCompleteness },
    { key: 'lastConnectivityResult', label: 'آخر نتيجة للاتصال', value: diagnostics.lastConnectivityResult },
  ];

  return (
    <div className="card">
      <div className="card-header">التشخيص والمتابعة</div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>العنصر</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td><span className={`status-badge ${statusClass[row.value]}`}>{statusLabel[row.value]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn" onClick={onTestConnectivity} disabled={testing}>
          {testing ? 'جاري اختبار الاتصال...' : 'اختبار الاتصال'}
        </button>
        <button className="toolbar-btn" onClick={onReadinessCheck} disabled={checking}>
          {checking ? 'جاري فحص الجاهزية...' : 'فحص الجاهزية'}
        </button>
      </div>
    </div>
  );
}
