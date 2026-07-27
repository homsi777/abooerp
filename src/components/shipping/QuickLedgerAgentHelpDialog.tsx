import { HelpCircle, X } from 'lucide-react';
import AgentQuickCodesPanel from '../agents/AgentQuickCodesPanel';
import type { AgentQuickCodeEntry } from '../../lib/agents/agentQuickCodes';

type Props = {
  open: boolean;
  loading?: boolean;
  entries: AgentQuickCodeEntry[];
  onClose: () => void;
};

export default function QuickLedgerAgentHelpDialog({ open, loading, entries, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="quick-ledger-confirm" role="dialog" aria-modal="true" aria-labelledby="ledger-agent-help-title">
      <div className="quick-ledger-agent-help-panel">
        <div className="quick-ledger-agent-help-header">
          <div className="quick-ledger-agent-help-title-wrap">
            <HelpCircle size={22} aria-hidden="true" />
            <h3 id="ledger-agent-help-title">اختصارات الوكلاء — دفتر الشحن</h3>
          </div>
          <button type="button" className="quick-ledger-save-progress-close" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <AgentQuickCodesPanel entries={entries} loading={loading} showAgentName />

        <ul className="quick-ledger-agent-help-notes">
          <li>عند تعديل <strong>كود الوكيل</strong> في قسم الوكلاء يتغيّر الرقم هنا فوراً.</li>
          <li>الرقم في «الجهة» يربط الشحنة تلقائياً بالوكيل النشط لتلك المحافظة.</li>
          <li>إذا ظهر خطأ «أكثر من وكيل» — عطّل التعريف المكرر واترك وكيلاً واحداً لكل محافظة.</li>
        </ul>

        <div className="quick-ledger-save-progress-actions">
          <button type="button" className="primary" onClick={onClose}>
            فهمت
          </button>
        </div>
      </div>
    </div>
  );
}
