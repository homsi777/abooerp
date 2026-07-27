// TEMPORARY verification script for the new upsert-batch endpoint. Safe to delete after use.
const BASE = 'http://127.0.0.1:4010/api/v1';
const BRANCH_ID = '2d5b831a-4b19-411e-a641-22c4a8ad56ef'; // الفرع الرئيسي
const DATE = '2099-11-15'; // synthetic, clearly fake — never touches real mirrored dates
const LINE = 'PERF_VERIFY_BATCH';

async function loginAdmin() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const json = await res.json();
  if (!json.success) throw new Error('login failed: ' + JSON.stringify(json));
  return json.data.session.accessToken;
}

function baseRow(rowNo, receiptNo) {
  return {
    branchId: BRANCH_ID,
    ledgerDate: DATE,
    lineLabel: LINE,
    rowNo,
    receiptNo,
    destination: 'دمشق',
    parcelType: 'بضائع عامة',
    parcelCount: 1,
    weightKg: 5,
    senderName: `Verify Sender ${rowNo}`,
    receiverName: `Verify Receiver ${rowNo}`,
    collectAmountUsd: 10,
  };
}

async function post(token, rows) {
  const res = await fetch(`${BASE}/daily-ledger/rows/upsert-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rows }),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const token = await loginAdmin();
  const tag = Date.now();

  console.log('=== Step 1: create 2 baseline rows (both should succeed) ===');
  const seedRows = [baseRow(1, `VERIFY-${tag}-A`), baseRow(2, `VERIFY-${tag}-B`)];
  const seed = await post(token, seedRows);
  console.log('seed results:', seed.json.data.results.map((r) => ({ success: r.success, id: r.row?.id, receipt: r.row?.receipt_no })));
  const rowA = seed.json.data.results[0].row;
  const rowB = seed.json.data.results[1].row;

  console.log('\n=== Step 2: batch with [update rowA to collide with rowB receipt] + [valid new row C] ===');
  const batch2 = [
    { ...baseRow(1, `VERIFY-${tag}-B`), rowId: rowA.id }, // update A's receipt to collide with B -> should fail (409)
    baseRow(3, `VERIFY-${tag}-C`), // unrelated valid new row -> should succeed
  ];
  const res2 = await post(token, batch2);
  console.log('HTTP status:', res2.status);
  const results2 = res2.json.data.results;
  console.log(JSON.stringify(results2.map((r) => ({ index: r.index, success: r.success, error: r.error, receipt: r.row?.receipt_no })), null, 2));

  const conflictFailed = results2[0].success === false;
  const thirdSucceeded = results2[1].success === true;
  console.log(`\nRow-A-conflict correctly failed: ${conflictFailed} (expect true)`);
  console.log(`Row-C still succeeded despite row A's failure: ${thirdSucceeded} (expect true)`);
  console.log(conflictFailed && thirdSucceeded ? '\nPASS: genuine partial failure handled correctly.' : '\nFAIL: partial-failure semantics broken.');

  console.log('\n=== Step 3: verify DB state — rowA must be UNCHANGED (still its original receipt), no corruption ===');
  const { Client } = require('pg');
  const c = new Client({ host: '127.0.0.1', port: 5432, database: 'almiya_hsahin', user: 'postgres', password: '12345678', ssl: false });
  await c.connect();
  const check = await c.query(`select id, row_no, receipt_no, sender_name from daily_ledger_rows where id = $1`, [rowA.id]);
  console.log('rowA current DB state:', check.rows[0]);
  const untouched = check.rows[0]?.receipt_no === `VERIFY-${tag}-A` && check.rows[0]?.sender_name === 'Verify Sender 1';
  console.log(untouched ? 'PASS: rowA left completely untouched by the failed update (no partial write).' : 'FAIL: rowA was partially modified despite the conflict failure.');

  await c.query(`delete from daily_ledger_rows where session_id in (select id from daily_ledger_sessions where line_label=$1 and ledger_date=$2::date)`, [LINE, DATE]);
  await c.query(`delete from daily_ledger_sessions where line_label=$1 and ledger_date=$2::date`, [LINE, DATE]);
  await c.end();
  console.log('\nCleanup done.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
