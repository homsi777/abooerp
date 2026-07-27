// TEMPORARY debug script. Safe to delete after use.
import puppeteer from 'puppeteer-core';

const EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://127.0.0.1:5188';

function waitForConsoleEvent(page, matchFn, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { page.off('console', handler); reject(new Error('timeout')); }, timeoutMs);
    function handler(msg) { const t = msg.text(); if (matchFn(t)) { clearTimeout(timer); page.off('console', handler); resolve(t); } }
    page.on('console', handler);
  });
}
async function setReactInputValue(page, selector, value) {
  await page.evaluate((sel, val) => {
    const input = document.querySelector(sel);
    const proto = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, executablePath: EXECUTABLE, args: ['--window-size=1680,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000 });
  page.on('console', (msg) => { const t = msg.text(); if (t.includes('PERF_PROBE') || msg.type() === 'error') console.log('[console]', msg.type(), t.slice(0, 200)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(APP_URL + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.type('input[type="text"]', 'admin', { delay: 15 });
  await page.type('input[type="password"]', 'admin123', { delay: 15 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null), page.keyboard.press('Enter')]);
  await new Promise((r) => setTimeout(r, 800));
  await page.goto(APP_URL + '/#/shipment-quick-ledger', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.select('section.quick-ledger-trip select', 'فرع حلب').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  const dateSel = 'section.quick-ledger-trip input[type="date"]';
  await page.waitForSelector(dateSel, { timeout: 15000 });
  const renderPromise = waitForConsoleEvent(page, (t) => t.includes('render_complete'), 20000);
  await setReactInputValue(page, dateSel, '2026-06-09');
  await renderPromise;
  await new Promise((r) => setTimeout(r, 400));

  // NO scroll this time — test on the very first mounted row, no prior interaction.
  const rowId = await page.$eval('tr[data-ledger-row-id]', (el) => el.getAttribute('data-ledger-row-id'));
  console.log('Target row id:', rowId);
  const noteSel = `tr[data-ledger-row-id="${rowId}"] td.col-notes input`;

  const before = await page.$eval(noteSel, (el) => el.value);
  console.log('Notes value BEFORE:', JSON.stringify(before));

  await page.click(noteSel);
  console.log('Clicked. Active element tag:', await page.evaluate(() => document.activeElement?.tagName));
  console.log('Active element matches noteSel:', await page.evaluate((sel) => document.activeElement === document.querySelector(sel), noteSel));

  await page.keyboard.type('HELLO-TEST', { delay: 30 });
  const afterTypeImmediate = await page.$eval(noteSel, (el) => el.value);
  console.log('Notes value immediately after keyboard.type:', JSON.stringify(afterTypeImmediate));

  await new Promise((r) => setTimeout(r, 300));
  const afterWait = await page.$eval(noteSel, (el) => el.value);
  console.log('Notes value after 300ms wait:', JSON.stringify(afterWait));

  // Check if the DOM node itself got replaced (different element reference) via a marker property
  const stillSameNode = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el.__debugMarker) { el.__debugMarker = 'marked'; return 'freshly-marked'; }
    return el.__debugMarker;
  }, noteSel);
  console.log('DOM node identity marker:', stillSameNode);

  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
