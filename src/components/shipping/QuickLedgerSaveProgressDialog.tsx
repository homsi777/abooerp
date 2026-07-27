import { Download, X } from 'lucide-react';
import type { SaveProgressItem, SaveProgressState } from '../../lib/shipping/quickLedgerLog';

type Props = {
  progress: SaveProgressState;
  busy: boolean;
  onClose: () => void;
  onDownloadLog: () => void;
};

function statusLabel(status: SaveProgressItem['status']): string {
  switch (status) {
    case 'pending':
      return 'بانتظار';
    case 'running':
      return 'جاري...';
    case 'saved':
      return 'حُفظ';
    case 'posted':
      return 'مُرحَّل';
    case 'skipped':
      return 'تُخطّي';
    case 'error':
      return 'خطأ';
    default:
      return status;
  }
}

export default function QuickLedgerSaveProgressDialog({
  progress,
  busy,
  onClose,
  onDownloadLog,
}: Props) {
  if (!progress.open) return null;

  const percent =
    progress.totalCount > 0
      ? Math.min(100, Math.round((progress.completedCount / progress.totalCount) * 100))
      : progress.phase === 'done' || progress.phase === 'failed'
        ? 100
        : 0;

  const canClose = !busy && (progress.phase === 'done' || progress.phase === 'failed');

  return (
    <div className="quick-ledger-confirm" role="dialog" aria-modal="true" aria-labelledby="ledger-save-progress-title">
      <div className="quick-ledger-save-progress-panel">
        <div className="quick-ledger-save-progress-header">
          <h3 id="ledger-save-progress-title">حفظ الشحنات — التقدم والسجل</h3>
          {canClose && (
            <button type="button" className="quick-ledger-save-progress-close" onClick={onClose} aria-label="إغلاق">
              <X size={18} />
            </button>
          )}
        </div>

        <p className="quick-ledger-save-progress-phase">{progress.phaseLabel}</p>

        {progress.alreadyPostedCount != null && progress.alreadyPostedCount > 0 && progress.totalCount > 0 && (
          <p className="quick-ledger-save-progress-resume">
            لن يُعاد ترحيل {progress.alreadyPostedCount} سطر مُرحَّل مسبقاً — يُستكمل المتبقي فقط.
          </p>
        )}

        <div className="quick-ledger-save-progress-bar-wrap" aria-hidden="true">
          <div className="quick-ledger-save-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="quick-ledger-save-progress-meta">
          <span>
            {progress.completedCount} / {progress.totalCount || progress.items.length} سطر
          </span>
          <span>{percent}%</span>
        </div>

        {progress.summary && <p className="quick-ledger-save-progress-summary">{progress.summary}</p>}

        <div className="quick-ledger-save-progress-list" dir="rtl">
          <table>
            <thead>
              <tr>
                <th>السطر</th>
                <th>الإيصال</th>
                <th>الجهة</th>
                <th>الحالة</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {progress.items.map((item) => (
                <tr key={item.key} className={`save-progress-row save-progress-row--${item.status}`}>
                  <td>{item.rowLabel}</td>
                  <td>{item.receiptNo || '—'}</td>
                  <td>{item.destination || '—'}</td>
                  <td>{statusLabel(item.status)}</td>
                  <td>{item.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="quick-ledger-save-progress-actions">
          <button type="button" onClick={onDownloadLog}>
            <Download size={16} />
            تنزيل سجل الأخطاء
          </button>
          <button type="button" className="primary" onClick={onClose} disabled={!canClose}>
            {busy ? 'جاري الحفظ...' : 'إغلاق'}
          </button>
        </div>
      </div>
    </div>
  );
}
