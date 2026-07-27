import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';

type Props = {
  open: boolean;
  dispatchNo?: number | null;
  rowCount: number;
  onConfirmPrint: () => void;
  onSkip: () => void;
  printing?: boolean;
};

export default function QuickLedgerPostSavePrintPrompt({
  open,
  dispatchNo,
  rowCount,
  onConfirmPrint,
  onSkip,
  printing = false,
}: Props) {
  if (!open) return null;

  return createPortal(
    <div className="quick-ledger-dispatch-dialog-backdrop" role="presentation">
      <div
        className="quick-ledger-post-save-print-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-save-print-title"
      >
        <header>
          <h3 id="post-save-print-title">تم حفظ الإرسالية بنجاح</h3>
          <button type="button" onClick={onSkip} aria-label="إغلاق">
            <X size={18} />
          </button>
        </header>
        <p>
          {dispatchNo != null ? `إرسالية #${dispatchNo}` : 'الإرسالية'} — {rowCount} سطر
          {' '}تم حفظها وترحيلها. هل تريد طباعة هذه الإرسالية الآن؟
        </p>
        <footer>
          <button type="button" onClick={onSkip} disabled={printing}>
            لاحقاً
          </button>
          <button type="button" className="primary" onClick={onConfirmPrint} disabled={printing}>
            <Printer size={16} />
            {printing ? 'جاري الطباعة...' : 'طباعة الآن'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
