import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';
async function request(baseUrl, path, init) {
    const headers = { 'Content-Type': 'application/json' };
    if (init?.auth?.userId)
        headers['x-user-id'] = init.auth.userId;
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
async function createUserForRole(roleCode, branchId) {
    const role = await pool.query('select id from roles where code = $1 limit 1', [roleCode]);
    ensure(Boolean(role.rowCount), `Missing role ${roleCode}`);
    const timestamp = Date.now();
    const username = `${roleCode}_p25_${timestamp}`;
    const inserted = await pool.query(`
    insert into users(username, full_name, email, phone, password_hash, role_id, branch_id, status)
    values($1, $2, $3, $4, $5, $6, $7, 'active')
    returning id
    `, [
        username,
        `${roleCode} phase25`,
        `${username}@local.erp`,
        `+963${Math.floor(Math.random() * 900000 + 100000)}`,
        'seed_hash_placeholder',
        role.rows[0].id,
        branchId,
    ]);
    return inserted.rows[0].id;
}
async function runPermissionSmoke() {
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const branches = await request(baseUrl, '/api/v1/branches');
        ensure(branches.status === 200 && branches.body.success, 'Cannot list branches');
        const branchId = branches.body.data?.[0]?.id;
        ensure(Boolean(branchId), 'Missing branch');
        const senders = await request(baseUrl, '/api/v1/senders-receivers');
        ensure(senders.status === 200 && senders.body.success, 'Cannot list senders/receivers');
        const senderId = senders.body.data?.[0]?.id;
        const receiverId = senders.body.data?.[1]?.id || senders.body.data?.[0]?.id;
        ensure(Boolean(senderId && receiverId), 'Missing sender/receiver');
        const viewerUserId = await createUserForRole('viewer', branchId);
        const operatorUserId = await createUserForRole('operator', branchId);
        const viewerReadShipments = await request(baseUrl, '/api/v1/shipments', {
            auth: { userId: viewerUserId },
        });
        ensure(viewerReadShipments.status === 200, 'Viewer should have shipments.read');
        const viewerReadManifests = await request(baseUrl, '/api/v1/manifests', {
            auth: { userId: viewerUserId },
        });
        ensure(viewerReadManifests.status === 200, 'Viewer should have manifests.read');
        const viewerWriteShipment = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            auth: { userId: viewerUserId },
            body: JSON.stringify({
                shipmentNo: `SHP-P25-VIEW-${Date.now()}`,
                senderId,
                receiverId,
                branchId,
                destinationCity: 'Permission City',
                piecesCount: 1,
                status: 'created',
                originalAmount: 45,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(viewerWriteShipment.status === 403, 'Viewer should be denied shipments.write');
        const operatorWriteShipment = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            auth: { userId: operatorUserId },
            body: JSON.stringify({
                shipmentNo: `SHP-P25-OPER-${Date.now()}`,
                senderId,
                receiverId,
                branchId,
                destinationCity: 'Permission City',
                piecesCount: 1,
                status: 'created',
                originalAmount: 55,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(operatorWriteShipment.status === 201 && operatorWriteShipment.body.success, 'Operator should have shipments.write');
        console.info('[PHASE2.5 PERMISSION SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runPermissionSmoke().catch((error) => {
    console.error('[PHASE2.5 PERMISSION SMOKE] Failed:', error);
    process.exit(1);
});
