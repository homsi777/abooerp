export type HtmlPdfExportResult = {
  saved: boolean;
  filePath: string | null;
  message: string;
};

function normalizePdfFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

async function waitForFrameDocument(frameDoc: Document): Promise<void> {
  if (frameDoc.fonts?.ready) {
    await frameDoc.fonts.ready.catch(() => undefined);
  }
  await new Promise((resolve) => window.setTimeout(resolve, 250));
}

/** تصدير HTML كملف PDF في المتصفح (السحابة / الويب) */
export async function exportHtmlDocumentToPdf(payload: {
  html: string;
  defaultFileName: string;
  landscape?: boolean;
}): Promise<HtmlPdfExportResult> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = payload.landscape === false ? '794px' : '1123px';
  iframe.style.height = '20000px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  try {
    const frameDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!frameDoc) {
      throw new Error('تعذر تهيئة مستند PDF');
    }

    frameDoc.open();
    frameDoc.write(payload.html);
    frameDoc.close();
    await waitForFrameDocument(frameDoc);

    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf()
      .set({
        margin: [10, 8, 10, 8],
        filename: normalizePdfFileName(payload.defaultFileName),
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: payload.landscape === false ? 'portrait' : 'landscape',
        },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(frameDoc.body)
      .save();

    return { saved: true, filePath: null, message: 'saved' };
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

export async function exportPdfFromRuntimeOrBrowser(payload: {
  title: string;
  html: string;
  defaultFileName: string;
  landscape?: boolean;
}): Promise<HtmlPdfExportResult> {
  if (typeof window !== 'undefined' && window.pdfRuntime?.exportPdf) {
    return window.pdfRuntime.exportPdf({
      title: payload.title,
      html: payload.html,
      defaultFileName: payload.defaultFileName,
      landscape: payload.landscape ?? true,
    });
  }

  return exportHtmlDocumentToPdf({
    html: payload.html,
    defaultFileName: payload.defaultFileName,
    landscape: payload.landscape,
  });
}
