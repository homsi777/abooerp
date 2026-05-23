import { pool } from './pool.js';
import { env } from '../config/env.js';
async function runSeed() {
    if (env.NODE_ENV === 'production' && process.env.ALLOW_DB_SEED !== 'true') {
        throw new Error('Seeding is disabled in production. Set ALLOW_DB_SEED=true to override intentionally.');
    }
    const client = await pool.connect();
    try {
        await client.query('begin');
        await client.query(`
      insert into companies(code, name, is_active)
      values ('COMP-DEFAULT', 'Default Company', true)
      on conflict (code) do update set
        name = excluded.name,
        is_active = excluded.is_active,
        updated_at = now()
    `);
        await client.query(`
      insert into currencies(code, name, symbol, decimal_places, is_base, is_active, company_id)
      select * from (
        values
          ('USD', 'US Dollar', '$', 2, true, true),
          ('SYP', 'Syrian Pound', 'SYP', 2, false, true),
          ('TRY', 'Turkish Lira', 'TRY', 2, false, true),
          ('EUR', 'Euro', 'EUR', 2, false, true)
      ) as v(code, name, symbol, decimal_places, is_base, is_active)
      cross join (
        select id
        from companies
        where code = 'COMP-DEFAULT'
        limit 1
      ) c
      on conflict (code) do update set
        name = excluded.name,
        symbol = excluded.symbol,
        decimal_places = excluded.decimal_places,
        is_base = excluded.is_base,
        is_active = excluded.is_active,
        company_id = excluded.company_id,
        updated_at = now()
    `);
        await client.query(`
      insert into exchange_rates(
        base_currency,
        quote_currency,
        currency_id,
        company_id,
        rate,
        source,
        effective_at,
        effective_date,
        is_active
      )
      select
        'USD' as base_currency,
        c.code as quote_currency,
        c.id as currency_id,
        c.company_id,
        case
          when c.code = 'USD' then 1::numeric
          when c.code = 'SYP' then 0.000077::numeric
          when c.code = 'TRY' then 0.031::numeric
          when c.code = 'EUR' then 1.08::numeric
          else 1::numeric
        end as rate,
        'seed' as source,
        now() as effective_at,
        current_date as effective_date,
        true as is_active
      from currencies c
      where c.company_id = (select id from companies where code = 'COMP-DEFAULT' limit 1)
      on conflict (currency_id, effective_date, company_id) do update set
        rate = excluded.rate,
        source = excluded.source,
        updated_at = now()
    `);
        await client.query(`
      insert into roles(code, name, description, is_active)
      values
      ('admin', 'Administrator', 'Full system access', true),
      ('accountant', 'Accountant', 'Finance and reporting operations', true),
      ('manager', 'Manager', 'Branch and workforce management', true),
      ('cashier', 'Cashier', 'Cashbox operations', true),
      ('operator', 'Operator', 'Shipment daily operations', true),
      ('viewer', 'Viewer', 'Read-only operational access', true)
      on conflict (code) do nothing
    `);
        await client.query(`
      update roles
      set is_system = true
      where code in ('admin', 'accountant', 'manager', 'cashier', 'operator', 'viewer')
    `);
        await client.query(`
      insert into permissions(code, name, module, action, is_active)
      values
      ('shipments.read', 'Read shipments', 'shipments', 'read', true),
      ('shipments.write', 'Write shipments', 'shipments', 'write', true),
      ('manifests.read', 'Read manifests', 'manifests', 'read', true),
      ('manifests.write', 'Write manifests', 'manifests', 'write', true),
      ('deliveries.read', 'Read deliveries', 'deliveries', 'read', true),
      ('deliveries.write', 'Write deliveries', 'deliveries', 'write', true),
      ('finance.read', 'Read finance module', 'finance', 'read', true),
      ('finance.write', 'Write finance module', 'finance', 'write', true),
      ('finance.vouchers.read', 'Read finance vouchers', 'finance_vouchers', 'read', true),
      ('finance.vouchers.write', 'Write finance vouchers', 'finance_vouchers', 'write', true),
      ('finance.cashbox.read', 'Read cashbox transactions', 'finance_cashbox', 'read', true),
      ('finance.cashbox.write', 'Write cashbox transactions', 'finance_cashbox', 'write', true),
      ('settings.branches.read', 'Read branch settings', 'settings_branches', 'read', true),
      ('settings.branches.write', 'Write branch settings', 'settings_branches', 'write', true),
      ('settings.agents.read', 'Read agent settings', 'settings_agents', 'read', true),
      ('settings.agents.write', 'Write agent settings', 'settings_agents', 'write', true),
      ('settings.users.read', 'Read users settings', 'settings_users', 'read', true),
      ('settings.users.write', 'Write users settings', 'settings_users', 'write', true),
      ('settings.roles.read', 'Read roles settings', 'settings_roles', 'read', true),
      ('settings.roles.write', 'Write roles settings', 'settings_roles', 'write', true),
      ('settings.currencies.read', 'Read currencies settings', 'settings_currencies', 'read', true),
      ('settings.currencies.write', 'Write currencies settings', 'settings_currencies', 'write', true),
      ('settings.exchangeRates.read', 'Read exchange rates settings', 'settings_exchange_rates', 'read', true),
      ('settings.exchangeRates.write', 'Write exchange rates settings', 'settings_exchange_rates', 'write', true),
      ('settings.audit.read', 'Read audit logs', 'settings_audit', 'read', true),
      ('settings.system.read', 'Read system settings', 'settings_system', 'read', true),
      ('settings.system.write', 'Write system settings', 'settings_system', 'write', true),
      ('settings.printers.read', 'Read printer settings', 'settings_printers', 'read', true),
      ('settings.printers.write', 'Write printer settings', 'settings_printers', 'write', true),
      ('settings.backup.read', 'Read backup settings', 'settings_backup', 'read', true),
      ('settings.backup.write', 'Write backup settings', 'settings_backup', 'write', true),
      ('settings.terminology.read', 'Read terminology settings', 'settings_terminology', 'read', true),
      ('settings.terminology.write', 'Write terminology settings', 'settings_terminology', 'write', true),
      ('settings.shippingLabel.read', 'Read shipping label settings', 'settings_shipping_label', 'read', true),
      ('settings.shippingLabel.write', 'Write shipping label settings', 'settings_shipping_label', 'write', true)
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      cross join permissions p
      where r.code = 'admin'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read',
        'shipments.write',
        'manifests.read',
        'manifests.write',
        'deliveries.read',
        'deliveries.write'
      )
      where r.code = 'operator'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in ('shipments.read', 'manifests.read', 'deliveries.read')
      where r.code in ('viewer', 'accountant')
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'finance.read',
        'finance.write',
        'finance.vouchers.read',
        'finance.vouchers.write',
        'finance.cashbox.read',
        'finance.cashbox.write'
      )
      where r.code in ('admin', 'accountant')
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'finance.read',
        'finance.vouchers.read',
        'finance.vouchers.write',
        'finance.cashbox.read'
      )
      where r.code = 'operator'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'settings.users.read',
        'settings.users.write',
        'settings.roles.read',
        'settings.roles.write',
        'settings.branches.read',
        'settings.branches.write',
        'settings.agents.read',
        'settings.agents.write',
        'settings.currencies.read',
        'settings.currencies.write',
        'settings.exchangeRates.read',
        'settings.exchangeRates.write',
        'settings.audit.read',
        'settings.system.read',
        'settings.system.write',
        'settings.printers.read',
        'settings.printers.write',
        'settings.backup.read',
        'settings.backup.write',
        'settings.terminology.read',
        'settings.terminology.write',
        'settings.shippingLabel.read',
        'settings.shippingLabel.write'
      )
      where r.code = 'admin'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'shipments.read',
        'shipments.write',
        'manifests.read',
        'manifests.write',
        'deliveries.read',
        'deliveries.write',
        'settings.users.read',
        'settings.roles.read',
        'settings.branches.read',
        'settings.agents.read',
        'settings.currencies.read',
        'settings.exchangeRates.read',
        'settings.system.read',
        'settings.printers.read',
        'settings.backup.read',
        'settings.terminology.read',
        'settings.shippingLabel.read'
      )
      where r.code = 'manager'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into role_permissions(role_id, permission_id, permission_code)
      select r.id, p.id, p.code
      from roles r
      join permissions p on p.code in (
        'finance.read',
        'finance.vouchers.read',
        'finance.vouchers.write',
        'finance.cashbox.read',
        'finance.cashbox.write'
      )
      where r.code = 'cashier'
      on conflict (role_id, permission_id) do update
      set permission_code = excluded.permission_code
    `);
        await client.query(`
      insert into branches(code, name, city, address, phone, company_id, is_active)
      select 'BR-DAM', 'Damascus Main Branch', 'Damascus', 'Damascus Center', '+963111111', c.id, true
      from companies c
      where c.code = 'COMP-DEFAULT'
      on conflict (code) do update set
        company_id = excluded.company_id,
        is_active = excluded.is_active,
        updated_at = now()
    `);
        await client.query(`
      insert into printers(
        company_id, branch_id, code, name, printer_type, connection_type, target, is_default, is_active, metadata
      )
      select
        b.company_id,
        b.id,
        v.code,
        v.name,
        v.printer_type,
        v.connection_type,
        v.target,
        v.is_default,
        true,
        '{}'::jsonb
      from branches b
      cross join (
        values
          ('PRN-REC-001', 'Receipt Thermal Printer', 'receipt', 'usb', 'EPSON-TM-T20', true),
          ('PRN-LBL-001', 'Shipment Label Printer', 'label', 'network', '192.168.1.61:9100', false),
          ('PRN-A4-001', 'Main A4 Office Printer', 'a4', 'network', '192.168.1.50', false)
      ) as v(code, name, printer_type, connection_type, target, is_default)
      where b.code = 'BR-DAM'
      on conflict (company_id, code) do update
      set
        branch_id = excluded.branch_id,
        name = excluded.name,
        printer_type = excluded.printer_type,
        connection_type = excluded.connection_type,
        target = excluded.target,
        is_default = excluded.is_default,
        is_active = true,
        updated_at = now()
    `);
        await client.query(`
      insert into printer_routes(
        company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata
      )
      select
        p.company_id,
        p.branch_id,
        v.document_type,
        p.id,
        v.copies,
        true,
        true,
        '{}'::jsonb
      from printers p
      join (
        values
          ('PRN-LBL-001', 'shipment_label', 1),
          ('PRN-REC-001', 'receipt_voucher', 2),
          ('PRN-A4-001', 'a4_report', 1)
      ) as v(printer_code, document_type, copies) on v.printer_code = p.code
      where not exists (
        select 1
        from printer_routes r
        where r.company_id = p.company_id
          and coalesce(r.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(p.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and r.document_type = v.document_type
          and r.printer_id = p.id
      )
    `);
        await client.query(`
      insert into cities(code, name, region, has_branch, is_active)
      values
      ('DAM', 'دمشق', 'دمشق', true, true),
      ('ALP', 'حلب', 'حلب', true, true),
      ('HOM', 'حمص', 'حمص', true, true),
      ('LAT', 'اللاذقية', 'اللاذقية', true, true),
      ('HAM', 'حماة', 'حماة', false, true)
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into goods_types(code, name, description, is_active)
      values
      ('GEN', 'بضائع عامة', 'بضائع عامة', true),
      ('ELE', 'أجهزة كهربائية', 'أجهزة ومعدات كهربائية', true),
      ('FOD', 'مواد غذائية', 'مواد غذائية وتغليف', true)
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into tariffs(code, from_city_id, to_city_id, goods_type_id, price_per_kg, minimum_charge, valid_from, is_active)
      select
        'TRF-DAM-ALP-GEN',
        c_from.id,
        c_to.id,
        g.id,
        100,
        5000,
        current_date,
        true
      from cities c_from
      join cities c_to on c_to.code = 'ALP'
      join goods_types g on g.code = 'GEN'
      where c_from.code = 'DAM'
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into agents(code, name, governorate, phone, branch_id, is_active)
      select 'AG-ALEP-01', 'Aleppo Agent', 'Aleppo', '+963222222', b.id, true
      from branches b
      where b.code = 'BR-DAM'
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into users(username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, agent_id, status, is_active)
      select
        'admin',
        'System Admin',
        'admin@local.erp',
        '+963999999',
        '$2b$12$DhHINhwbKZKCDDiDhlo9aOsXhJhyYywJhdqYyiYZF4.745yqHJ3Uy',
        r.id,
        r.code,
        b.company_id,
        b.id,
        null,
        'active',
        true
      from roles r
      join branches b on b.code = 'BR-DAM'
      where r.code = 'admin'
      on conflict (username) do update set
        password_hash = excluded.password_hash,
        role_id = excluded.role_id,
        role = excluded.role,
        company_id = excluded.company_id,
        branch_id = excluded.branch_id,
        status = excluded.status,
        is_active = excluded.is_active,
        updated_at = now()
    `);
        await client.query(`
      update users u
      set
        role = r.code,
        company_id = coalesce(
          (
            select b.company_id
            from branches b
            where b.id = u.branch_id
            limit 1
          ),
          u.company_id
        ),
        is_active = (u.status = 'active')
      from roles r
      where u.role_id = r.id
        and u.username = 'admin'
    `);
        await client.query(`
      insert into user_branches(user_id, branch_id)
      select u.id, b.id
      from users u
      join branches b on b.company_id = u.company_id and b.is_active = true
      where u.username = 'admin'
      on conflict (user_id, branch_id) do nothing
    `);
        await client.query(`
      insert into customers(code, name, phone, city, address, branch_id, status)
      select 'CUS-0001', 'عميل تجريبي', '+963333333', 'Damascus', 'Mazzeh', b.id, 'active'
      from branches b
      where b.code = 'BR-DAM'
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into senders_receivers(code, full_name, phone, city, address, type, status)
      values
      ('SR-S-0001', 'مرسل تجريبي', '+963444444', 'Damascus', 'Baramkeh', 'sender', 'active'),
      ('SR-R-0001', 'مستلم تجريبي', '+963555555', 'Aleppo', 'Aziziya', 'receiver', 'active')
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into drivers(code, full_name, phone, license_number, branch_id, status)
      select 'DRV-0001', 'سائق تجريبي', '+963666666', 'LIC-001', b.id, 'active'
      from branches b
      where b.code = 'BR-DAM'
      on conflict (code) do nothing
    `);
        await client.query(`
      insert into vehicles(code, plate_number, model, capacity_kg, branch_id, status)
      select 'VEH-0001', '123456', 'Hyundai HD', 3500, b.id, 'active'
      from branches b
      where b.code = 'BR-DAM'
      on conflict (code) do nothing
    `);
        await client.query(`
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
          ('runtime.deviceName', '"main-workstation"'),
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
      on conflict (company_id, key) do update
      set
        value = excluded.value,
        is_encrypted = excluded.is_encrypted,
        updated_at = now()
    `);
        await client.query(`
      insert into shipments(
        shipment_no, reference_no, customer_id, sender_id, receiver_id, branch_id, agent_id,
        origin_city, destination_city, description, pieces_count, weight_kg, status,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by
      )
      select
        'SHP-0001', 'REF-0001', c.id, s.id, r.id, b.id, a.id,
        'Damascus', 'Aleppo', 'Sample electronics box', 3, 12.5, 'created',
        100.50, 'USD', 1, 100.50, u.id
      from customers c
      join senders_receivers s on s.code = 'SR-S-0001'
      join senders_receivers r on r.code = 'SR-R-0001'
      join branches b on b.code = 'BR-DAM'
      left join agents a on a.code = 'AG-ALEP-01'
      join users u on u.username = 'admin'
      where c.code = 'CUS-0001'
      on conflict (shipment_no) do nothing
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
        await client.query(`
      insert into shipment_status_history(shipment_id, status, note, changed_by)
      select sh.id, sh.status, 'Initial seeded status', u.id
      from shipments sh
      join users u on u.username = 'admin'
      where sh.shipment_no = 'SHP-0001'
      on conflict do nothing
    `);
        await client.query(`
      insert into manifests(manifest_no, branch_id, vehicle_id, driver_id, status, created_by)
      select 'MAN-0001', b.id, v.id, d.id, 'created', u.id
      from branches b
      join vehicles v on v.code = 'VEH-0001'
      join drivers d on d.code = 'DRV-0001'
      join users u on u.username = 'admin'
      where b.code = 'BR-DAM'
      on conflict (manifest_no) do nothing
    `);
        await client.query(`
      insert into manifest_shipments(manifest_id, shipment_id)
      select m.id, s.id
      from manifests m
      join shipments s on s.shipment_no = 'SHP-0001'
      where m.manifest_no = 'MAN-0001'
      on conflict do nothing
    `);
        await client.query(`
      insert into deliveries(
        delivery_no, shipment_id, branch_id, agent_id, operator_user_id, status,
        recipient_name, received_at, notes,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd
      )
      select
        'DEL-0001', s.id, b.id, a.id, u.id, 'delivered',
        'عميل نهائي', now(), 'Seed delivery',
        100.50, 'USD', 1, 100.50
      from shipments s
      join branches b on b.code = 'BR-DAM'
      left join agents a on a.code = 'AG-ALEP-01'
      join users u on u.username = 'admin'
      where s.shipment_no = 'SHP-0001'
      on conflict (delivery_no) do nothing
    `);
        await client.query('commit');
        console.info('[SEED] Seed data inserted successfully.');
    }
    catch (error) {
        await client.query('rollback');
        console.error('[SEED] Failed.', error);
        throw error;
    }
    finally {
        client.release();
    }
}
runSeed()
    .then(async () => {
    await pool.end();
})
    .catch(async () => {
    await pool.end();
    process.exit(1);
});
