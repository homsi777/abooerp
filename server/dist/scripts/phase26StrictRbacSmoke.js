import { env } from '../config/env.js';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';
async function request(baseUrl, path, init) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (init?.auth?.userId) {
        headers['x-user-id'] = init.auth.userId;
    }
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
    if (!condition) {
        throw new Error(message);
    }
}
async function createUserForRole(roleCode, branchId) {
    const role = await pool.query('select id from roles where code = $1 limit 1', [roleCode]);
    ensure(Boolean(role.rowCount), `Missing role ${roleCode}`);
    const timestamp = Date.now();
    const username = `${roleCode}_p26_${timestamp}`;
    const inserted = await pool.query(`
    insert into users(username, full_name, email, phone, password_hash, role_id, branch_id, status)
    values($1, $2, $3, $4, $5, $6, $7, 'active')
    returning id
    `, [
        username,
        `${roleCode} phase26`,
        `${username}@local.erp`,
        `+963${Math.floor(Math.random() * 900000 + 100000)}`,
        'seed_hash_placeholder',
        role.rows[0].id,
        branchId,
    ]);
    return inserted.rows[0].id;
}
async function runStrictRbacSmoke() {
    ensure(env.AUTH_STRICT_RBAC === true, 'AUTH_STRICT_RBAC must be true for this smoke test.');
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const health = await request(baseUrl, '/api/health');
        ensure(health.status === 200 && health.body.success, 'Health endpoint should remain public.');
        const unauthShipments = await request(baseUrl, '/api/v1/shipments');
        ensure(unauthShipments.status === 401, 'Strict RBAC should reject unauthenticated shipments read.');
        const unauthShipmentCreate = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        ensure(unauthShipmentCreate.status === 401, 'Strict RBAC should reject unauthenticated shipments write.');
        const branches = await request(baseUrl, '/api/v1/branches');
        ensure(branches.status === 200 && branches.body.success, 'Branches list should be available for setup.');
        const branchId = branches.body.data?.[0]?.id;
        ensure(Boolean(branchId), 'Missing branch for strict RBAC smoke.');
        const senders = await request(baseUrl, '/api/v1/senders-receivers');
        ensure(senders.status === 200 && senders.body.success, 'Senders/receivers list should be available for setup.');
        const senderId = senders.body.data?.[0]?.id;
        const receiverId = senders.body.data?.[1]?.id || senders.body.data?.[0]?.id;
        ensure(Boolean(senderId && receiverId), 'Missing sender/receiver for strict RBAC smoke.');
        const viewerUserId = await createUserForRole('viewer', branchId);
        const operatorUserId = await createUserForRole('operator', branchId);
        const viewerRead = await request(baseUrl, '/api/v1/shipments', {
            auth: { userId: viewerUserId },
        });
        ensure(viewerRead.status === 200, 'Viewer should keep read access under strict RBAC.');
        const viewerWriteDenied = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            auth: { userId: viewerUserId },
            body: JSON.stringify({
                shipmentNo: `SHP-P26-VIEW-${Date.now()}`,
                senderId,
                receiverId,
                branchId,
                destinationCity: 'Strict City',
                piecesCount: 1,
                status: 'created',
                originalAmount: 60,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(viewerWriteDenied.status === 403, 'Viewer should not have write permission under strict RBAC.');
        const operatorWrite = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            auth: { userId: operatorUserId },
            body: JSON.stringify({
                shipmentNo: `SHP-P26-OPER-${Date.now()}`,
                senderId,
                receiverId,
                branchId,
                destinationCity: 'Strict City',
                piecesCount: 1,
                status: 'created',
                originalAmount: 70,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(operatorWrite.status === 201 && operatorWrite.body.success, 'Operator should keep write access under strict RBAC.');
        console.info('[PHASE2.6 STRICT RBAC SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runStrictRbacSmoke().catch((error) => {
    console.error('[PHASE2.6 STRICT RBAC SMOKE] Failed:', error);
    process.exit(1);
});
