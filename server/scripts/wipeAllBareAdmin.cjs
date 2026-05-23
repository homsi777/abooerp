/**
 * يمسح كل البيانات التشغيلية في قاعدة البيانات ويُبقي:
 * - أدوار وصلاحيات النظام (roles / permissions) كما هي
 * - شركة افتراضية + فرع واحد + عملات/أسعار صرف بحد أدنى
 * - مستخدم واحد: admin / admin123
 *
 * لا يعيد إدراج: عملاء، شحنات، بـوليصة، مندوبين، طابعات، مدن/تعرفة، سجلات.
 *
 * التشغيل (PowerShell):
 *   $env:ALLOW_BARE_WIPE="true"
 *   npm run server:wipe-bare
 *
 * في الإنتاج يُشترط أيضاً الـ Intention: ALLOW_BARE_WIPE=true
 */
const { config } = require('dotenv');
const { Client } = require('pg');
const path = require('path');

config({ path: path.join(__dirname, '..', '.env') });

const PASSWORD_HASH_ADMIN123 =
  '$2b$12$DhHINhwbKZKCDDiDhlo9aOsXhJhyYywJhdqYyiYZF4.745yqHJ3Uy';

/** @param {import('pg').Client} c */
async function runOptional(c, label, sql) {
  try {
    await c.query(sql);
  } catch (e) {
    if (e && e.code === '42P01') {
      console.warn(`[wipe] تجاهل: جدول غير موجود — ${label}`);
      return;
    }
    throw e;
  }
}

