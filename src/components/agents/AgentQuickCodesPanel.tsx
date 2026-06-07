import type { AgentQuickCodeEntry } from '../../lib/agents/agentQuickCodes';

type Props = {
  compact?: boolean;
  entries: AgentQuickCodeEntry[];
  loading?: boolean;
  showAgentName?: boolean;
};

export default function AgentQuickCodesPanel({
  compact = false,
  entries,
  loading = false,
  showAgentName = false,
}: Props) {
  const sample = entries.find((entry) => /^\d+$/.test(entry.code));

  return (
    <div className={compact ? 'agent-quick-codes-panel agent-quick-codes-panel--compact' : 'agent-quick-codes-panel'}>
      {!compact && (
        <p className="agent-quick-codes-intro">
          في عمود <strong>الجهة</strong> بالدفتر: اكتب الرقم فقط
          {sample ? (
            <>
              {' '}
              (مثل <strong>{sample.code}</strong> لـ{sample.governorate})
            </>
          ) : null}{' '}
          أو اسم المحافظة. الجدول يُحدَّث تلقائياً من <strong>أكواد الوكلاء النشطين</strong>.
        </p>
      )}
      {loading ? <p className="agent-quick-codes-empty">جاري تحميل الاختصارات...</p> : null}
      {!loading && !entries.length ? (
        <p className="agent-quick-codes-empty">لا يوجد وكلاء نشطون بمحافظة محددة — أضفهم من قسم الوكلاء.</p>
      ) : null}
      {!loading && entries.length > 0 ? (
        <table className="agent-quick-codes-table">
          <thead>
            <tr>
              <th>الاختصار</th>
              <th>المحافظة (الجهة)</th>
              {showAgentName ? <th>الوكيل</th> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.code}-${entry.governorate}`}>
                <td><span className="agent-quick-code-badge">{entry.code}</span></td>
                <td>{entry.governorate}</td>
                {showAgentName ? <td>{entry.name ?? '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
