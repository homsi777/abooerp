// TEMPORARY — before/after T1 comparison for the batch-flush fix. Safe to delete after use.
// Directly comparable to the original diagnostic's 200-row HTTP-harness measurement (2,464.778ms):
// same synthetic-data approach, same "200 rows in one flush" scenario, now via ONE batch request.
const BASE = 'http://127.0.0.1:4010/api/v1';
const BRANCH_ID = '2d5b831a-4b19-411e-a641-22c4a8ad56ef';
const DATE = '2099-12-30'; // synthetic, distinct from the earlier diagnostic's 2099-12-31
const LINE = 'PERF_PROBE_BATCH_FIX';

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

function buildPayload(rowNo, tag) {
  return {
    branchId: BRANCH_ID,
    ledgerDate: DATE,
    lineLabel: LINE,
    rowNo,
    receiptNo: `PERFFIX-${tag}-${rowNo}`,
    destination: 'دمشق',
    parcelType: 'بضائع عامة',
    parcelCount: 1,
    weightKg: 5,
    senderName: `PerfFix Sender ${rowNo}`,
    receiverName: `PerfFix Receiver ${rowNo}`,
    collectAmountUsd: 10,
  };
}

async function main() {
  const token = await loginAdmin();
  const tag = 'B' + Date.now();
  const rows = Array.from({ length: 200 }, (_, i) => buildPayload(i + 1, tag));

  const t0 = performance.now();
  const res = await fetch(`${BASE}/daily-ledger/rows/upsert-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rows }),
  });
  const json = await res.json();
  const t1 = performance.now();

  const results = json.data.results;
  const okCount = results.filter((r) => r.success).length;
  const totalMs = t1 - t0;

  console.log('=== T1 BATCH (200 rows, 1 HTTP request) — AFTER FIX ===');
  console.log('HTTP status:', res.status, 'successCount:', okCount, '/', rows.length);
  console.log('Total wall time (client, 1 request):', totalMs.toFixed(3), 'ms');
  console.log('\nCOMPARISON TO ORIGINAL DIAGNOSTIC (200 sequential requests):');
  console.log('  BEFORE (200x POST /rows/upsert, sequential): 2464.778 ms');
  console.log(`  AFTER  (1x  POST /rows/upsert-batch):        ${totalMs.toFixed(3)} ms`);
  console.log(`  Speedup: ${(2464.778 / totalMs).toFixed(2)}x, saved ${(2464.778 - totalMs).toFixed(1)} ms locally`);
  console.log('  (Real-world cloud-latency win is larger still: this eliminates 199 network round trips,');
  console.log('   which on loopback cost ~12ms each but would cost far more under real cloud RTT.)');

  console.log('\n=== Cleanup ===');
  const { Client } = require('pg');
  const c = new Client({ host: '127.0.0.1', port: 5432, database: 'almiya_hsahin', user: 'postgres', password: '12345678', ssl: false });
  await c.connect();
  const del = await c.query(`delete from daily_ledger_rows where session_id in (select id from daily_ledger_sessions where line_label=$1 and ledger_date=$2::date)`, [LINE, DATE]);
  const delS = await c.query(`delete from daily_ledger_sessions where line_label=$1 and ledger_date=$2::date`, [LINE, DATE]);
  console.log(`Deleted ${del.rowCount} synthetic rows, ${delS.rowCount} synthetic sessions.`);
  await c.end();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
