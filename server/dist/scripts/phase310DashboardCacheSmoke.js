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
async function runPhase310DashboardCacheSmoke() {
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const admin = await pool.query(`select id, branch_id from users where username = 'admin' limit 1`);
        ensure(Boolean(admin.rowCount), 'Admin missing');
        const adminUserId = admin.rows[0].id;
        const branchId = admin.rows[0].branch_id;
        ensure(Boolean(branchId), 'Admin branch missing');
        const partySeed = await request(baseUrl, '/api/v1/senders-receivers', {
            method: 'POST',
            body: JSON.stringify({
                code: `P310-SR-${Date.now()}`,
                full_name: `Phase310 Party ${Date.now()}`,
                type: 'both',
                status: 'active',
            }),
        });
        ensure(partySeed.status === 201 && partySeed.body.success, 'Cannot create isolated party');
        const partyId = partySeed.body.data?.id;
        ensure(Boolean(partyId), 'Isolated party id missing');
        const now = Date.now();
        const fromAt = new Date(now - 5 * 60 * 1000).toISOString();
        const toAt = new Date(now + 60 * 1000).toISOString();
        const comparisonFromAt = new Date(now - 10 * 60 * 1000).toISOString();
        const comparisonToAt = new Date(now - 6 * 60 * 1000).toISOString();
        const packagePath = `/api/v1/party-statements/dashboard-package?partyType=sender_receiver&partyId=${partyId}` +
            `&fromAt=${encodeURIComponent(fromAt)}&toAt=${encodeURIComponent(toAt)}` +
            `&tabs=statement,comparison,analytics&comparisonFromAt=${encodeURIComponent(comparisonFromAt)}&comparisonToAt=${encodeURIComponent(comparisonToAt)}`;
        const beforeRes = await request(baseUrl, packagePath, {
            auth: { userId: adminUserId },
        });
        ensure(beforeRes.status === 200 && beforeRes.body.success, 'Initial dashboard package fetch failed');
        const beforeInflow = Number(beforeRes.body.data?.statement?.summary.period_inflow_usd ?? 0);
        const createVoucher = await request(baseUrl, '/api/v1/receipt-vouchers', {
            method: 'POST',
            auth: { userId: adminUserId },
            body: JSON.stringify({
                voucherNo: `RV-P310-${Date.now()}`,
                branchId,
                senderReceiverId: partyId,
                status: 'confirmed',
                notes: 'Phase310 cache invalidation receipt',
                originalAmount: 55,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
                createdByUserId: adminUserId,
            }),
        });
        ensure(createVoucher.status === 201 && createVoucher.body.success, 'Receipt creation failed');
        const afterRes = await request(baseUrl, packagePath, {
            auth: { userId: adminUserId },
        });
        ensure(afterRes.status === 200 && afterRes.body.success, 'Dashboard package fetch after write failed');
        const afterInflow = Number(afterRes.body.data?.statement?.summary.period_inflow_usd ?? 0);
        ensure(afterInflow >= beforeInflow + 55, 'Dashboard cache should invalidate after write and reflect new receipt');
        console.info('[PHASE3.10 DASHBOARD CACHE SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runPhase310DashboardCacheSmoke().catch((error) => {
    console.error('[PHASE3.10 DASHBOARD CACHE SMOKE] Failed:', error);
    process.exit(1);
});
