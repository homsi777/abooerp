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
async function runPhase39DashboardPackageSmoke() {
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
                code: `P39-SR-${Date.now()}`,
                full_name: `Phase39 Party ${Date.now()}`,
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
        const receiptRes = await request(baseUrl, '/api/v1/receipt-vouchers', {
            method: 'POST',
            auth: { userId: adminUserId },
            body: JSON.stringify({
                voucherNo: `RV-P39-${Date.now()}`,
                branchId,
                senderReceiverId: partyId,
                status: 'confirmed',
                notes: 'Phase39 dashboard receipt',
                originalAmount: 90,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
                createdByUserId: adminUserId,
            }),
        });
        ensure(receiptRes.status === 201 && receiptRes.body.success, 'Receipt creation failed');
        const statementAnalyticsRes = await request(baseUrl, `/api/v1/party-statements/dashboard-package?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}&toAt=${encodeURIComponent(toAt)}&tabs=statement,analytics&page=1&pageSize=20&topN=3`, { auth: { userId: adminUserId } });
        ensure(statementAnalyticsRes.status === 200 && statementAnalyticsRes.body.success, 'Dashboard package (statement+analytics) failed');
        const saPayload = statementAnalyticsRes.body.data;
        ensure(Boolean(saPayload), 'Statement+analytics payload missing');
        ensure(saPayload.tabs.statement && saPayload.tabs.analytics && !saPayload.tabs.comparison, 'Tabs flags mismatch for statement+analytics');
        ensure(saPayload.statement !== null, 'Statement block missing');
        ensure(saPayload.analytics !== null, 'Analytics block missing');
        ensure(saPayload.comparison === null, 'Comparison block should be null when not requested');
        ensure(Number(saPayload.statement.summary.period_inflow_usd) >= 90, 'Statement inflow should include receipt');
        ensure(Number(saPayload.analytics.kpis.entries_count) >= 1, 'Analytics KPIs should include entries');
        const comparisonRes = await request(baseUrl, `/api/v1/party-statements/dashboard-package?partyType=sender_receiver&partyId=${partyId}&tabs=comparison&comparisonFromAt=${encodeURIComponent(comparisonFromAt)}&comparisonToAt=${encodeURIComponent(comparisonToAt)}`, { auth: { userId: adminUserId } });
        ensure(comparisonRes.status === 200 && comparisonRes.body.success, 'Dashboard package (comparison) failed');
        const cPayload = comparisonRes.body.data;
        ensure(Boolean(cPayload), 'Comparison payload missing');
        ensure(!cPayload.tabs.statement && !cPayload.tabs.analytics && cPayload.tabs.comparison, 'Tabs flags mismatch for comparison');
        ensure(cPayload.statement === null, 'Statement block should be null for comparison-only');
        ensure(cPayload.analytics === null, 'Analytics block should be null for comparison-only');
        ensure(cPayload.comparison !== null, 'Comparison block missing for comparison-only');
        console.info('[PHASE3.9 DASHBOARD PACKAGE SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runPhase39DashboardPackageSmoke().catch((error) => {
    console.error('[PHASE3.9 DASHBOARD PACKAGE SMOKE] Failed:', error);
    process.exit(1);
});