async function main() {
  if (process.env.ALLOW_BARE_WIPE !== 'true') {
    console.error(
      '[wipe] مرفوض: عيّن متغيّر البيئة ALLOW_BARE_WIPE=true (إجراء مدمر صريح).'
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_BARE_WIPE_IN_PROD !== 'true') {
    console.error(
      '[wipe] مرفوض في production: لإلغاء الحماية عيّن ALLOW_BARE_WIPE_IN_PROD=true (مع ALLOW_BARE_WIPE=true).'
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[wipe] DATABASE_URL غير مضبوط.');
    process.exit(1);
  }

  const c = new Client({ connectionString });
  await c.connect();
  try {
    await c.query('begin');

    await c.query('delete from party_financial_movements where reversal_of_movement_id is not null');
    await c.query('delete from party_financial_movements');
    await c.query('delete from cashbox_transactions');
    await c.query('delete from receipt_vouchers');
    await c.query('delete from payment_vouchers');
    await c.query('delete from manifest_shipments');
    await c.query('delete from shipment_status_history');
    await c.query('delete from deliveries');
    await c.query('delete from shipments');
    await c.query('delete from manifests');
    await c.query('delete from customers');
    await c.query('delete from senders_receivers');
    await c.query('delete from drivers');
    await c.query('delete from vehicles');
    await c.query('delete from agents');
    await c.query('delete from tariffs');
    await c.query('delete from cities');
    await c.query('delete from goods_types');

    await c.query('delete from idempotency_keys');
    await c.query('delete from printer_routes');
    await c.query('delete from printers');
    await c.query('delete from backup_records');
    await c.query('delete from restore_execution_tokens');
    await c.query('delete from audit_logs');
    await c.query('delete from system_settings');
    await c.query('delete from terminology_settings');
    await c.query('delete from shipping_label_settings');
    await c.query('delete from user_branches');
    await c.query('delete from auth_sessions');
    await runOptional(c, 'dashboard_cache_reset_audit', 'delete from dashboard_cache_reset_audit');
    await runOptional(
      c,
      'dashboard_cache_metrics_state',
      `update dashboard_cache_metrics_state set
         ttl_ms = 15000,
         reset_enabled = true,
         reset_require_confirm = false,
         cache_entries = 0,
         in_flight_entries = 0,
         hits = 0,
         misses = 0,
         in_flight_hits = 0,
         sets = 0,
         invalidations = 0,
         evictions = 0,
         updated_at = now()
       where id = true`
    );

    await c.query('delete from users');
    await c.query('delete from exchange_rates');
    await c.query('delete from currencies');
    await c.query('update roles set company_id = null where company_id is not null');
    await c.query('delete from branches');
    await c.query('delete from companies');

    const roleRes = await c.query("select id from roles where code = 'admin' limit 1");
    if (!roleRes.rowCount) {
      throw new Error(
        'لا يوجد دور admin. شغّل الترحيلات و seed أولاً (npm run server:migrate && npm run server:seed).'
      );
    }
    const adminRoleId = roleRes.rows[0].id;

    await c.query(`
      insert into companies(code, name, is_active)
      values ('COMP-DEFAULT', 'مؤسسة شحن — حلب', true)
    `);

    const comp = await c.query("select id from companies where code = 'COMP-DEFAULT' limit 1");
    const companyId = comp.rows[0].id;

    await c.query(
      `
      insert into branches(code, name, city, address, phone, company_id, is_active)
      values ($1, $2, $3, $4, $5, $6, true)
    `,
      [
        'HLP-GML',
        'حلب - الجميلية (المقر الرئيسي)',
        'حلب',
        'الجميلية',
        '+963213000000',
        companyId,
      ]
    );

    const br = await c.query("select id from branches where code = 'HLP-GML' limit 1");
    const branchId = br.rows[0].id;

    await c.query(
      `
      insert into currencies(code, name, symbol, decimal_places, is_base, is_active, company_id)
      values
        ('USD', 'US Dollar', '$', 2, true, true, $1),
        ('SYP', 'Syrian Pound', 'SYP', 2, false, true, $1),
        ('TRY', 'Turkish Lira', 'TRY', 2, false, true, $1),
        ('EUR', 'Euro', 'EUR', 2, false, true, $1)
    `,
      [companyId]
    );

    await c.query(
      `
      insert into exchange_rates(
        base_currency, quote_currency, currency_id, company_id, rate, source, effective_at, effective_date, is_active
      )
      select
        'USD' as base_currency,
        c.code as quote_currency,
        c.id,
        c.company_id,
        case
          when c.code = 'USD' then 1::numeric
          when c.code = 'SYP' then 0.000077::numeric
          when c.code = 'TRY' then 0.031::numeric
          when c.code = 'EUR' then 1.08::numeric
          else 1::numeric
        end,
        'seed',
        now(),
        current_date,
        true
      from currencies c
      where c.company_id = $1
    `,
      [companyId]
    );

    await c.query(
      `
      insert into users(
        username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, agent_id, status, is_active
      )
      values ($1, $2, $3, $4, $5, $6, 'admin', $7, $8, null, 'active', true)
    `,
      [
        'admin',
        'مدير النظام',
        'admin@local.erp',
        '+963999999',
        PASSWORD_HASH_ADMIN123,
        adminRoleId,
        companyId,
        branchId,
      ]
    );

    const u = await c.query("select id from users where username = 'admin' limit 1");
    const userId = u.rows[0].id;
    await c.query(
      'insert into user_branches(user_id, branch_id) values ($1, $2) on conflict (user_id, branch_id) do nothing',
      [userId, branchId]
    );

    await c.query(
      `
      insert into system_settings(company_id, key, value, is_encrypted)
      select c.id, v.key, v.value::jsonb, false
      from companies c
      cross join (
        values
          ('network.mode', '"local_only"'),
          ('network.host', '"127.0.0.1"'),
          ('network.port', '3001'),
          ('network.protocol', '"http"'),
          ('network.publicUrl', '""'),
          ('network.lanEnabled', 'false'),
          ('runtime.environment', '"development"'),
          ('runtime.offlineMode', 'false'),
          ('runtime.autoReconnect', 'true'),
          ('runtime.deviceName', '"حلب-الجميلية"'),
          ('runtime.maintenanceMode', 'false'),
          ('diagnostics.enabled', 'true'),
          ('diagnostics.level', '"info"'),
          ('electron.autoLaunch', 'false'),
          ('electron.autoUpdateEnabled', 'true'),
          ('electron.windowMode', '"windowed"'),
          ('backup.autoEnabled', 'true'),
          ('backup.intervalHours', '24'),
          ('backup.retentionDays', '30'),
          ('backup.verifyAfterCreate', 'true')
      ) as v(key, value)
      where c.code = 'COMP-DEFAULT'
    `
    );

    await c.query(
      `
      insert into terminology_settings(company_id, terms, updated_by)
      select c.id, '{}'::jsonb, null
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id) do update set terms = excluded.terms, updated_at = now()
    `
    );
    await c.query(
      `
      insert into shipping_label_settings(company_id, config, updated_by)
      select c.id, '{}'::jsonb, null
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id) do update set config = excluded.config, updated_at = now()
    `
    );

    await c.query('commit');
    console.info(
      '[wipe] اكتمل: قاعدة بيانات فارغة. تسجيل الدخول: admin / admin123 (غيّرها فوراً).'
    );
  } catch (e) {
    await c.query('rollback');
    console.error('[wipe] فشل:', e);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main();
