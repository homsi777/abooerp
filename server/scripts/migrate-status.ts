import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db/pool.js';

const REQUIRED_FOR_VEHICLE_REPORT = [
  '074_daily_shipment_ledger.sql',
  '077_transfer_service_fee_v3.sql',
  '086_daily_ledger_driver_vehicle.sql',
];

async function main() {
  const migrationsDir = path.resolve(process.cwd(), 'server/src/db/migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = await pool.query<{ name: string }>('select name from schema_migrations order by name');
  const appliedSet = new Set(applied.rows.map((row) => row.name));
  const pending = files.filter((file) => !appliedSet.has(file));

  console.log(`Applied: ${appliedSet.size} / ${files.length}`);
  if (pending.length) {
    console.log('\nPending migrations:');
    for (const file of pending) console.log(`  - ${file}`);
  } else {
    console.log('\nAll migration files are applied.');
  }

  const missingRequired = REQUIRED_FOR_VEHICLE_REPORT.filter((file) => !appliedSet.has(file));
  if (missingRequired.length) {
    console.log('\nVehicle trip report requires these migrations (not applied yet):');
    for (const file of missingRequired) console.log(`  ! ${file}`);
    console.log('\nRun: npm run server:migrate');
    process.exitCode = 1;
  } else {
    console.log('\nVehicle trip report prerequisites: OK');
  }

  const columnCheck = await pool.query<{ ok: boolean }>(`
    select exists (
      select 1
      from information_schema.columns
      where table_name = 'daily_ledger_rows'
        and column_name = 'transfer_service_fee_usd'
    ) as ok
  `);
  if (!columnCheck.rows[0]?.ok) {
    console.error('\nMissing column daily_ledger_rows.transfer_service_fee_usd — run npm run server:migrate');
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
