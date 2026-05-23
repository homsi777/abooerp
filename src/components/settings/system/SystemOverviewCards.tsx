interface SystemOverviewCardsProps {
  currentMode: string;
  connectionType: string;
  networkStatus: string;
  branchesCount: number;
  lastConnectivityTestAt: string;
  environmentLabel: string;
}

export default function SystemOverviewCards({
  currentMode,
  connectionType,
  networkStatus,
  branchesCount,
  lastConnectivityTestAt,
  environmentLabel,
}: SystemOverviewCardsProps) {
  return (
    <div className="grid grid-cols-6 gap-3">
      <div className="stat-card">
        <div className="stat-value">{currentMode}</div>
        <div className="stat-label">وضع النظام الحالي</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{connectionType}</div>
        <div className="stat-label">نوع الاتصال</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{networkStatus}</div>
        <div className="stat-label">حالة الشبكة</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{branchesCount}</div>
        <div className="stat-label">عدد الفروع المعرفة</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ fontSize: '14px' }}>{lastConnectivityTestAt}</div>
        <div className="stat-label">آخر اختبار اتصال</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{environmentLabel}</div>
        <div className="stat-label">وضع التشغيل</div>
      </div>
    </div>
  );
}
