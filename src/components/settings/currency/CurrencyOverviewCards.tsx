interface CurrencyOverviewCardsProps {
  baseCurrency: string;
  supportedCount: number;
  lastUpdatedAt: string;
  linkedModulesCount: number;
  conversionHealth: 'healthy' | 'warning';
}

export default function CurrencyOverviewCards({
  baseCurrency,
  supportedCount,
  lastUpdatedAt,
  linkedModulesCount,
  conversionHealth,
}: CurrencyOverviewCardsProps) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <div className="stat-card">
        <div className="stat-value">{baseCurrency}</div>
        <div className="stat-label">العملة الأساسية</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{supportedCount}</div>
        <div className="stat-label">عدد العملات المدعومة</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ fontSize: '14px' }}>{lastUpdatedAt}</div>
        <div className="stat-label">آخر تحديث لسعر الصرف</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{linkedModulesCount}</div>
        <div className="stat-label">عدد الصفحات المربوطة بالتحويل</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{conversionHealth === 'healthy' ? 'سليم' : 'تحذير'}</div>
        <div className="stat-label">حالة التحويل المالي</div>
      </div>
    </div>
  );
}
