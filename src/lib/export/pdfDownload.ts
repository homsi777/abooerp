import { httpClient } from '../api/httpClient';

function normalizePdfFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

export function triggerBrowserFileDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = normalizePdfFileName(fileName);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** تنزيل PDF من الخادم (Chromium) — الطريقة الموثوقة على المتصفح/السحابة */
export async function downloadPdfFromServer(payload: {
  html: string;
  fileName: string;
  landscape?: boolean;
  title?: string;
}): Promise<void> {
  const blob = await httpClient.postBlob('/export/pdf', {
    html: payload.html,
    fileName: payload.fileName,
    landscape: payload.landscape ?? true,
    title: payload.title,
  });
  triggerBrowserFileDownload(blob, payload.fileName);
}
