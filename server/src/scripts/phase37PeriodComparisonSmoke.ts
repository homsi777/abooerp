import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type ComparisonResponse = {
  currentPeriod: {
    fromAt: string;
    toAt: string;
    summary: {
      opening_balance_usd: number;
      period_inflow_usd: number;
      period_outflow_usd: number;
      closing_balance_usd: number;
    };
  };
  previousPeriod: {
    fromAt: string;
    toAt: string;
    summary: {
      opening_balance_usd: number;
      period_inflow_usd: number;
      period_outflow_usd: number;
      closing_balance_usd: number;
    };
  };
  delta: {
    closing_balance_usd: number;
    current_closing_balance_usd: number;
    previous_closing_balance_usd: number;
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

async function runPhase37PeriodComparisonSmoke() {
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
        code: `P37-SR-${Date.now()}`,
        full_name: `Phase37 Party ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(partySeed.status === 201 && partySeed.body.success, 'Cannot create isolated party');
    const partyId = partySeed.body.data?.id;
    ensure(Boolean(partyId), 'Isolated party id missing');

    const now = Date.now();
    const currentFrom = new Date(now - 5 * 60 * 1000).toISOString();
    const currentTo = new Date(now + 60 * 1000).toISOString();

    const receiptRes = await request<{ id: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P37-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase37 comparison receipt',
        originalAmount: 64,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(receiptRes.status === 201 && receiptRes.body.success, 'Receipt creation failed');

    const compareRes = await request<ComparisonResponse>(
      baseUrl,
      `/api/v1/party-statements/compare?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(currentFrom)}&toAt=${encodeURIComponent(currentTo)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(compareRes.status === 200 && compareRes.body.success, 'Comparison endpoint failed');

    const payload = compareRes.body.data;
    ensure(Boolean(payload), 'Comparison payload missing');

    const currentClosing = Number(payload!.currentPeriod.summary.closing_balance_usd || 0);
    const previousClosing = Number(payload!.previousPeriod.summary.closing_balance_usd || 0);
    const delta = Number(payload!.delta.closing_balance_usd || 0);

    ensure(currentClosing > 0, 'Current closing balance should be positive after current-period receipt');
    ensure(Math.abs(previousClosing) < 0.0001, 'Previous period should not include current-period receipt');
    ensure(Math.abs(delta - (currentClosing - previousClosing)) < 0.0001, 'Delta closing balance mismatch');

    console.info('[PHASE3.7 PERIOD COMPARISON SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase37PeriodComparisonSmoke().catch((error) => {
  console.error('[PHASE3.7 PERIOD COMPARISON SMOKE] Failed:', error);
  process.exit(1);
});
