import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';
async function request(baseUrl, path, init) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (init?.auth?.userId)
        headers['x-user-id'] = init.auth.userId;
    if (init?.scope?.branchId)
        headers['x-branch-id'] = init.scope.branchId;
    if (init?.scope?.agentId)
        headers['x-agent-id'] = init.scope.agentId;
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
async function runAuthScopeSmoke() {
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const branchResp = await request(baseUrl, '/api/v1/branches');
        ensure(branchResp.status === 200 && branchResp.body.success, 'Cannot list branches');
        const branchA = branchResp.body.data?.[0]?.id;
        ensure(Boolean(branchA), 'Missing branch A');
        const branchBCreate = await request(baseUrl, '/api/v1/branches', {
            method: 'POST',
            body: JSON.stringify({
                code: `BR-AUTH-${Date.now()}`,
                name: 'Auth Scope Branch',
                city: 'Auth',
                address: 'Auth Scope Address',
                phone: '+963-000',
                is_active: true,
            }),
        });
        ensure(branchBCreate.status === 201 && branchBCreate.body.success, 'Cannot create branch B');
        const branchB = branchBCreate.body.data?.id;
        ensure(Boolean(branchB), 'Missing branch B');
        const srResp = await request(baseUrl, '/api/v1/senders-receivers');
        ensure(srResp.status === 200 && srResp.body.success, 'Cannot list senders/receivers');
        const senderId = srResp.body.data?.[0]?.id;
        const receiverId = srResp.body.data?.[1]?.id || srResp.body.data?.[0]?.id;
        ensure(Boolean(senderId && receiverId), 'Missing sender/receiver');
        const adminUser = await pool.query(`select id, branch_id from users where username = 'admin' limit 1`);
        ensure(Boolean(adminUser.rowCount), 'Missing admin user');
        const adminUserId = adminUser.rows[0].id;
        const adminBranchId = adminUser.rows[0].branch_id;
        ensure(Boolean(adminBranchId), 'Admin has no branch scope');
        const roleQuery = await pool.query(`select id from roles where code = 'operator' limit 1`);
        ensure(Boolean(roleQuery.rowCount), 'Missing operator role');
        const operatorRoleId = roleQuery.rows[0].id;
        const scopedUserInsert = await pool.query(`
      insert into users(username, full_name, email, phone, password_hash, role_id, branch_id, status)
      values($1, $2, $3, $4, $5, $6, $7, 'active')
      on conflict (username) do update
      set branch_id = excluded.branch_id, role_id = excluded.role_id, status = 'active'
      returning id
      `, [
            `scope_user_${Date.now()}`,
            'Scope User',
            `scope_${Date.now()}@local.erp`,
            `+963${Math.floor(Math.random() * 900000 + 100000)}`,
            'seed_hash_placeholder',
            operatorRoleId,
            branchB,
        ]);
        const scopedUserId = scopedUserInsert.rows[0].id;
        const shipmentInAdminBranch = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            body: JSON.stringify({
                shipmentNo: `SHP-AUTH-A-${Date.now()}`,
                senderId,
                receiverId,
                branchId: adminBranchId,
                destinationCity: 'Auth A',
                piecesCount: 1,
                status: 'created',
                originalAmount: 20,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(shipmentInAdminBranch.status === 201, 'Failed to create shipment in admin branch');
        const shipmentAId = shipmentInAdminBranch.body.data?.id;
        const shipmentInScopeUserBranch = await request(baseUrl, '/api/v1/shipments', {
            method: 'POST',
            body: JSON.stringify({
                shipmentNo: `SHP-AUTH-B-${Date.now()}`,
                senderId,
                receiverId,
                branchId: branchB,
                destinationCity: 'Auth B',
                piecesCount: 1,
                status: 'created',
                originalAmount: 22,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
            }),
        });
        ensure(shipmentInScopeUserBranch.status === 201, 'Failed to create shipment in branch B');
        const shipmentBId = shipmentInScopeUserBranch.body.data?.id;
        const scopedList = await request(baseUrl, '/api/v1/shipments', {
            auth: { userId: scopedUserId },
        });
        ensure(scopedList.status === 200 && scopedList.body.success, 'Scoped user list failed');
        ensure(scopedList.body.data?.some((s) => s.id === shipmentBId) === true, 'Scoped user missing own branch shipment');
        ensure(scopedList.body.data?.some((s) => s.id === shipmentAId) === false, 'Scoped user leaked other branch shipment');
        const scopedListWithManualOverrideAttempt = await request(baseUrl, '/api/v1/shipments', {
            auth: { userId: scopedUserId },
            scope: { branchId: adminBranchId },
        });
        ensure(scopedListWithManualOverrideAttempt.status === 200 && scopedListWithManualOverrideAttempt.body.success, 'Scoped user list with override attempt failed');
        ensure(scopedListWithManualOverrideAttempt.body.data?.some((s) => s.id === shipmentAId) === false, 'Manual branch override bypassed authenticated user scope');
        const unknownUserResp = await request(baseUrl, '/api/v1/shipments', {
            auth: { userId: '11111111-1111-4111-8111-111111111111' },
        });
        ensure(unknownUserResp.status === 401, 'Unknown user id did not return 401');
        console.info('[PHASE2.3 AUTH SCOPE SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runAuthScopeSmoke().catch(async (error) => {
    console.error('[PHASE2.3 AUTH SCOPE SMOKE] Failed:', error);
    process.exit(1);
});
