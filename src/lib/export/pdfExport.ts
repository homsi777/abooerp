function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildPdfTableHtml(payload: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
}) {
  const bodyRows = payload.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin: 0; padding: 0; background: white; font-family: Tahoma, Arial, sans-serif; }
    .header { margin-bottom: 10px; }
    .title { font-size: 14px; font-weight: 800; margin: 0; }
    .subtitle { font-size: 11px; color: #334155; margin: 4px 0 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #111827; padding: 4px 6px; font-size: 10px; line-height: 1.35; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 800; text-align: center; }
    td { word-break: break-word; white-space: normal; }
  </style>
</head>
<body>
  <div class="header">
    <p class="title">${escapeHtml(payload.title)}</p>
    ${payload.subtitle ? `<p class="subtitle">${escapeHtml(payload.subtitle)}</p>` : ''}
  </div>
  <table>
    <thead>
      <tr>${payload.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${bodyRows || ''}
    </tbody>
  </table>
</body>
</html>`;
}

export async function exportPdfTable(payload: {
  title: string;
  defaultFileName: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
}) {
  const html = buildPdfTableHtml({
    title: payload.title,
    subtitle: payload.subtitle,
    headers: payload.headers,
    rows: payload.rows,
  });

  if (typeof window !== 'undefined' && window.pdfRuntime?.exportPdf) {
    return window.pdfRuntime.exportPdf({
      title: payload.title,
      html,
      defaultFileName: payload.defaultFileName,
      landscape: true,
    });
  }

  const popup = window.open('', '_blank');
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }
  return { saved: false, filePath: null, message: 'print_fallback' };
}

