import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';
async function request(baseUrl, path, init) {
    const headers = { 'Content-Type': 'application/json' };
    if (init?.auth?.userId)
        headers['x-user-id'] = init.auth.userId;
    if (init?.scope?.branchId)
        headers['x-branch-id'] = init.scope.branchId;
    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            ...headers,
            ...(init?.headers || {}),
        },
    });
    const body = (await response.json());
    return { status: response.status, body };
}
function ensure(condition, message) {
    if (!condition)
        throw new Error(message);
}
async function runC8Smoke() {
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const admin = await pool.query(`select id, company_id, branch_id from users where username = 'admin' limit 1`);
        ensure(Boolean(admin.rowCount), 'Admin missing');
        const adminId = admin.rows[0].id;
        const companyId = admin.rows[0].company_id;
        const branchId = admin.rows[0].branch_id;
        ensure(Boolean(branchId), 'Admin branch missing');
        const readTerms = await request(baseUrl, '/api/v1/terminology-settings', {
            auth: { userId: adminId },
        });
        ensure(readTerms.status === 200 && readTerms.body.success, 'Cannot read terminology settings');
        ensure(Boolean(readTerms.body.data?.terms.customer), 'Expected terminology key customer');
        const writeTerms = await request(baseUrl, '/api/v1/terminology-settings', {
            method: 'PUT',
            auth: { userId: adminId },
            body: JSON.stringify({
                terms: {
                    ...readTerms.body.data?.terms,
                    shipment: 'الشحنة المخصصة C8',
                },
            }),
        });
        ensure(writeTerms.status === 200 && writeTerms.body.success, 'Cannot update terminology settings');
        ensure(writeTerms.body.data?.terms.shipment === 'الشحنة المخصصة C8', 'Terminology update not persisted');
        const readShipping = await request(baseUrl, '/api/v1/shipping-label-settings', { auth: { userId: adminId } });
        ensure(readShipping.status === 200 && readShipping.body.success, 'Cannot read shipping label settings');
        ensure(Array.isArray(readShipping.body.data?.fields), 'Shipping label fields missing');
        const updateShipping = await request(baseUrl, '/api/v1/shipping-label-settings', {
            method: 'PUT',
            auth: { userId: adminId },
            body: JSON.stringify({
                ...readShipping.body.data,
                layout: {
                    ...readShipping.body.data.layout,
                    labelSize: '100x150',
                },
            }),
        });
        ensure(updateShipping.status === 200 && updateShipping.body.success, 'Cannot update shipping label settings');
        ensure(updateShipping.body.data?.layout.labelSize === '100x150', 'Shipping label update not persisted');
        const printPlan = await request(baseUrl, '/api/v1/shipping-label-settings/print-plan', { auth: { userId: adminId }, scope: { branchId: branchId } });
        ensure(printPlan.status === 200 && printPlan.body.success, 'Cannot resolve shipping label print plan');
        ensure(Boolean(printPlan.body.data?.printerRoute), 'Expected printer route for shipment_label');
        const viewerRole = await pool.query(`select id from roles where code = 'viewer' limit 1`);
        ensure(Boolean(viewerRole.rowCount), 'Viewer role missing');
        const viewerInsert = await pool.query(`
      insert into users(username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, status, is_active)
      values($1, $2, $3, $4, $5, $6, 'viewer', $7, $8, 'active', true)
      returning id
      `, [
            `viewer_c8_${Date.now()}`,
            'C8 Viewer',
            `viewer_c8_${Date.now()}@local.erp`,
            `+963${Math.floor(100000000 + Math.random() * 899999999)}`,
            'seed_hash_placeholder',
            viewerRole.rows[0].id,
            companyId,
            branchId,
        ]);
        const viewerId = viewerInsert.rows[0].id;
        await pool.query(`
      insert into user_branches(user_id, branch_id)
      values($1, $2)
      on conflict do nothing
      `, [viewerId, branchId]);
        const viewerDeniedTerminologyWrite = await request(baseUrl, '/api/v1/terminology-settings', {
            method: 'PUT',
            auth: { userId: viewerId },
            body: JSON.stringify({ terms: { shipment: 'no' } }),
        });
        ensure(viewerDeniedTerminologyWrite.status === 403, 'Viewer should not write terminology');
        const viewerDeniedShippingWrite = await request(baseUrl, '/api/v1/shipping-label-settings', {
            method: 'PUT',
            auth: { userId: viewerId },
            body: JSON.stringify(readShipping.body.data),
        });
        ensure(viewerDeniedShippingWrite.status === 403, 'Viewer should not write shipping label settings');
        console.info('[PHASE C8 TERMINOLOGY+SHIPPING SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runC8Smoke().catch((error) => {
    console.error('[PHASE C8 TERMINOLOGY+SHIPPING SMOKE] Failed:', error);
    process.exit(1);
});
