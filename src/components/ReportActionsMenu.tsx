export interface ReportActionItem {
  id: string;
  label: string;
  onClick: () => void;
}

interface ReportActionsMenuProps {
  actions: ReportActionItem[];
  label?: string;
}

export default function ReportActionsMenu({ actions, label = 'إجراءات' }: ReportActionsMenuProps) {
  return (
    <details className="relative">
      <summary
        className="toolbar-btn"
        style={{
          listStyle: 'none',
          userSelect: 'none',
        }}
      >
        {label}
      </summary>
      <div
        className="card"
        style={{
          position: 'absolute',
          top: '38px',
          insetInlineEnd: 0,
          minWidth: '180px',
          zIndex: 40,
          padding: '8px',
        }}
      >
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="toolbar-btn"
              onClick={action.onClick}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
