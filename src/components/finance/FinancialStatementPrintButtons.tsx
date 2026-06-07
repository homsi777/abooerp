import { useState } from 'react';
import { useToast } from '../Toast';
import { exportLedgerStylePdf, printLedgerStyleDocument } from '../../lib/export/ledgerStylePrint';

type Props = {
  disabled?: boolean;
  documentType: string;
  pdfTitle: string;
  pdfFileName: string;
  landscape?: boolean;
  onBuildHtml?: () => string;
  onBuildHtmlAsync?: () => Promise<string>;
  className?: string;
};

export default function FinancialStatementPrintButtons({
  disabled,
  documentType,
  pdfTitle,
  pdfFileName,
  landscape = true,
  onBuildHtml,
  onBuildHtmlAsync,
  className = 'flex gap-2 no-print',
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const resolveHtml = async () => {
    if (onBuildHtmlAsync) return onBuildHtmlAsync();
    if (onBuildHtml) return onBuildHtml();
    throw new Error('لا توجد بيانات للطباعة');
  };

  const handlePrint = async () => {
    setBusy(true);
    try {
      const html = await resolveHtml();
      const result = await printLedgerStyleDocument(html, documentType);
      if (result === 'queued') showToast('تم إرسال الطباعة', 'success');
      else if (result === 'browser') showToast('تم فتح معاينة الطباعة', 'success');
      else showToast('تعذر تنفيذ الطباعة', 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تنفيذ الطباعة', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async () => {
    setBusy(true);
    try {
      const html = await resolveHtml();
      const result = await exportLedgerStylePdf({
        title: pdfTitle,
        html,
        defaultFileName: pdfFileName,
        landscape,
      });
      if (result.saved) showToast('تم حفظ ملف PDF', 'success');
      else if (result.message !== 'cancelled') showToast('تم فتح معاينة التصدير', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تصدير PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <button type="button" className="toolbar-btn" disabled={disabled || busy} onClick={() => void handlePrint()}>
        طباعة
      </button>
      <button type="button" className="toolbar-btn" disabled={disabled || busy} onClick={() => void handlePdf()}>
        تصدير PDF
      </button>
    </div>
  );
}
