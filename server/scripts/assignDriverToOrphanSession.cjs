/**
 * ربط جلسة «بدون سائق» بسائق محدّد (إصلاح بيانات قديمة).
 *
 * Usage:
 *   node server/scripts/assignDriverToOrphanSession.cjs "محمود التركي" 2026-06-07 "فرع حلب"
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const driverName = (process.argv[2] || '').trim();
const ledgerDate = (process.argv[3] || '').trim();
const lineLabel = (process.argv[4] || '').trim();
const dryRun = process.argv.includes('--dry-run');

if (!driverName || !/^\d{4}-\d{2}-\d{2}$/.test(ledgerDate) || !lineLabel) {
  console.error(
    'Usage: node server/scripts/assignDriverToOrphanSession.cjs "<driver name>" <YYYY-MM-DD> "<line label>" [--dry-run]',
  );
  process.exit(1);
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await client.connect();

  const driver = await client.query(
    `select id, full_name from drivers where full_name ilike $1 order by full_name limit 1`,
    [driverName],
  );
  if (!driver.rows.length) {
    console.error(`❌ لم يُعثر على سائق: ${driverName}`);
    await client.end();
    process.exit(1);
  }
  const driverId = driver.rows[0].id;
  const fullName = driver.rows[0].full_name;

  const orphan = await client.query(
    `
    select
      dls.id,
      count(r.id)::int as row_count
    from daily_ledger_sessions dls
    join daily_ledger_rows r on r.session_id = dls.id and r.deleted_at is null
    where dls.deleted_at is null
      and dls.ledger_date = $1::date
      and dls.line_label = $2
      and dls.driver_id is null
      and coalesce(trim(dls.driver_label), '') = ''
    group by dls.id
    order by row_count desc
    limit 1
    `,
    [ledgerDate, lineLabel],
  );

  if (!orphan.rows.length) {
    console.log('❌ لا توجد جلسة «بدون سائق» لهذا التاريخ والخط.');
    await client.end();
    process.exit(0);
  }

  const sessionId = orphan.rows[0].id;
  const rowCount = orphan.rows[0].row_count;

  console.log(`\nسيتم ربط ${rowCount} سطر`);
  console.log(`  جلسة: ${sessionId}`);
  console.log(`  سائق: ${fullName} (${driverId})`);
  console.log(`  تاريخ: ${ledgerDate}  خط: ${lineLabel}`);

  if (dryRun) {
    console.log('\n--dry-run: لم يُنفَّذ أي تحديث.');
    await client.end();
    return;
  }

  await client.query('begin');
  try {
    const updated = await client.query(
      `
      update daily_ledger_sessions
      set driver_id = $2::uuid, driver_label = $3, updated_at = now()
      where id = $1::uuid
        and deleted_at is null
        and driver_id is null
      returning id
      `,
      [sessionId, driverId, fullName],
    );
    if (!updated.rowCount) {
      throw new Error('تعذر تحديث الجلسة — ربما رُبطت مسبقاً.');
    }
    await client.query('commit');
    console.log('\n✅ تم الربط بنجاح. أعد فتح تقرير السيارة.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
