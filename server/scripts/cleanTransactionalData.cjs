/**
 * يمسح الحركات المالية والسندات (قبض/دفع) وصندوق النقدية — إن كانت قاعدتك ملوثة ببيانات خادمات اختبار.
 * التشغيل:  set ALLOW_TRANSACTIONAL_CLEAN=true   ثم   npm run server:clean-transactional
 * لا يُشغَّل في الإنتاج إلا بقصد صريح (يضبط ALLOW_TRANSACTIONAL_CLEAN).
 */
const { config } = require('dotenv');
const { Client } = require('pg');
const path = require('path');

config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TRANSACTIONAL_CLEAN !== 'true') {
    console.error('[clean] Refused: set ALLOW_TRANSACTIONAL_CLEAN=true in production (intentional wipe).');
    process.exit(1);
  }
  if (process.env.ALLOW_TRANSACTIONAL_CLEAN !== 'true') {
    console.error('[clean] Refused: set environment variable ALLOW_TRANSACTIONAL_CLEAN=true');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[clean] DATABASE_URL missing.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('delete from party_financial_movements where reversal_of_movement_id is not null');
    await client.query('delete from party_financial_movements');
    await client.query('delete from cashbox_transactions');
    await client.query('delete from receipt_vouchers');
    await client.query('delete from payment_vouchers');
    await client.query('commit');
    console.info('[clean] تم حذف السندات والحركات المالية ومعالجات الصندوق.');
  } catch (e) {
    await client.query('rollback');
    console.error('[clean] فشل:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
