// TEMPORARY — post-fix browser verification + T5 re-measurement (v2: picks an editable row). Safe to delete.
import puppeteer from 'puppeteer-core';

const EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://127.0.0.1:5188';
const SCRATCH = 'C:\\Users\\Homsi\\AppData\\Local\\Temp\\claude\\c--Users-Homsi-Desktop-almiya-hsahin\\6ed16a67-c9f9-4db1-a028-7bb0d8358741\\scratchpad';

function waitForConsoleEvent(page, matchFn, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { page.off('console', handler); reject(new Error('timeout: ' + matchFn.toString())); }, timeoutMs);
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
  const consoleLog = [];
  page.on('console', (msg) => { const t = msg.text(); if (t.includes('PERF_PROBE')) consoleLog.push(t); });
  page.on('response', async (res) => {
    if (res.status() >= 400 && res.url().includes('/api/') && !res.url().includes('/shipments/')) {
      console.log('[UNEXPECTED HTTP ERROR]', res.status(), res.request().method(), res.url().replace(APP_URL, ''));
    }
  });

  console.log('=== Login + navigate ===');
  await page.goto(APP_URL + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('input[type="text"]', { timeout: 15000 });
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

  console.log('\n=== T5 RE-MEASURE: switch to 2026-06-09 ===');
  consoleLog.length = 0;
  const renderPromise = waitForConsoleEvent(page, (t) => t.includes('render_complete'), 20000);
  await setReactInputValue(page, dateSel, '2026-06-09');
  await renderPromise;
  await new Promise((r) => setTimeout(r, 400));
  console.log('Console:', consoleLog.find((l) => l.includes('render_complete')));
  const mountedCount = await page.$$eval('tr[data-ledger-row-id]', (els) => els.length);
  console.log('Rows mounted in DOM (virtualization proof — should be a small window, not all rows):', mountedCount);
  await page.screenshot({ path: `${SCRATCH}\\v2_01_loaded.png` });

  console.log('\n=== Data correctness: dump first 3 mounted rows ===');
  const sample = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('tr[data-ledger-row-id]')).slice(0, 3).map((tr) => ({
      id: tr.getAttribute('data-ledger-row-id'),
      receipt: tr.querySelector('td.col-receipt input')?.value,
      sender: tr.querySelector('td.col-sender input')?.value,
      dest: tr.querySelector('td.quick-ledger-dest-cell input')?.value,
    }));
  });
  console.log(sample);

  console.log('\n=== Find an EDITABLE (non-locked) row for the edit/flush test ===');
  const editableRowId = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-ledger-row-id]'));
    for (const tr of rows) {
      const notesInput = tr.querySelector('td.col-notes input');
      if (notesInput && !notesInput.disabled) return tr.getAttribute('data-ledger-row-id');
    }
    return null;
  });
  console.log('Editable row id found:', editableRowId);
  if (!editableRowId) throw new Error('No editable row found in mounted window');

  console.log('\n=== Scroll test (virtualization mount/unmount) ===');
  await page.evaluate(() => { const s = document.querySelector('.quick-ledger-table-shell'); if (s) s.scrollTop = s.scrollHeight / 2; });
  await new Promise((r) => setTimeout(r, 300));
  const afterScrollCount = await page.$$eval('tr[data-ledger-row-id]', (els) => els.length);
  const firstAfterScroll = await page.$eval('tr[data-ledger-row-id]', (el) => el.getAttribute('data-ledger-row-id')).catch(() => null);
  console.log('Mounted after scroll:', afterScrollCount, '| first row id now:', firstAfterScroll, '(should differ from before scroll)');
  await page.screenshot({ path: `${SCRATCH}\\v2_02_scrolled.png` });
  // scroll back to top so the editable row is mounted again
  await page.evaluate(() => { const s = document.querySelector('.quick-ledger-table-shell'); if (s) s.scrollTop = 0; });
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n=== Inline editing test on the confirmed-editable row ===');
  const noteSel = `tr[data-ledger-row-id="${editableRowId}"] td.col-notes input`;
  await page.waitForSelector(noteSel, { timeout: 5000 });
  const before = await page.$eval(noteSel, (el) => el.value);
  await page.click(noteSel, { clickCount: 3 });
  await page.type(noteSel, 'PERFVERIFY-inline-ok', { delay: 15 });
  const afterType = await page.$eval(noteSel, (el) => el.value);
  console.log(`Notes value: before=${JSON.stringify(before)} after=${JSON.stringify(afterType)}`);
  console.log(afterType.includes('PERFVERIFY-inline-ok') ? 'PASS: inline editing works.' : 'FAIL: value did not update.');
  // revert so we don't leave test text on real data, then blur elsewhere without saving
  await page.click(noteSel, { clickCount: 3 });
  await page.type(noteSel, before, { delay: 5 });

  console.log('\n=== T1 real-UI test: dirty several rows, switch date, confirm ONE upsert-batch request ===');
  const editableIds = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-ledger-row-id]'));
    return rows.filter((tr) => { const i = tr.querySelector('td.col-notes input'); return i && !i.disabled; })
      .slice(0, 5).map((tr) => tr.getAttribute('data-ledger-row-id'));
  });
  console.log('Dirtying rows:', editableIds);
  await page.evaluate((ids) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    ids.forEach((id, i) => {
      const el = document.querySelector(`tr[data-ledger-row-id="${id}"] td.col-notes input`);
      if (!el) return;
      setter.call(el, `PERFVERIFY-DIRTY-${i}-${Date.now()}`);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, editableIds);
  const originalNotesForRestore = await page.evaluate((ids) => ids.map((id) => {
    const el = document.querySelector(`tr[data-ledger-row-id="${id}"] td.col-notes input`);
    return el ? el.value : null;
  }), editableIds);

  const requestLog = [];
  const onReq = (req) => { if (req.url().includes('/daily-ledger/rows/upsert')) requestLog.push(req.method() + ' ' + req.url().replace(APP_URL + '/api/v1', '')); };
  page.on('request', onReq);
  consoleLog.length = 0;
  const flushPromise = waitForConsoleEvent(page, (t) => t.includes('flush_end'), 20000);
  await setReactInputValue(page, dateSel, '2026-07-09');
  await flushPromise;
  await new Promise((r) => setTimeout(r, 300));
  page.off('request', onReq);
  console.log('Requests fired during flush:', requestLog);
  console.log('T1 console:', consoleLog.filter((l) => l.includes('[T1]')));
  console.log(
    requestLog.length === 1 && requestLog[0].includes('upsert-batch')
      ? 'PASS: exactly ONE batch request for 5 dirty rows (was 5 sequential /rows/upsert before the fix).'
      : `CHECK: ${requestLog.length} request(s) — ${JSON.stringify(requestLog)}`,
  );

  console.log('\n=== Restore original notes (cleanup of real mirrored data) ===');
  const backPromise = waitForConsoleEvent(page, (t) => t.includes('render_complete'), 20000);
  await setReactInputValue(page, dateSel, '2026-06-09');
  await backPromise;
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate((ids, originals) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    ids.forEach((id, i) => {
      const el = document.querySelector(`tr[data-ledger-row-id="${id}"] td.col-notes input`);
      if (!el) return;
      setter.call(el, originals[i] ?? '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, editableIds, originalNotesForRestore);
  await new Promise((r) => setTimeout(r, 300));
  const restoreFlush = waitForConsoleEvent(page, (t) => t.includes('flush_end'), 20000);
  await setReactInputValue(page, dateSel, '2026-07-09');
  await restoreFlush;
  console.log('Restore flush done.');

  await browser.close();
  console.log('\n=== DONE ===');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
