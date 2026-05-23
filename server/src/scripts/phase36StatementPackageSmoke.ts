import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type PackageResponse = {
  summary: {
    opening_balance_usd: number;
    period_inflow_usd: number;
    period_outflow_usd: number;
    closing_balance_usd: number;
  };
  currencySummary: Array<{
    original_currency: 'USD' | 'SYP' | 'TRY';
    entries_count: number;
    inflow_original_amount: number;
    outflow_original_amount: number;
    net_original_amount: number;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  }>;
  ledger: {
    page: number;
    pageSize: number;
    total: number;
    rows: Array<{
      voucher_id: string;
      original_currency: 'USD' | 'SYP' | 'TRY';
      signed_base_amount_usd: number;
    }>;
  };
};

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

async function runPhase36StatementPackageSmoke() {
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
        code: `P36-SR-${Date.now()}`,
        full_name: `Phase36 Party ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(partySeed.status === 201 && partySeed.body.success, 'Cannot create isolated party');
    const partyId = partySeed.body.data?.id;
    ensure(Boolean(partyId), 'Isolated party id missing');

    const fromAt = new Date(Date.now() - 3_000).toISOString();

    const receiptRes = await request<{ id: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P36-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase36 package receipt',
        originalAmount: 75,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(receiptRes.status === 201 && receiptRes.body.success, 'Receipt creation failed');
    const receiptVoucherId = receiptRes.body.data?.id;
    ensure(Boolean(receiptVoucherId), 'Receipt voucher id missing');

    const paymentRes = await request<{ id: string }>(baseUrl, '/api/v1/payment-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `PV-P36-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase36 package payment',
        originalAmount: 30,
        originalCurrency: 'TRY',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(paymentRes.status === 201 && paymentRes.body.success, 'Payment creation failed');
    const paymentVoucherId = paymentRes.body.data?.id;
    ensure(Boolean(paymentVoucherId), 'Payment voucher id missing');

    const packageRes = await request<PackageResponse>(
      baseUrl,
      `/api/v1/party-statements/package?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}&page=1&pageSize=50`,
      { auth: { userId: adminUserId } },
    );
    ensure(packageRes.status === 200 && packageRes.body.success, 'Package endpoint failed');
    const payload = packageRes.body.data;
    ensure(Boolean(payload), 'Package payload missing');
    ensure(payload!.ledger.page === 1 && payload!.ledger.pageSize === 50, 'Package ledger pagination mismatch');
    ensure(payload!.ledger.total >= 2, 'Package ledger total should include expected entries');
    ensure(Number(payload!.summary.period_inflow_usd) >= 75, 'Package summary inflow should include receipt');
    ensure(Number(payload!.summary.period_outflow_usd) >= 30, 'Package summary outflow should include payment');

    const vouchersInLedger = new Set((payload?.ledger.rows || []).map((row) => row.voucher_id));
    ensure(vouchersInLedger.has(receiptVoucherId!), 'Receipt voucher missing in package ledger');
    ensure(vouchersInLedger.has(paymentVoucherId!), 'Payment voucher missing in package ledger');

    const currencies = new Set((payload?.currencySummary || []).map((row) => row.original_currency));
    ensure(currencies.has('USD'), 'Package currency summary missing USD');
    ensure(currencies.has('TRY'), 'Package currency summary missing TRY');

    console.info('[PHASE3.6 STATEMENT PACKAGE SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase36StatementPackageSmoke().catch((error) => {
  console.error('[PHASE3.6 STATEMENT PACKAGE SMOKE] Failed:', error);
  process.exit(1);
});
