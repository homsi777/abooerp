// TEMPORARY — post-fix browser verification + T5 re-measurement. Safe to delete after use.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://127.0.0.1:5188';
const SCRATCH = 'C:\\Users\\Homsi\\AppData\\Local\\Temp\\claude\\c--Users-Homsi-Desktop-almiya-hsahin\\6ed16a67-c9f9-4db1-a028-7bb0d8358741\\scratchpad';

function waitForConsoleEvent(page, matchFn, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { page.off('console', handler); reject(new Error('timeout: ' + matchFn.toString())); }, timeoutMs);
    function handler(msg) {
      const text = msg.text();
      if (matchFn(text)) { clearTimeout(timer); page.off('console', handler); resolve(text); }
    }
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
  const consoleLog = [];
  page.on('console', (msg) => { const t = msg.text(); if (t.includes('PERF_PROBE')) consoleLog.push(t); });
  page.on('pageerror', (e) => console.log('[PAGE ERROR]', e.message));

  console.log('=== Login ===');
  await page.goto(APP_URL + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('input[type="text"]', { timeout: 15000 });
  await page.type('input[type="text"]', 'admin', { delay: 15 });
  await page.type('input[type="password"]', 'admin123', { delay: 15 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null), page.keyboard.press('Enter')]);
  await new Promise((r) => setTimeout(r, 800));

  console.log('=== Navigate to ledger (fresh load) ===');
  await page.goto(APP_URL + '/#/shipment-quick-ledger', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  await page.select('section.quick-ledger-trip select', 'فرع حلب').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  const dateSel = 'section.quick-ledger-trip input[type="date"]';
  await page.waitForSelector(dateSel, { timeout: 15000 });

  console.log('\n=== T5 RE-MEASURE: switch to 2026-06-09 (same date as original diagnostic, virtualized table) ===');
  consoleLog.length = 0;
  const renderPromise = waitForConsoleEvent(page, (t) => t.includes('render_complete'), 20000);
  await setReactInputValue(page, dateSel, '2026-06-09');
  await renderPromise;
  await new Promise((r) => setTimeout(r, 400));
  const t5Line = consoleLog.find((l) => l.includes('render_complete'));
  console.log('Console:', t5Line);
  await page.screenshot({ path: `${SCRATCH}\\after_01_2026-06-09.png` });

  const rowCountInDom = await page.$$eval('tr[data-ledger-row-id]', (els) => els.length);
  const totalVisibleRowsReported = await page.evaluate(() => {
    const m = document.body.innerText.match(/عدد الأسطر\s*([\d,]+)/);
    return m ? m[1] : null;
  });
  console.log('Rows actually mounted in DOM right now (should be << total, proving virtualization is active):', rowCountInDom);

  console.log('\n=== Visual/data correctness spot-check ===');
  const firstRowData = await page.evaluate(() => {
    const tr = document.querySelector('tr[data-ledger-row-id]');
    if (!tr) return null;
    const inputs = Array.from(tr.querySelectorAll('input, select')).map((el) => el.value);
    return inputs;
  });
  console.log('First mounted row field values (non-empty = real data rendered correctly):', firstRowData);

  console.log('\n=== Scroll test: scroll table container, confirm new rows mount (virtualization working) ===');
  await page.evaluate(() => {
    const shell = document.querySelector('.quick-ledger-table-shell');
    if (shell) shell.scrollTop = shell.scrollHeight / 2;
  });
  await new Promise((r) => setTimeout(r, 300));
  const rowCountAfterScroll = await page.$$eval('tr[data-ledger-row-id]', (els) => els.length);
  const firstIdAfterScroll = await page.$eval('tr[data-ledger-row-id]', (el) => el.getAttribute('data-ledger-row-id')).catch(() => null);
  console.log('Rows mounted after scrolling to middle:', rowCountAfterScroll, '| first mounted row id changed to:', firstIdAfterScroll);
  await page.screenshot({ path: `${SCRATCH}\\after_02_scrolled.png` });

  console.log('\n=== Inline editing test: edit a mounted cell, confirm value updates + no crash ===');
  const noteSel = 'tr[data-ledger-row-id] td.col-notes input';
  await page.waitForSelector(noteSel, { timeout: 5000 });
  const targetRowId = await page.$eval('tr[data-ledger-row-id]', (el) => el.getAttribute('data-ledger-row-id'));
  await page.click(noteSel, { clickCount: 3 });
  await page.type(noteSel, 'PERFVERIFY-inline-edit-test', { delay: 10 });
  const editedValue = await page.$eval(noteSel, (el) => el.value);
  console.log('Notes field after typing:', editedValue);

  console.log('\n=== T1 real-UI test: dirty a few rows, switch date, confirm exactly 1 upsert-batch request ===');
  const requestLog = [];
  const onReq = (req) => { if (req.url().includes('/daily-ledger/rows/upsert')) requestLog.push({ url: req.url(), method: req.method() }); };
  page.on('request', onReq);
  // blur the edited notes field so it becomes "dirty" (matches shouldPersistRow/isRowStarted)
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 50));
  consoleLog.length = 0;
  const flushPromise = waitForConsoleEvent(page, (t) => t.includes('flush_end'), 20000);
  await setReactInputValue(page, dateSel, '2026-07-09');
  await flushPromise;
  await new Promise((r) => setTimeout(r, 300));
  page.off('request', onReq);
  console.log('Requests fired to /daily-ledger/rows/upsert* during this flush:', requestLog);
  console.log('flush console lines:', consoleLog.filter((l) => l.includes('[T1]')));
  console.log(
    requestLog.length === 1 && requestLog[0].url.includes('upsert-batch')
      ? 'PASS: exactly ONE batch request fired for the dirty-row flush (was N sequential /rows/upsert before).'
      : `NOTE: ${requestLog.length} request(s) fired — check detail above.`,
  );

  await browser.close();
  console.log('\n=== DONE ===');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
