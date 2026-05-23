import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { auth?: { userId?: string } },
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init?.auth?.userId) headers['x-user-id'] = init.auth.userId;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  return { status: response.status, body };
}

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

type Summary = {
  opening_balance_usd: number;
  period_inflow_usd: number;
  period_outflow_usd: number;
  closing_balance_usd: number;
};

type StatementEntry = {
  voucher_id: string;
  signed_base_amount_usd: number;
  is_reversal: boolean;
};

async function runPartyStatementSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const admin = await pool.query<{ id: string; branch_id: string | null }>(
      `select id, branch_id from users where username = 'admin' limit 1`,
    );
    ensure(Boolean(admin.rowCount), 'Admin missing');
    const adminUserId = admin.rows[0].id;
    const branchId = admin.rows[0].branch_id;
    ensure(Boolean(branchId), 'Admin branch missing');

    const partySeed = await request<{ id: string }>(baseUrl, '/api/v1/senders-receivers', {
      method: 'POST',
      body: JSON.stringify({
        code: `P34-SR-${Date.now()}`,
        full_name: `Phase34 Party ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(partySeed.status === 201 && partySeed.body.success, 'Cannot create isolated party');
    const partyId = partySeed.body.data?.id;
    ensure(Boolean(partyId), 'Isolated party id missing');

    const fromAt = new Date(Date.now() - 3_000).toISOString();

    const beforeSummaryRes = await request<Summary>(
      baseUrl,
      `/api/v1/party-statements/summary?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(beforeSummaryRes.status === 200 && beforeSummaryRes.body.success, 'Cannot fetch statement summary before actions');
    const beforeClosing = Number(beforeSummaryRes.body.data?.closing_balance_usd ?? 0);

    const createVoucher = await request<{ id: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P34-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase34 statement smoke',
        originalAmount: 123,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(createVoucher.status === 201 && createVoucher.body.success, 'Confirmed receipt creation failed');
    const voucherId = createVoucher.body.data?.id;
    ensure(Boolean(voucherId), 'Voucher id missing');

    const afterConfirmRes = await request<Summary>(
      baseUrl,
      `/api/v1/party-statements/summary?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(afterConfirmRes.status === 200 && afterConfirmRes.body.success, 'Cannot fetch statement summary after confirm');
    const afterConfirmClosing = Number(afterConfirmRes.body.data?.closing_balance_usd ?? 0);
    ensure(afterConfirmClosing > beforeClosing, 'Closing balance should increase after confirmed receipt');

    const cancelVoucher = await request(baseUrl, `/api/v1/receipt-vouchers/${voucherId}`, {
      method: 'PUT',
      auth: { userId: adminUserId },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    ensure(cancelVoucher.status === 200 && cancelVoucher.body.success, 'Voucher cancellation failed');

    const afterCancelRes = await request<Summary>(
      baseUrl,
      `/api/v1/party-statements/summary?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(afterCancelRes.status === 200 && afterCancelRes.body.success, 'Cannot fetch statement summary after cancellation');
    const afterCancelClosing = Number(afterCancelRes.body.data?.closing_balance_usd ?? 0);
    ensure(Math.abs(afterCancelClosing - beforeClosing) < 0.0001, 'Closing balance should return to baseline after reversal');

    const entriesRes = await request<StatementEntry[]>(
      baseUrl,
      `/api/v1/party-statements/entries?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(entriesRes.status === 200 && entriesRes.body.success, 'Cannot fetch statement entries');
    const voucherEntries = (entriesRes.body.data || []).filter((row) => row.voucher_id === voucherId);
    ensure(voucherEntries.length >= 2, 'Expected original and reversal statement entries');
    const signedSum = voucherEntries.reduce((acc, row) => acc + Number(row.signed_base_amount_usd || 0), 0);
    ensure(Math.abs(signedSum) < 0.0001, 'Net signed amount for cancelled voucher should be zero');

    console.info('[PHASE3.4 PARTY STATEMENT SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPartyStatementSmoke().catch((error) => {
  console.error('[PHASE3.4 PARTY STATEMENT SMOKE] Failed:', error);
  process.exit(1);
});
