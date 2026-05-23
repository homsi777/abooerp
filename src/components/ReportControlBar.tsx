import { ReactNode } from 'react';
import ReportActionsMenu, { type ReportActionItem } from './ReportActionsMenu';

interface ReportControlBarProps {
  filters: ReactNode;
  statusControl?: ReactNode;
  actions: ReportActionItem[];
  onExecute: () => void;
  executeLabel?: string;
}

export default function ReportControlBar({
  filters,
  statusControl,
  actions,
  onExecute,
  executeLabel = 'عرض الكشف',
}: ReportControlBarProps) {
  return (
    <div className="card mb-4 no-print">
      <div className="flex items-end gap-3 flex-wrap">
        {filters}
        {statusControl}
        <div className="flex items-center gap-2" style={{ marginInlineStart: 'auto' }}>
          <button className="toolbar-btn primary" onClick={onExecute}>
            {executeLabel}
          </button>
          <ReportActionsMenu actions={actions} />
        </div>
      </div>
    </div>
  );
}
