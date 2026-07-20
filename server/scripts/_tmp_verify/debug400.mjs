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
  page.on('response', async (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch {}
      console.log('[HTTP', res.status(), res.request().method(), res.url().replace(APP_URL, ''), ']', body);
    }
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(APP_URL + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.type('input[type="text"]', 'admin', { delay: 15 });
  await page.type('input[type="password"]', 'admin123', { delay: 15 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null), page.keyboard.press('Enter')]);
  await new Promise((r) => setTimeout(r, 800));
  console.log('=== nav to ledger ===');
  await page.goto(APP_URL + '/#/shipment-quick-ledger', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.select('section.quick-ledger-trip select', 'فرع حلب').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  const dateSel = 'section.quick-ledger-trip input[type="date"]';
  await page.waitForSelector(dateSel, { timeout: 15000 });
  console.log('=== switching date (watch for 400s during this) ===');
  const renderPromise = waitForConsoleEvent(page, (t) => t.includes('render_complete'), 20000);
  await setReactInputValue(page, dateSel, '2026-06-09');
  await renderPromise;
  await new Promise((r) => setTimeout(r, 500));

  console.log('=== typing into notes field (watch for 400s during this) ===');
  const rowId = await page.$eval('tr[data-ledger-row-id]', (el) => el.getAttribute('data-ledger-row-id'));
  const noteSel = `tr[data-ledger-row-id="${rowId}"] td.col-notes input`;
  await page.click(noteSel);
  await page.keyboard.type('HELLO', { delay: 30 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('=== blurring field (triggers flushRowSave -> real save) ===');
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 1000));

  await browser.close();
  console.log('=== DONE ===');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
