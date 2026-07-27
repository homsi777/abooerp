import { resolveCompanyLogoPrintSrc } from './companyBrand';

let cachedLogoDataUrl: string | null = null;
let inFlightLogoPromise: Promise<string> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة شعار الشركة'));
    reader.readAsDataURL(blob);
  });
}

/** يجلب شعار الشركة ويحوّله إلى data URL للطباعة/PDF — مع تخزين مؤقت */
export async function resolveCompanyLogoDataUrlForPrint(): Promise<string> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  if (inFlightLogoPromise) return inFlightLogoPromise;

  inFlightLogoPromise = (async () => {
    const fallbackSrc = resolveCompanyLogoPrintSrc();
    if (fallbackSrc.startsWith('data:')) {
      cachedLogoDataUrl = fallbackSrc;
      return fallbackSrc;
    }
    try {
      const response = await fetch(fallbackSrc, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`logo HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('empty logo');
      const dataUrl = await blobToDataUrl(blob);
      cachedLogoDataUrl = dataUrl;
      return dataUrl;
    } catch {
      cachedLogoDataUrl = fallbackSrc;
      return fallbackSrc;
    } finally {
      inFlightLogoPromise = null;
    }
  })();

  return inFlightLogoPromise;
}

/** يستبدل src للوغو في HTML الطباعة بـ data URL مضمّن */
export async function embedCompanyLogoInPrintHtml(html: string): Promise<string> {
  const dataUrl = await resolveCompanyLogoDataUrlForPrint();
  const fallbackSrc = resolveCompanyLogoPrintSrc();
  const candidates = [fallbackSrc, encodeURI(fallbackSrc), decodeURI(fallbackSrc)].filter(Boolean);
  let next = html;
  for (const candidate of candidates) {
    if (candidate && next.includes(candidate)) {
      next = next.split(candidate).join(dataUrl);
    }
  }
  if (next.includes('class="company-print-logo"')) {
    next = next.replace(
      /(<img[^>]*class="company-print-logo"[^>]*src=")([^"]*)(")/g,
      `$1${dataUrl.replace(/"/g, '&quot;')}$3`,
    );
  }
  return next;
}

/** انتظر تحميل صور المستند قبل الطباعة أو التصدير */
export async function waitForDocumentImages(doc: Document, timeoutMs = 10000): Promise<void> {
  const images = Array.from(doc.querySelectorAll('img'));
  if (!images.length) return;
  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/** تحضير HTML للطباعة/PDF — لوغو مضمّن */
export async function preparePrintHtmlForOutput(html: string): Promise<string> {
  return embedCompanyLogoInPrintHtml(html);
}
