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
async function runCancellationReversalSmoke() {
    await testDatabaseConnection();
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const admin = await pool.query(`select id, branch_id from users where username = 'admin' limit 1`);
        ensure(Boolean(admin.rowCount), 'Admin missing');
        const adminUserId = admin.rows[0].id;
        const branchId = admin.rows[0].branch_id;
        ensure(Boolean(branchId), 'Admin branch missing');
        const parties = await request(baseUrl, '/api/v1/senders-receivers');
        ensure(parties.status === 200 && parties.body.success, 'Cannot load parties');
        const partyId = parties.body.data?.[0]?.id;
        ensure(Boolean(partyId), 'Party id missing');
        const confirmedReceipt = await request(baseUrl, '/api/v1/receipt-vouchers', {
            method: 'POST',
            auth: { userId: adminUserId },
            body: JSON.stringify({
                voucherNo: `RV-P33-${Date.now()}`,
                branchId,
                senderReceiverId: partyId,
                status: 'confirmed',
                notes: 'Phase33 confirmed receipt',
                originalAmount: 99,
                originalCurrency: 'USD',
                exchangeRateToUsd: 1,
                createdByUserId: adminUserId,
            }),
        });
        ensure(confirmedReceipt.status === 201 && confirmedReceipt.body.success, 'Confirmed receipt creation failed');
        const voucherId = confirmedReceipt.body.data?.id;
        ensure(Boolean(voucherId), 'Voucher id missing');
        const cashBeforeCancel = await request(baseUrl, '/api/v1/cashbox-transactions', { auth: { userId: adminUserId } });
        const originalsBefore = cashBeforeCancel.body.data?.filter((r) => r.source_voucher_id === voucherId && r.is_reversal === false) || [];
        ensure(originalsBefore.length >= 1, 'Original cashbox transaction missing before cancellation');
        const movementsBefore = await request(baseUrl, '/api/v1/party-financial-movements', { auth: { userId: adminUserId } });
        const originalMovementsBefore = movementsBefore.body.data?.filter((r) => r.voucher_id === voucherId && r.is_reversal === false) || [];
        ensure(originalMovementsBefore.length >= 1, 'Original party movement missing before cancellation');
        const cancelVoucher = await request(baseUrl, `/api/v1/receipt-vouchers/${voucherId}`, {
            method: 'PUT',
            auth: { userId: adminUserId },
            body: JSON.stringify({ status: 'cancelled' }),
        });
        ensure(cancelVoucher.status === 200 && cancelVoucher.body.success, 'Voucher cancellation failed');
        const cashAfterCancel = await request(baseUrl, '/api/v1/cashbox-transactions', { auth: { userId: adminUserId } });
        const reversalCash = cashAfterCancel.body.data?.filter((r) => r.source_voucher_id === voucherId && r.is_reversal === true) || [];
        ensure(reversalCash.length >= 1, 'Reversal cashbox transaction missing after cancellation');
        const movementsAfterCancel = await request(baseUrl, '/api/v1/party-financial-movements', { auth: { userId: adminUserId } });
        const reversalMovements = movementsAfterCancel.body.data?.filter((r) => r.voucher_id === voucherId && r.is_reversal === true) || [];
        ensure(reversalMovements.length >= 1, 'Reversal party movement missing after cancellation');
        console.info('[PHASE3.3 CANCELLATION REVERSAL SMOKE] All checks passed.');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await pool.end();
    }
}
runCancellationReversalSmoke().catch((error) => {
    console.error('[PHASE3.3 CANCELLATION REVERSAL SMOKE] Failed:', error);
    process.exit(1);
});
