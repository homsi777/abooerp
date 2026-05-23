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
async function runPhase311CacheMetricsSmoke() {
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
                code: `P311-SR-${Date.now()}`,
                full_name: `Phase311 Party ${Date.now()}`,
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
        const metricsPath = '/api/v1/party-statements/dashboard-cache-metrics';
        const packagePath = `/api/v1/party-statements/dashboard-package?partyType=sender_receiver&partyId=${partyId}` +
            `&fromAt=${encodeURIComponent(fromAt)}&toAt=${encodeURIComponent(toAt)}` +
            `&tabs=statement,comparison,analytics&comparisonFromAt=${encodeURIComponent(comparisonFromAt)}&comparisonToAt=${encodeURIComponent(comparisonToAt)}`;
        const metricsBefore = await request(baseUrl, metricsPath, {
            auth: { userId: adminUserId },
        });
        ensure(metricsBefore.status === 200 && metricsBefore.body.success, 'Cannot read initial cache metrics');
        const before = metricsBefore.body.data;
        const firstRead = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
        ensure(firstRead.status === 200 && firstRead.body.success, 'First dashboard package read failed');
        const secondRead = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
        ensure(secondRead.status === 200 && secondRead.body.success, 'Second dashboard package read failed');
        const createVoucher = await request(baseUrl, '/api/v1/receipt-vouchers', {
            method: 'POST',
            auth: { userId: adminUserId },
            body: JSON.stringify({
                voucherNo: `RV-P311-${Date.now()}`,
                branchId,
                senderReceiverId: partyId,
                status: 'confirmed',
                notes: 'Phase311 cache metrics receipt',
                originalAmount: 61,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
                createdByUserId: adminUserId,
            }),
        });
        ensure(createVoucher.status === 201 && createVoucher.body.success, 'Receipt creation failed');
        const thirdRead = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
        ensure(thirdRead.status === 200 && thirdRead.body.success, 'Third dashboard package read failed');
        const metricsAfter = await request(baseUrl, metricsPath, {
            auth: { userId: adminUserId },
        });
        ensure(metricsAfter.status === 200 && metricsAfter.body.success, 'Cannot read final cache metrics');
        const after = metricsAfter.body.data;
        ensure(after.counters.misses >= before.counters.misses + 2, 'Expected at least two cache misses (first + post-invalidation)');
        ensure(after.counters.hits >= before.counters.hits + 1, 'Expected at least one cache hit (second read)');
        ensure(after.counters.invalidations >= before.counters.invalidations + 1, 'Expected cache invalidation after voucher write');
        ensure(after.counters.sets >= before.counters.sets + 2, 'Expected cache set for first and third reads');
        ensure(after.ttlMs === 15000, 'Unexpected dashboard cache TTL');
        console.info('[PHASE3.11 CACHE METRICS SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runPhase311CacheMetricsSmoke().catch((error) => {
    console.error('[PHASE3.11 CACHE METRICS SMOKE] Failed:', error);
    process.exit(1);
});
