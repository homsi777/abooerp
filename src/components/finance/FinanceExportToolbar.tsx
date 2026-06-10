import { useToast } from '../Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import FinancialStatementPrintButtons from './FinancialStatementPrintButtons';

type Props = {
  disabled?: boolean;
  csvFileName: string;
  csvHeaders: string[];
  csvRows: string[][];
  pdfTitle: string;
  pdfFileName: string;
  documentType: string;
  onBuildPrintHtml: () => string;
  landscape?: boolean;
  className?: string;
};

export default function FinanceExportToolbar({
  disabled,
  csvFileName,
  csvHeaders,
  csvRows,
  pdfTitle,
  pdfFileName,
  documentType,
  onBuildPrintHtml,
  landscape = true,
  className = 'flex flex-wrap gap-2',
}: Props) {
  const { showToast } = useToast();

  const exportCsv = () => {
    downloadCsv(csvFileName, csvHeaders, csvRows);
    showToast('تم تنزيل ملف Excel (CSV)', 'success');
  };

  return (
    <div className={className}>
      <button type="button" className="toolbar-btn" disabled={disabled} onClick={exportCsv}>
        تصدير Excel (CSV)
      </button>
      <FinancialStatementPrintButtons
        disabled={disabled}
        documentType={documentType}
        pdfTitle={pdfTitle}
        pdfFileName={pdfFileName}
        onBuildHtml={onBuildPrintHtml}
        landscape={landscape}
        className="flex gap-2"
      />
    </div>
  );
}
