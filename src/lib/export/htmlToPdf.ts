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
  await new Promise((resolve) => window.setTimeout(resolve, 400));
}

function mountHtmlFrame(html: string, landscape?: boolean): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '0';
  iframe.style.top = '0';
  iframe.style.width = landscape === false ? '794px' : '1123px';
  iframe.style.height = '100vh';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '-1';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!frameDoc) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تهيئة مستند PDF');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  return iframe;
}

/** تصدير HTML كملف PDF في المتصفح (احتياطي عند فشل الخادم) */
export async function exportHtmlDocumentToPdf(payload: {
  html: string;
  defaultFileName: string;
  landscape?: boolean;
}): Promise<HtmlPdfExportResult> {
  const iframe = mountHtmlFrame(payload.html, payload.landscape);
  const frameDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!frameDoc?.body) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    throw new Error('تعذر تحميل محتوى PDF');
  }

  try {
    await waitForFrameDocument(frameDoc);
    const html2pdf = (await import('html2pdf.js')).default;
    const fileName = normalizePdfFileName(payload.defaultFileName);
    const worker = html2pdf()
      .set({
        margin: [10, 8, 10, 8],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: 0,
          windowWidth: frameDoc.documentElement.scrollWidth,
          windowHeight: frameDoc.documentElement.scrollHeight,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: payload.landscape === false ? 'portrait' : 'landscape',
        },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(frameDoc.body);

    const blob = (await worker.outputPdf('blob')) as Blob;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

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

  const { downloadPdfFromServer } = await import('./pdfDownload');
  try {
    await downloadPdfFromServer({
      html: payload.html,
      fileName: payload.defaultFileName,
      landscape: payload.landscape ?? true,
      title: payload.title,
    });
    return { saved: true, filePath: null, message: 'saved' };
  } catch (serverError) {
    console.warn('[pdf] server export failed, using browser fallback', serverError);
    return exportHtmlDocumentToPdf({
      html: payload.html,
      defaultFileName: payload.defaultFileName,
      landscape: payload.landscape,
    });
  }
}
