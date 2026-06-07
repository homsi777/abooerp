/**
 * تحقق من وجود بيانات دفتر الإدخال السريع لسائق في تاريخ معيّن (تشخيص على السحابة).
 *
 * Usage:
 *   node server/scripts/inspectDriverLedger.cjs "محمود التركي" 2026-06-07
 *   node server/scripts/inspectDriverLedger.cjs "محمود" 2026-06-07
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

const driverSearch = (process.argv[2] || '').trim();
const ledgerDate = (process.argv[3] || '').trim();

if (!driverSearch) {
  console.error('Usage: node server/scripts/inspectDriverLedger.cjs "<driver name>" <YYYY-MM-DD>');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(ledgerDate)) {
  console.error('Invalid date. Use YYYY-MM-DD, e.g. 2026-06-07');
  process.exit(1);
}

function labelNorm(expr) {
  return `lower(regexp_replace(trim(${expr}), E'\\\\s+', ' ', 'g'))`;
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

  console.log('\n=== 1) السائقون المطابقون للبحث ===');
  console.log(`بحث: "${driverSearch}"`);

  const drivers = await client.query(
    `
    select id, full_name, code, status
    from drivers
    where full_name ilike $1
       or code ilike $1
    order by full_name asc
    limit 20
    `,
    [`%${driverSearch}%`],
  );

  if (!drivers.rows.length) {
    console.log('❌ لا يوجد سائق بهذا الاسم في جدول drivers.');
    await client.end();
    process.exit(0);
  }

  for (const d of drivers.rows) {
    console.log(`  • ${d.full_name}  id=${d.id}  code=${d.code ?? '—'}  status=${d.status}`);
  }

  console.log(`\n=== 2) جلسات الدفter في ${ledgerDate} (كل السائقين — للمقارنة) ===`);
  const allSessions = await client.query(
    `
    select
      dls.id,
      dls.line_label,
      dls.driver_id,
      dls.driver_label,
      dls.branch_id,
      count(r.id) filter (where r.deleted_at is null)::int as row_count
    from daily_ledger_sessions dls
    left join daily_ledger_rows r on r.session_id = dls.id and r.deleted_at is null
    where dls.deleted_at is null
      and dls.ledger_date = $1::date
    group by dls.id
    having count(r.id) filter (where r.deleted_at is null) > 0
    order by row_count desc
    limit 30
    `,
    [ledgerDate],
  );

  if (!allSessions.rows.length) {
    console.log(`❌ لا توجد أي جلسة دفter بأسطر في ${ledgerDate}.`);
  } else {
    for (const s of allSessions.rows) {
      console.log(
        `  • id=${s.id}  rows=${s.row_count}  line="${s.line_label}"  driver_id=${s.driver_id ?? 'NULL'}  driver_label="${s.driver_label ?? ''}"`,
      );
    }
  }

  for (const driver of drivers.rows) {
    const driverId = driver.id;
    const driverName = driver.full_name;

    console.log(`\n=== 3) السائق: ${driverName} (${driverId}) — ${ledgerDate} ===`);

    const strict = await client.query(
      `
      select count(*)::int as cnt
      from daily_ledger_rows r
      join daily_ledger_sessions dls on dls.id = r.session_id
      where r.deleted_at is null
        and dls.deleted_at is null
        and dls.ledger_date = $2::date
        and (
          dls.driver_id = $1::uuid
          or (
            dls.driver_id is null
            and nullif(trim(dls.driver_label), '') is not null
            and trim(dls.driver_label) ilike trim($3)
          )
        )
      `,
      [driverId, ledgerDate, driverName],
    );

    const flexible = await client.query(
      `
      select count(*)::int as cnt
      from daily_ledger_rows r
      join daily_ledger_sessions dls on dls.id = r.session_id
      where r.deleted_at is null
        and dls.deleted_at is null
        and dls.ledger_date = $2::date
        and (
          dls.driver_id = $1::uuid
          or (
            nullif(trim(dls.driver_label), '') is not null
            and exists (
              select 1 from drivers dr
              where dr.id = $1::uuid
                and (
                  ${labelNorm('dls.driver_label')} = ${labelNorm("coalesce(dr.full_name, '')")}
                  or ${labelNorm('dls.driver_label')} like '%' || ${labelNorm("coalesce(dr.full_name, '')")} || '%'
                  or ${labelNorm("coalesce(dr.full_name, '')")} like '%' || ${labelNorm('dls.driver_label')} || '%'
                )
            )
          )
          or exists (
            select 1 from vehicles v
            where v.id = dls.vehicle_id and v.driver_id = $1::uuid
          )
        )
      `,
      [driverId, ledgerDate],
    );

    console.log(`  فلتر قديم (تقرير قبل الإصلاح): ${strict.rows[0].cnt} سطر`);
    console.log(`  فلتر جديد (بعد الإصلاح):       ${flexible.rows[0].cnt} سطر`);

    const sessions = await client.query(
      `
      select
        dls.id,
        dls.line_label,
        dls.driver_id,
        dls.driver_label,
        count(r.id)::int as row_count
      from daily_ledger_sessions dls
      join daily_ledger_rows r on r.session_id = dls.id and r.deleted_at is null
      where dls.deleted_at is null
        and dls.ledger_date = $2::date
        and (
          dls.driver_id = $1::uuid
          or (
            nullif(trim(dls.driver_label), '') is not null
            and (
              ${labelNorm('dls.driver_label')} = ${labelNorm('$3')}
              or ${labelNorm('dls.driver_label')} like '%' || ${labelNorm('$3')} || '%'
              or ${labelNorm('$3')} like '%' || ${labelNorm('dls.driver_label')} || '%'
            )
          )
        )
      group by dls.id
      order by row_count desc
      `,
      [driverId, ledgerDate, driverName],
    );

    if (!sessions.rows.length) {
      console.log('  ❌ لا جلسات مرتبطة بهذا السائق في هذا التاريخ.');
      const orphan = allSessions.rows.find(
        (s) => !s.driver_id && !String(s.driver_label ?? '').trim(),
      );
      if (orphan) {
        console.log(
          `\n  ⚠️  يوجد ${orphan.row_count} سطر في جلسة «بدون سائق» (id=${orphan.id}) — هذا سبب التقرير الفارغ.`,
        );
        console.log('  لإصلاحها (إذا كل الأسطر لهذا السائق):');
        console.log(
          `  node server/scripts/assignDriverToOrphanSession.cjs "${driverName}" ${ledgerDate} "${orphan.line_label}"`,
        );
      }
      continue;
    }

    console.log('  الجلسات المرتبطة:');
    for (const s of sessions.rows) {
      console.log(
        `    • ${s.row_count} سطر  line="${s.line_label}"  driver_id=${s.driver_id ?? 'NULL'}  label="${s.driver_label ?? ''}"`,
      );
    }

    const samples = await client.query(
      `
      select r.row_no, r.receipt_no, r.destination, dls.line_label, dls.driver_label
      from daily_ledger_rows r
      join daily_ledger_sessions dls on dls.id = r.session_id
      where r.deleted_at is null
        and dls.deleted_at is null
        and dls.ledger_date = $2::date
        and dls.id = any($4::uuid[])
      order by dls.line_label, r.row_no
      limit 8
      `,
      [driverId, ledgerDate, driverName, sessions.rows.map((s) => s.id)],
    );

    console.log('  عينة من الأسطر:');
    for (const r of samples.rows) {
      console.log(
        `    #${r.row_no}  receipt=${r.receipt_no ?? '—'}  dest=${r.destination ?? '—'}  line="${r.line_label}"  label="${r.driver_label ?? ''}"`,
      );
    }
  }

  const mig = await client.query(
    `select name from schema_migrations where name like '%095%' or name like '%daily_ledger%' order by name desc limit 5`,
  );
  console.log('\n=== 4) آخر migrations متعلقة بالدفter ===');
  for (const m of mig.rows) console.log(`  • ${m.name}`);

  console.log('\nDone.\n');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
