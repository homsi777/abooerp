import {
  type ServiceEndpoint,
  type EndpointStatus,
  type EndpointTestRecord,
} from '../../../lib/settings/systemNetworkStore';

interface ServiceEndpointsPanelProps {
  endpoints: ServiceEndpoint[];
  testLogs: EndpointTestRecord[];
  onChange: (endpoints: ServiceEndpoint[]) => void;
  onTestEndpoint: (id: string) => void;
  onClearLogs: () => void;
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

const testResultLabel: Record<EndpointTestRecord['result'], string> = {
  success: 'نجاح',
  warning: 'تنبيه',
  failed: 'فشل',
};

export default function ServiceEndpointsPanel({
  endpoints,
  testLogs,
  onChange,
  onTestEndpoint,
  onClearLogs,
}: ServiceEndpointsPanelProps) {
  const updateEndpoint = (id: string, patch: Partial<ServiceEndpoint>) => {
    onChange(endpoints.map((endpoint) => (endpoint.id === id ? { ...endpoint, ...patch } : endpoint)));
  };

  return (
    <div className="card">
      <div className="card-header">خدمات الشبكة وعناوينها</div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>الخدمة</th>
            <th>العنوان</th>
            <th>الحالة</th>
            <th>ملاحظات</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((endpoint) => (
            <tr key={endpoint.id}>
              <td>{endpoint.name}</td>
              <td>
                <input
                  className="form-input w-full"
                  value={endpoint.address}
                  onChange={(e) => updateEndpoint(endpoint.id, { address: e.target.value })}
                />
              </td>
              <td>
                <span className={`status-badge ${statusClass[endpoint.status]}`}>{statusLabel[endpoint.status]}</span>
              </td>
              <td>
                <input
                  className="form-input w-full"
                  value={endpoint.notes}
                  onChange={(e) => updateEndpoint(endpoint.id, { notes: e.target.value })}
                />
              </td>
              <td>
                <button className="toolbar-btn" onClick={() => onTestEndpoint(endpoint.id)}>اختبار</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card-header mt-4">سجل اختبارات الاتصال (آخر 20 محاولة)</div>
      <div className="flex justify-end mb-2">
        <button className="toolbar-btn" onClick={onClearLogs}>مسح السجل</button>
      </div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>الوقت</th>
            <th>الخدمة</th>
            <th>النتيجة</th>
            <th>زمن الاستجابة (مللي ث)</th>
            <th>المنفذ</th>
            <th>الملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {testLogs.slice(0, 20).map((log) => (
            <tr key={log.id}>
              <td>{log.testedAt}</td>
              <td>{log.endpointName}</td>
              <td>
                <span className={`status-badge ${
                  log.result === 'success'
                    ? 'bg-green-100 text-green-800'
                    : log.result === 'warning'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                }`}>
                  {testResultLabel[log.result]}
                </span>
              </td>
              <td>{log.responseTimeMs}</td>
              <td>{log.tester}</td>
              <td>{log.notes || '-'}</td>
            </tr>
          ))}
          {testLogs.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-gray-500">لا توجد اختبارات مسجلة بعد</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
