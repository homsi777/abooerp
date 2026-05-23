/**
 * seed.ts — First-Run Clean State Seeder
 *
 * Always runs idempotently. On first run it wipes all operational data and
 * sets up a single Arabic main branch + admin account ready for customer use.
 *
 * Structural data (companies, roles, permissions, currencies, reference tables,
 * system settings) is upserted on every run and never destructively removed.
 *
 * Operational data is truncated on FIRST run only
 * (i.e., when no branch with code='MAIN' exists yet).
 * On subsequent runs the truncation is skipped so live data is preserved.
 */

import { pool } from './pool.js';
import { env } from '../config/env.js';

export async function runSeed() {
  if (env.NODE_ENV === 'production' && process.env.ALLOW_DB_SEED !== 'true') {
    throw new Error(
      'Seeding is disabled in production. Set ALLOW_DB_SEED=true to override intentionally.',
    );
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // ─── 1. DETECT FIRST-RUN ──────────────────────────────────────────────────
    // First run = MAIN branch does not yet exist → wipe operational data.
    const mainBranchCheck = await client.query(
      `select id from branches where code = 'MAIN' limit 1`,
    );
    const isFirstRun = mainBranchCheck.rowCount === 0;

    if (isFirstRun) {
      console.info('[SEED] First-run detected → cleaning operational tables…');
      // Use TRUNCATE CASCADE to handle all FK dependencies automatically.
      // We truncate leaf-to-root where possible, then cascade the rest.
      // Structural tables (companies, roles, permissions, currencies, schema_migrations) are NOT touched.
      await client.query(`
        truncate table
          audit_logs,
          auth_sessions,
          idempotency_keys,
          shipment_inventory_movements,
          shipment_labels,
          party_financial_movements,
          cashbox_transactions,
          receipt_vouchers,
          payment_vouchers,
          deliveries,
          manifests,
          shipments,
          tariffs,
          salary_records,
          employee_advances,
          employees,
          item_stock,
          warehouses,
          items,
          printer_routes,
          printers,
          agents,
          user_branches,
          users,
          branches
        restart identity cascade
      `);
      console.info('[SEED] Operational tables cleared.');
    } else {
      console.info('[SEED] Subsequent run → structural upsert only (live data preserved).');
    }

    // ─── 2. COMPANY ───────────────────────────────────────────────────────────
    await client.query(`
      insert into companies(code, name, is_active)
      values ('COMP-DEFAULT', 'مؤسسة شامل للشحن', true)
      on conflict (code) do update set
        name       = excluded.name,
        is_active  = excluded.is_active,
        updated_at = now()
    `);

    // ─── 3. CURRENCIES ────────────────────────────────────────────────────────
    await client.query(`
      insert into currencies(code, name, symbol, decimal_places, is_base, is_active, company_id)
      select * from (
        values
          ('USD', 'دولار أمريكي',   '$',   2, true,  true),
          ('SYP', 'ليرة سورية',     'ل.س', 2, false, true),
          ('TRY', 'ليرة تركية',     '₺',   2, false, true),
          ('EUR', 'يورو',            '€',   2, false, true),
          ('SAR', 'ريال سعودي',     '﷼',   2, false, true),
          ('AED', 'درهم إماراتي',   'د.إ', 2, false, true)
      ) as v(code, name, symbol, decimal_places, is_base, is_active)
      cross join (
        select id from companies where code = 'COMP-DEFAULT' limit 1
      ) c
      on conflict (code) do update set
        name          = excluded.name,
        symbol        = excluded.symbol,
        decimal_places= excluded.decimal_places,
        is_base       = excluded.is_base,
        is_active     = excluded.is_active,
        company_id    = excluded.company_id,
        updated_at    = now()
    `);

    await client.query(`
      insert into exchange_rates(
        base_currency, quote_currency, currency_id, company_id,
        rate, source, effective_at, effective_date, is_active
      )
      select
        'USD',
        c.code,
        c.id,
        c.company_id,
        case
          when c.code = 'USD' then 1::numeric
          when c.code = 'SYP' then 0.000077::numeric
          when c.code = 'TRY' then 0.031::numeric
          when c.code = 'EUR' then 1.08::numeric
          when c.code = 'SAR' then 0.267::numeric
          when c.code = 'AED' then 0.272::numeric
          else 1::numeric
        end,
        'seed',
        now(),
        current_date,
        true
      from currencies c
      where c.company_id = (select id from companies where code = 'COMP-DEFAULT' limit 1)
      on conflict (currency_id, effective_date, company_id) do update set
        rate       = excluded.rate,
        source     = excluded.source,
        updated_at = now()
    `);

    // ─── 4. ROLES ─────────────────────────────────────────────────────────────
    await client.query(`
      insert into roles(code, name, description, is_active)
      values
        ('admin',      'مدير النظام',      'صلاحيات كاملة على جميع الوحدات',   true),
        ('accountant', 'محاسب',            'عمليات المالية والتقارير',          true),
        ('manager',    'مدير فرع',         'إدارة الفروع والعمليات',            true),
        ('cashier',    'أمين صندوق',       'عمليات الصناديق',                   true),
        ('operator',   'موظف عمليات',      'عمليات الشحن اليومية',             true),
        ('viewer',     'مشاهد فقط',        'صلاحية القراءة فقط',               true)
      on conflict (code) do update set
        name        = excluded.name,
        description = excluded.description,
        is_active   = excluded.is_active,
        updated_at  = now()
    `);

    await client.query(`
      update roles set is_system = true
      where code in ('admin','accountant','manager','cashier','operator','viewer')
    `);

    // ─── 5. PERMISSIONS (all modules) ────────────────────────────────────────
    await client.query(`
      insert into permissions(code, name, module, action, is_active)
      values
        -- shipping
        ('shipments.read',  'قراءة الشحنات',           'shipments',  'read',  true),
        ('shipments.write', 'كتابة الشحنات',           'shipments',  'write', true),
        ('manifests.read',  'قراءة البيانات',           'manifests',  'read',  true),
        ('manifests.write', 'كتابة البيانات',           'manifests',  'write', true),
        ('deliveries.read', 'قراءة التسليمات',          'deliveries', 'read',  true),
        ('deliveries.write','كتابة التسليمات',          'deliveries', 'write', true),
        -- finance
        ('finance.read',               'قراءة المالية',           'finance',          'read',  true),
        ('finance.write',              'كتابة المالية',           'finance',          'write', true),
        ('finance.vouchers.read',      'قراءة السندات',           'finance_vouchers', 'read',  true),
        ('finance.vouchers.write',     'كتابة السندات',           'finance_vouchers', 'write', true),
        ('finance.cashbox.read',       'قراءة الصناديق',          'finance_cashbox',  'read',  true),
        ('finance.cashbox.write',      'كتابة الصناديق',          'finance_cashbox',  'write', true),
        -- hr / salaries
        ('hr.employees.read',  'قراءة الموظفين',      'hr', 'read',  true),
        ('hr.employees.write', 'كتابة الموظفين',      'hr', 'write', true),
        ('hr.salaries.read',   'قراءة الرواتب',       'hr', 'read',  true),
        ('hr.salaries.write',  'كتابة الرواتب',       'hr', 'write', true),
        ('hr.advances.read',   'قراءة السلف',         'hr', 'read',  true),
        ('hr.advances.write',  'كتابة السلف',         'hr', 'write', true),
        -- inventory
        ('inventory.read',  'قراءة المخزون',  'inventory', 'read',  true),
        ('inventory.write', 'كتابة المخزون',  'inventory', 'write', true),
        -- settings
        ('settings.branches.read',        'قراءة الفروع',         'settings_branches',       'read',  true),
        ('settings.branches.write',       'كتابة الفروع',         'settings_branches',       'write', true),
        ('settings.agents.read',          'قراءة الوكلاء',        'settings_agents',         'read',  true),
        ('settings.agents.write',         'كتابة الوكلاء',        'settings_agents',         'write', true),
        ('settings.users.read',           'قراءة المستخدمين',     'settings_users',          'read',  true),
        ('settings.users.write',          'كتابة المستخدمين',     'settings_users',          'write', true),
        ('settings.roles.read',           'قراءة الأدوار',        'settings_roles',          'read',  true),
        ('settings.roles.write',          'كتابة الأدوار',        'settings_roles',          'write', true),
        ('settings.currencies.read',      'قراءة العملات',        'settings_currencies',     'read',  true),
        ('settings.currencies.write',     'كتابة العملات',        'settings_currencies',     'write', true),
        ('settings.exchangeRates.read',   'قراءة أسعار الصرف',   'settings_exchange_rates', 'read',  true),
        ('settings.exchangeRates.write',  'كتابة أسعار الصرف',   'settings_exchange_rates', 'write', true),
        ('settings.audit.read',           'قراءة سجل التدقيق',   'settings_audit',          'read',  true),
        ('admin.events.read',             'سجل الأحداث (المدير العام)', 'admin_events',    'read',  true),
        ('settings.system.read',          'قراءة إعدادات النظام', 'settings_system',         'read',  true),
        ('settings.system.write',         'كتابة إعدادات النظام', 'settings_system',         'write', true),
        ('settings.printers.read',        'قراءة الطابعات',       'settings_printers',       'read',  true),
        ('settings.printers.write',       'كتابة الطابعات',       'settings_printers',       'write', true),
        ('settings.backup.read',          'قراءة النسخ الاحتياطي','settings_backup',          'read',  true),
        ('settings.backup.write',         'كتابة النسخ الاحتياطي','settings_backup',          'write', true),
        ('settings.terminology.read',     'قراءة المصطلحات',      'settings_terminology',    'read',  true),
        ('settings.terminology.write',    'كتابة المصطلحات',      'settings_terminology',    'write', true),
        ('settings.shippingLabel.read',   'قراءة إعدادات الملصق', 'settings_shipping_label', 'read',  true),
        ('settings.shippingLabel.write',  'كتابة إعدادات الملصق', 'settings_shipping_label', 'write', true)
      on conflict (code) do update set
        name      = excluded.name,
        module    = excluded.module,
        action    = excluded.action,
        is_active = excluded.is_active,
        updated_at = now()
    `);

    // admin role → ALL permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r cross join permissions p
      where r.code = 'admin'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // operator permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read','shipments.write',
        'manifests.read','manifests.write',
        'deliveries.read','deliveries.write',
        'finance.read','finance.vouchers.read',
        'finance.cashbox.read','finance.cashbox.write'
      )
      where r.code = 'operator'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // accountant permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read','manifests.read','deliveries.read',
        'finance.read','finance.write',
        'finance.vouchers.read','finance.vouchers.write',
        'finance.cashbox.read','finance.cashbox.write',
        'hr.salaries.read','hr.advances.read','hr.employees.read',
        'settings.currencies.read','settings.exchangeRates.read',
        'settings.audit.read','settings.branches.read'
      )
      where r.code = 'accountant'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // manager permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read','shipments.write',
        'manifests.read','manifests.write',
        'deliveries.read','deliveries.write',
        'settings.users.read','settings.roles.read',
        'settings.branches.read','settings.agents.read','settings.agents.write',
        'settings.currencies.read','settings.exchangeRates.read',
        'settings.system.read','settings.printers.read',
        'settings.backup.read','settings.terminology.read',
        'settings.shippingLabel.read','hr.employees.read',
        'hr.salaries.read','hr.advances.read'
      )
      where r.code = 'manager'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // cashier permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'finance.read','finance.vouchers.read','finance.vouchers.write',
        'finance.cashbox.read','finance.cashbox.write'
      )
      where r.code = 'cashier'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // viewer permissions
    await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read','manifests.read','deliveries.read',
        'finance.read','finance.vouchers.read','finance.cashbox.read'
      )
      where r.code = 'viewer'
      on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
    `);

    // ─── 6. MAIN BRANCH ────────────────────────────────────────────────────────
    await client.query(`
      insert into branches(code, name, city, address, phone, company_id, is_active)
      select
        'MAIN',
        'الفرع الرئيسي',
        'غير محدد',
        '',
        '',
        c.id,
        true
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (code) do update set
        name       = excluded.name,
        is_active  = excluded.is_active,
        updated_at = now()
    `);

    // ─── 7. ADMIN USER  (admin / admin123) ────────────────────────────────────
    // Hash is bcrypt(admin123, rounds=12)
    await client.query(`
      insert into users(
        username, full_name, email, phone,
        password_hash, role_id, role,
        company_id, branch_id, agent_id,
        status, is_active
      )
      select
        'admin',
        'مدير النظام',
        'admin@local.erp',
        '',
        '$2b$12$W..adufE0JLF/8AZY0TyQ.PLK17nNbn8V3gcsf2zdhwB9zwA28Odm',
        r.id,
        r.code,
        b.company_id,
        b.id,
        null,
        'active',
        true
      from roles r
      join branches b on b.code = 'MAIN'
      where r.code = 'admin'
      on conflict (username) do update set
        password_hash = excluded.password_hash,
        role_id       = excluded.role_id,
        role          = excluded.role,
        company_id    = excluded.company_id,
        branch_id     = excluded.branch_id,
        status        = excluded.status,
        is_active     = excluded.is_active,
        updated_at    = now()
    `);

    await client.query(`
      insert into user_branches(user_id, branch_id)
      select u.id, b.id
      from users u
      join branches b on b.company_id = u.company_id and b.is_active = true
      where u.username = 'admin'
      on conflict (user_id, branch_id) do nothing
    `);

    // ─── 8. PRINTERS (one default per branch) ────────────────────────────────
    await client.query(`
      insert into printers(
        company_id, branch_id, code, name,
        printer_type, connection_type, target,
        is_default, is_active, metadata
      )
      select
        b.company_id, b.id,
        v.code, v.name,
        v.printer_type, v.connection_type, v.target,
        v.is_default, true, '{}'::jsonb
      from branches b
      cross join (
        values
          ('PRN-REC-001', 'طابعة وصولات حرارية',  'receipt', 'usb',     'EPSON-TM-T20',    true),
          ('PRN-LBL-001', 'طابعة ملصقات الشحن',   'label',   'network', '192.168.1.61:9100',false),
          ('PRN-A4-001',  'طابعة مكتبية A4',       'a4',      'network', '192.168.1.50',    false)
      ) as v(code, name, printer_type, connection_type, target, is_default)
      where b.code = 'MAIN'
      on conflict (company_id, code) do update set
        branch_id      = excluded.branch_id,
        name           = excluded.name,
        printer_type   = excluded.printer_type,
        connection_type= excluded.connection_type,
        target         = excluded.target,
        is_default     = excluded.is_default,
        is_active      = true,
        updated_at     = now()
    `);

    await client.query(`
      insert into printer_routes(
        company_id, branch_id, document_type,
        printer_id, copies, is_default, is_active, metadata
      )
      select
        p.company_id, p.branch_id, v.document_type,
        p.id, v.copies, true, true, '{}'::jsonb
      from printers p
      join (
        values
          ('PRN-LBL-001', 'shipment_label',  1),
          ('PRN-REC-001', 'receipt_voucher', 2),
          ('PRN-A4-001',  'a4_report',       1)
      ) as v(printer_code, document_type, copies) on v.printer_code = p.code
      where not exists (
        select 1 from printer_routes r
        where r.company_id = p.company_id
          and coalesce(r.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(p.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and r.document_type = v.document_type
          and r.printer_id = p.id
      )
    `);

    // ─── 9. REFERENCE DATA (cities, goods, tariffs) ────────────────────────
    await client.query(`
      insert into cities(code, name, region, has_branch, is_active)
      values
        ('DAM', 'دمشق',      'دمشق',       true,  true),
        ('ALP', 'حلب',       'حلب',        true,  true),
        ('HOM', 'حمص',       'حمص',        true,  true),
        ('LAT', 'اللاذقية', 'اللاذقية',   true,  true),
        ('HAM', 'حماة',      'حماة',       false, true),
        ('DER', 'درعا',      'درعا',       false, true),
        ('IDL', 'إدلب',      'إدلب',       false, true),
        ('RQA', 'الرقة',     'الرقة',      false, true),
        ('DZR', 'دير الزور', 'دير الزور',  false, true),
        ('SWD', 'السويداء', 'السويداء',   false, true),
        ('QSR', 'القنيطرة', 'القنيطرة',   false, true)
      on conflict (code) do nothing
    `);

    await client.query(`
      insert into goods_types(code, name, description, is_active)
      values
        ('GEN', 'بضائع عامة',          'بضائع ومنتجات عامة',              true),
        ('ELE', 'أجهزة إلكترونية',     'أجهزة ومعدات كهربائية وإلكترونية', true),
        ('FOD', 'مواد غذائية',         'مواد غذائية وعبوات',              true),
        ('CLO', 'ملابس وأقمشة',        'ملابس وأقمشة ومفروشات',           true),
        ('MED', 'مستلزمات طبية',       'أدوية ومعدات طبية',               true),
        ('HVY', 'بضائع ثقيلة',         'معدات ثقيلة وأثاث',               true)
      on conflict (code) do nothing
    `);

    // Tariffs: no default data seeded — customer defines their own pricing.

    // ─── 9b. SYRIAN DEFAULT BRANCHES ─────────────────────────────────────────
    // One default branch per Syrian governorate/operational destination.
    // Idempotent: ON CONFLICT (code) DO NOTHING.
    await client.query(`
      insert into branches (code, name, city, is_active, company_id)
      select v.code, v.name, v.city, true, c.id
      from (
        values
          ('BR-DAMASCUS',  'فرع دمشق',       'دمشق'),
          ('BR-RIF',       'فرع ريف دمشق',   'ريف دمشق'),
          ('BR-ALEPPO',    'فرع حلب',        'حلب'),
          ('BR-HOMS',      'فرع حمص',        'حمص'),
          ('BR-HAMA',      'فرع حماة',       'حماة'),
          ('BR-LATAKIA',   'فرع اللاذقية',   'اللاذقية'),
          ('BR-TARTUS',    'فرع طرطوس',      'طرطوس'),
          ('BR-IDLIB',     'فرع إدلب',       'إدلب'),
          ('BR-RAQQA',     'فرع الرقة',      'الرقة'),
          ('BR-DEIR',      'فرع دير الزور',  'دير الزور'),
          ('BR-HASAKAH',   'فرع الحسكة',     'الحسكة'),
          ('BR-QAMISHLI',  'فرع القامشلي',   'القامشلي'),
          ('BR-DARAA',     'فرع درعا',       'درعا'),
          ('BR-SUWAYDA',   'فرع السويداء',   'السويداء'),
          ('BR-QUNEITRA',  'فرع القنيطرة',   'القنيطرة')
      ) as v(code, name, city)
      cross join (select id from companies where code = 'COMP-DEFAULT' limit 1) as c
      on conflict (code) do update set
        name       = excluded.name,
        city       = excluded.city,
        is_active  = true,
        company_id = excluded.company_id,
        updated_at = now()
    `);

    // ─── 9c. SYRIAN DEFAULT AGENTS ────────────────────────────────────────────
    // One default agent per Syrian governorate/operational destination.
    // Each agent is linked to its corresponding branch.
    await client.query(`
      insert into agents (code, name, governorate, is_active, branch_id)
      select v.code, v.name, v.governorate, true, b.id
      from (
        values
          ('AGT-DAMASCUS', 'وكيل دمشق',      'دمشق',       'BR-DAMASCUS'),
          ('AGT-RIF',      'وكيل ريف دمشق',  'ريف دمشق',   'BR-RIF'),
          ('AGT-ALEPPO',   'وكيل حلب',       'حلب',        'BR-ALEPPO'),
          ('AGT-HOMS',     'وكيل حمص',       'حمص',        'BR-HOMS'),
          ('AGT-HAMA',     'وكيل حماة',      'حماة',       'BR-HAMA'),
          ('AGT-LATAKIA',  'وكيل اللاذقية',  'اللاذقية',   'BR-LATAKIA'),
          ('AGT-TARTUS',   'وكيل طرطوس',     'طرطوس',      'BR-TARTUS'),
          ('AGT-IDLIB',    'وكيل إدلب',      'إدلب',       'BR-IDLIB'),
          ('AGT-RAQQA',    'وكيل الرقة',     'الرقة',      'BR-RAQQA'),
          ('AGT-DEIR',     'وكيل دير الزور', 'دير الزور',  'BR-DEIR'),
          ('AGT-HASAKAH',  'وكيل الحسكة',    'الحسكة',     'BR-HASAKAH'),
          ('AGT-QAMISHLI', 'وكيل القامشلي',  'القامشلي',   'BR-QAMISHLI'),
          ('AGT-DARAA',    'وكيل درعا',      'درعا',       'BR-DARAA'),
          ('AGT-SUWAYDA',  'وكيل السويداء',  'السويداء',   'BR-SUWAYDA'),
          ('AGT-QUNEITRA', 'وكيل القنيطرة',  'القنيطرة',   'BR-QUNEITRA')
      ) as v(code, name, governorate, branch_code)
      join branches b on b.code = v.branch_code
      on conflict (code) do update set
        name        = excluded.name,
        governorate = excluded.governorate,
        is_active   = true,
        branch_id   = excluded.branch_id,
        updated_at  = now()
    `);

    // ─── 9c1. COMPANY GENERAL CASHBOX (USD) ───────────────────────────────────
    // الصندوق العام — مركز تجميع صناديق الوكلاء وفرع حلب.
    await client.query(`
      insert into cashboxes (
        company_id, branch_id, agent_id,
        code, name, type,
        currency_code, opening_balance, current_balance,
        is_active, notes, parent_cashbox_id, created_at, updated_at
      )
      select
        c.id, null, null,
        'CASH-GENERAL-USD', 'الصندوق العام', 'COMPANY',
        'USD', 0, 0,
        true,
        'صندوق مركزي؛ الحركات في صناديق الوكلاء وفرع حلب تُجمّع تحته للتقارير',
        null,
        now(), now()
      from companies c
      on conflict (company_id, code) do nothing
    `);

    // ─── 9d. SYRIAN DEFAULT AGENT CASHBOXES ──────────────────────────────────
    // One default USD cashbox per Syrian default agent.
    // Type: AGENT — requires agent_id not null.
    // Code: CASH-AG-{DESTINATION}-USD (unique per company).
    // parent_cashbox_id → الصندوق العام.
    // Idempotent: ON CONFLICT (company_id, code) DO NOTHING.
    await client.query(`
      insert into cashboxes (
        company_id, branch_id, agent_id,
        code, name, type,
        currency_code, opening_balance, current_balance,
        is_active, notes, parent_cashbox_id, created_at, updated_at
      )
      select
        comp.id,
        a.branch_id,
        a.id,
        'CASH-AG-' || v.dest_code || '-USD',
        'صندوق ' || a.name,
        'AGENT',
        'USD',
        0, 0,
        true,
        'صندوق افتراضي تم إنشاؤه لتجهيز تجربة الوكيل',
        (select g.id from cashboxes g where g.company_id = comp.id and g.type = 'COMPANY' and g.code = 'CASH-GENERAL-USD' limit 1),
        now(), now()
      from (
        values
          ('AGT-DAMASCUS', 'DAMASCUS'),
          ('AGT-RIF',      'RIF'),
          ('AGT-ALEPPO',   'ALEPPO'),
          ('AGT-HOMS',     'HOMS'),
          ('AGT-HAMA',     'HAMA'),
          ('AGT-LATAKIA',  'LATAKIA'),
          ('AGT-TARTUS',   'TARTUS'),
          ('AGT-IDLIB',    'IDLIB'),
          ('AGT-RAQQA',    'RAQQA'),
          ('AGT-DEIR',     'DEIR'),
          ('AGT-HASAKAH',  'HASAKAH'),
          ('AGT-QAMISHLI', 'QAMISHLI'),
          ('AGT-DARAA',    'DARAA'),
          ('AGT-SUWAYDA',  'SUWAYDA'),
          ('AGT-QUNEITRA', 'QUNEITRA')
      ) as v(agent_code, dest_code)
      join agents a on a.code = v.agent_code and a.is_active = true
      cross join (select id from companies where code = 'COMP-DEFAULT' limit 1) as comp
      on conflict (company_id, code) do nothing
    `);

    // ─── 9e. SYRIAN BRANCH CASHBOX — حلب فقط (فرع رئيسي) ─────────────────────
    // صندوق فرع واحد مرتبط بـ BR-ALEPPO، الباقي عبر صناديق الوكلاء والصندوق العام.
    await client.query(`
      insert into cashboxes (
        company_id, branch_id, agent_id,
        code, name, type,
        currency_code, opening_balance, current_balance,
        is_active, notes, parent_cashbox_id, created_at, updated_at
      )
      select
        comp.id,
        b.id,
        null,
        'CASH-BR-ALEPPO-USD',
        'صندوق فرع حلب',
        'BRANCH',
        'USD',
        0, 0,
        true,
        'صندوق الفرع الرئيسي (حلب) — مرتبط بالصندوق العام',
        (select g.id from cashboxes g where g.company_id = comp.id and g.type = 'COMPANY' and g.code = 'CASH-GENERAL-USD' limit 1),
        now(), now()
      from branches b
      cross join (select id from companies where code = 'COMP-DEFAULT' limit 1) as comp
      where b.code = 'BR-ALEPPO' and b.is_active = true
      on conflict (company_id, code) do nothing
    `);

    // ─── 10. SYSTEM SETTINGS ─────────────────────────────────────────────────
    await client.query(`
      insert into system_settings(company_id, key, value, is_encrypted)
      select c.id, v.key, v.value::jsonb, false
      from companies c
      cross join (
        values
          ('network.mode',           '"local_only"'),
          ('network.host',           '"127.0.0.1"'),
          ('network.port',           '3001'),
          ('network.protocol',       '"http"'),
          ('network.publicUrl',      '""'),
          ('network.lanEnabled',     'false'),
          ('runtime.environment',    '"development"'),
          ('runtime.offlineMode',    'false'),
          ('runtime.autoReconnect',  'true'),
          ('runtime.deviceName',     '"الجهاز الرئيسي"'),
          ('runtime.maintenanceMode','false'),
          ('diagnostics.enabled',    'true'),
          ('diagnostics.level',      '"info"'),
          ('electron.autoLaunch',    'false'),
          ('electron.autoUpdateEnabled','true'),
          ('electron.windowMode',    '"windowed"'),
          ('backup.autoEnabled',     'true'),
          ('backup.intervalHours',   '24'),
          ('backup.retentionDays',   '30'),
          ('backup.verifyAfterCreate','true')
      ) as v(key, value)
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id, key) do update set
        value      = excluded.value,
        updated_at = now()
    `);

    await client.query(`
      insert into terminology_settings(company_id, terms, updated_by)
      select c.id, '{}'::jsonb, null
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id) do nothing
    `);

    await client.query(`
      insert into shipping_label_settings(company_id, config, updated_by)
      select c.id, '{}'::jsonb, null
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id) do nothing
    `);

    // ─── 11. TELEGRAM ACTIVATION BOT (test credentials — editable from UI) ────
    await client.query(`
      insert into telegram_activation_settings
        (company_id, bot_token, chat_id, bot_username, is_enabled)
      select c.id,
             '8755248404:AAE3l9ac-8EcH4MTygvZm0kLWYeERUAjEi8',
             '6818349532',
             '@MyERP_Notifier_bot',
             true
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (company_id) do nothing
    `);

    await client.query('commit');

    if (isFirstRun) {
      console.info('[SEED] ✓ First-run clean state complete.');
      console.info('[SEED]   Branch  : الفرع الرئيسي  (code: MAIN)');
      console.info('[SEED]   Username: admin');
      console.info('[SEED]   Password: admin123');
    } else {
      console.info('[SEED] ✓ Structural data refreshed (live data preserved).');
    }
  } catch (error) {
    await client.query('rollback');
    console.error('[SEED] Failed.', error);
    throw error;
  } finally {
    client.release();
  }
}

const isDirectExecution = (() => {
  const entry = String(process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
  return entry.endsWith('/db/seed.ts') || entry.endsWith('/db/seed.js');
})();

if (isDirectExecution) {
  runSeed()
    .then(async () => { await pool.end(); })
    .catch(async () => { await pool.end(); process.exit(1); });
}
