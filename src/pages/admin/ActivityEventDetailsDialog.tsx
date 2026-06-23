import type { ActivityRow } from '../../lib/admin/activityEventPresentation';
import {
  actionLabel,
  actionTone,
  actorSubtitle,
  actorTitle,
  buildActivityChangeRows,
  buildActivityDetailRows,
  entityLabel,
  fmtDateTime,
  roleLabel,
} from '../../lib/admin/activityEventPresentation';

type Props = {
  row: ActivityRow | null;
  onClose: () => void;
};

const TONE_CLASS: Record<ReturnType<typeof actionTone>, string> = {
  create: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  update: 'bg-amber-50 text-amber-900 border-amber-200',
  delete: 'bg-rose-50 text-rose-800 border-rose-200',
  neutral: 'bg-slate-50 text-slate-800 border-slate-200',
};

export default function ActivityEventDetailsDialog({ row, onClose }: Props) {
  if (!row) return null;

  const detailRows = buildActivityDetailRows(row);
  const changeRows = buildActivityChangeRows(row);
  const tone = actionTone(row.action);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">{fmtDateTime(row.created_at)}</div>
            <h2 className="text-lg font-bold text-slate-900">تفاصيل الحدث</h2>
            <span className={`inline-block mt-2 text-sm px-2 py-0.5 rounded border ${TONE_CLASS[tone]}`}>
              {actionLabel(row.action)}
            </span>
          </div>
          <button type="button" className="toolbar-btn" onClick={onClose} aria-label="إغلاق">
            إغلاق
          </button>
        </div>

        <div className="overflow-auto p-5 space-y-5">
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 bg-slate-50">
              <div className="text-xs font-semibold text-slate-500 mb-2">من نفّذ الإجراء</div>
              <div className="font-semibold text-slate-900">{actorTitle(row)}</div>
              <div className="text-sm text-slate-600 mt-1">{actorSubtitle(row)}</div>
              <div className="text-xs text-slate-500 mt-2">الدور: {roleLabel(row.actor_role_code)}</div>
            </div>
            <div className="rounded-lg border p-3 bg-slate-50">
              <div className="text-xs font-semibold text-slate-500 mb-2">أين ومتى</div>
              <div className="text-sm"><span className="text-slate-500">القسم:</span> {entityLabel(row.entity_type)}</div>
              <div className="text-sm mt-1"><span className="text-slate-500">الفرع:</span> {row.branch_name || '—'}</div>
              {row.entity_id ? (
                <div className="text-xs font-mono text-slate-400 mt-2 break-all">معرّف: {row.entity_id}</div>
              ) : null}
            </div>
          </section>

          {changeRows.length > 0 ? (
            <section>
              <h3 className="text-sm font-bold text-slate-800 mb-2">ما الذي تغيّر</h3>
              <div className="overflow-auto border rounded-lg">
                <table className="data-grid text-sm w-full">
                  <thead>
                    <tr>
                      <th>الحقل</th>
                      <th>قبل</th>
                      <th>بعد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeRows.map((line) => (
                      <tr key={line.field}>
                        <td className="font-medium">{line.field}</td>
                        <td className="text-rose-700">{line.before}</td>
                        <td className="text-emerald-700">{line.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {detailRows.length > 0 ? (
            <section>
              <h3 className="text-sm font-bold text-slate-800 mb-2">بيانات الحدث</h3>
              <div className="overflow-auto border rounded-lg">
                <table className="data-grid text-sm w-full">
                  <tbody>
                    {detailRows.map((line) => (
                      <tr key={line.label}>
                        <td className="w-40 font-medium text-slate-600">{line.label}</td>
                        <td className="break-words">{line.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {(row.ip_address || row.user_agent) && (
            <section className="text-xs text-slate-500 space-y-1 border-t pt-3">
              {row.ip_address ? <div>IP: {row.ip_address}</div> : null}
              {row.user_agent ? <div className="break-all">المتصفح: {row.user_agent}</div> : null}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
