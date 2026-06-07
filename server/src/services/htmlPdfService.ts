import { HttpError } from '../utils/errors.js';

const MAX_HTML_BYTES = 2_000_000;

export async function renderHtmlToPdfBuffer(html: string, landscape = true): Promise<Buffer> {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new HttpError(413, 'محتوى التقرير كبير جداً للتصدير.');
  }

  let puppeteer: typeof import('puppeteer-core');
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    throw new HttpError(503, 'خدمة PDF غير متوفرة على الخادم.');
  }

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    (process.platform === 'linux' ? '/usr/bin/chromium-browser' : undefined) ||
    (process.platform === 'linux' ? '/usr/bin/chromium' : undefined) ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined);

  if (!executablePath) {
    throw new HttpError(
      503,
      'لم يُعثر على متصفح Chromium/Chrome للتصدير — عيّن PUPPETEER_EXECUTABLE_PATH على الخادم.',
    );
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    const pdf = await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: { top: '12mm', right: '8mm', bottom: '12mm', left: '8mm' },
      timeout: 120_000,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
