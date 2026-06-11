import { isElectronRuntime } from '../runtime/runtimeMode';
import { exportPdfFromRuntimeOrBrowser } from './htmlToPdf';
import {
  companyPrintHeaderStyles,
  renderCompanyPrintHeader,
} from './companyPrintHeader';

export type LedgerPrintMetaItem = { label: string; value: string };

export type LedgerPrintTableSection = {
  heading?: string;
  note?: string;
  headers: string[];
  rows: string[][];
  footerRow?: string[];
};

function escapeLedgerPrintHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ledgerPrintStyles(orientation: 'portrait' | 'landscape'): string {
  const pageSize = orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
  return `
    @page { size: ${pageSize}; margin: 12mm 8mm; }
    html, body { margin: 0; padding: 0; background: white; font-family: Tahoma, Arial, sans-serif; color: #10251f; }
    ${companyPrintHeaderStyles()}
    .doc-title { font-size: 16px; font-weight: 800; margin: 0 0 8px; text-align: center; }
    .meta { margin-bottom: 10px; font-size: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
    .meta div { border: 1px solid #c5d0dc; padding: 4px 6px; background: #f8fafc; }
    .meta strong { font-weight: 800; }
    .section { margin-top: 14px; page-break-inside: avoid; }
    .section h3 { margin: 0 0 6px; font-size: 13px; font-weight: 800; color: #1e3a34; }
    .section-note { margin: 0 0 6px; font-size: 10px; color: #475569; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #7f93a7; padding: 3px 2px; vertical-align: middle; line-height: 1.15; }
    th { background: #dce8e5; font-weight: 800; text-align: center; min-height: 26px; word-break: break-word; }
    td { text-align: center; min-height: 20px; background: #fff; word-break: break-word; }
    td.text-right { text-align: right; }
    td.text-left, th.text-left { text-align: left; direction: ltr; }
    tfoot { display: table-footer-group; }
    tr.totals-row td { background: #dce8e5; font-weight: 800; text-align: center; }
  `;
}

function renderTableSection(section: LedgerPrintTableSection): string {
  const bodyRows = section.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeLedgerPrintHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const footRow = section.footerRow
    ? `<tr class="totals-row">${section.footerRow.map((cell) => `<td>${escapeLedgerPrintHtml(cell)}</td>`).join('')}</tr>`
    : '';
  return `
    <section class="section">
      ${section.heading ? `<h3>${escapeLedgerPrintHtml(section.heading)}</h3>` : ''}
      ${section.note ? `<p class="section-note">${escapeLedgerPrintHtml(section.note)}</p>` : ''}
      <table>
        <thead>
          <tr>${section.headers.map((h) => `<th>${escapeLedgerPrintHtml(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>${bodyRows || `<tr><td colspan="${section.headers.length}">لا توجد بيانات</td></tr>`}</tbody>
        ${footRow ? `<tfoot>${footRow}</tfoot>` : ''}
      </table>
    </section>
  `;
}

export function buildLedgerStylePrintHtml(options: {
  title: string;
  meta: LedgerPrintMetaItem[];
  sections: LedgerPrintTableSection[];
  orientation?: 'portrait' | 'landscape';
  headerFields?: Array<{ label: string; value: string | number }>;
}): string {
  const orientation = options.orientation ?? 'landscape';
  const metaHtml = options.meta
    .map((item) => `<div><strong>${escapeLedgerPrintHtml(item.label)}:</strong> ${escapeLedgerPrintHtml(item.value)}</div>`)
    .join('');
  const sectionsHtml = options.sections.map(renderTableSection).join('');
  const headerHtml = options.headerFields?.length
    ? renderCompanyPrintHeader({ title: options.title, fields: options.headerFields })
    : renderCompanyPrintHeader({ title: options.title, fields: [] });

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeLedgerPrintHtml(options.title)}</title>
  <style>${ledgerPrintStyles(orientation)}</style>
</head>
<body>
  ${headerHtml}
  ${options.meta.length ? `<div class="meta">${metaHtml}</div>` : ''}
  ${sectionsHtml}
</body>
</html>`;
}

export function printHtmlInBrowser(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow;
  const frameDoc = iframe.contentDocument ?? frameWindow?.document;
  if (!frameDoc || !frameWindow) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تهيئة نافذة الطباعة');
  }
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(() => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }, 1000);
}

export async function printLedgerStyleDocument(
  html: string,
  documentType: string,
): Promise<'queued' | 'browser' | 'error'> {
  if (window.printer?.getDefault && window.printer?.print) {
    const defaultPrinter = await window.printer.getDefault();
    if (defaultPrinter.available && defaultPrinter.printer?.name) {
      const result = await window.printer.print({
        documentType,
        printerTarget: defaultPrinter.printer.name,
        copies: 1,
        payloadType: 'html',
        content: html,
      });
      return result.queued ? 'queued' : 'error';
    }
    return 'error';
  }

  if (isElectronRuntime()) {
    return 'error';
  }

  printHtmlInBrowser(html);
  return 'browser';
}

export async function exportLedgerStylePdf(payload: {
  title: string;
  html: string;
  defaultFileName: string;
  landscape?: boolean;
}) {
  return exportPdfFromRuntimeOrBrowser(payload);
}

export function formatLedgerMoney(value: unknown, currency = 'USD'): string {
  return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
}

export function formatLedgerDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).split('T')[0] ?? '—';
  return d.toLocaleDateString('ar-SY');
}
