#!/usr/bin/env node
/**
 * تفعيل ترخيص إنتاجي غير محدود (LOCAL_1) للشركة الافتراضية — طوارئ عند انتهاء TEST1.
 * الاستخدام على VPS:
 *   node server/scripts/activateProductionLicense.cjs
 *   node server/scripts/activateProductionLicense.cjs A3K7-Q9X2-R4M8-B6N5
 */
const path = require('node:path');
const { config } = require('dotenv');
const { Pool } = require('pg');

const envPath = path.resolve(process.cwd(), 'server/.env');
config({ path: envPath });
config({ path: path.resolve(process.cwd(), '.env') });

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: ['true', '1', 'yes', 'on'].includes(String(process.env.PGSSL_ENABLED || '').toLowerCase())
    ? { rejectUnauthorized: !['false', '0', 'no', 'off'].includes(String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase()) }
    : false,
});

const licenseCode = (process.argv[2] || process.env.LICENSE_LOCAL_KEYS || 'PRODUCTION-VPS')
  .split(',')[0]
  .trim()
  .toUpperCase();

async function main() {
  const company = await pool.query(`select id from companies order by created_at asc limit 1`);
  const companyId = company.rows[0]?.id;
  if (!companyId) {
    console.error('No company found.');
    process.exit(1);
  }

  await pool.query(`update license_activations set is_active = false where company_id = $1`, [companyId]);
  await pool.query(
    `
    insert into license_activations(
      company_id, license_code, license_type, is_active, cloud_enabled,
      shipment_limit, delivery_limit, receipt_limit, activated_at
    )
    values ($1, $2, 'LOCAL_1', true, false, null, null, null, now())
    on conflict (company_id, license_code) do update set
      is_active = true,
      license_type = 'LOCAL_1',
      shipment_limit = null,
      delivery_limit = null,
      receipt_limit = null,
      activated_at = now()
    `,
    [companyId, licenseCode],
  );

  console.log(`License activated: LOCAL_1 / ${licenseCode} for company ${companyId}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
