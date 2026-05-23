import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type AnalyticsResponse = {
  kpis: {
    entries_count: number;
    parties_count: number;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  };
  topParties: Array<{
    party_type: 'customer' | 'sender_receiver' | 'agent';
    party_id: string;
    entries_count: number;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  }>;
  trend: Array<{
    day: string;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  }>;
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

async function runPhase38AnalyticsSnapshotSmoke() {
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

    const party1 = await request<{ id: string }>(baseUrl, '/api/v1/senders-receivers', {
      method: 'POST',
      body: JSON.stringify({
        code: `P38-SR-A-${Date.now()}`,
        full_name: `Phase38 Party A ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(party1.status === 201 && party1.body.success, 'Cannot create party A');
    const party1Id = party1.body.data?.id;
    ensure(Boolean(party1Id), 'Party A id missing');

    const party2 = await request<{ id: string }>(baseUrl, '/api/v1/senders-receivers', {
      method: 'POST',
      body: JSON.stringify({
        code: `P38-SR-B-${Date.now()}`,
        full_name: `Phase38 Party B ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(party2.status === 201 && party2.body.success, 'Cannot create party B');
    const party2Id = party2.body.data?.id;
    ensure(Boolean(party2Id), 'Party B id missing');

    const fromAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const receiptPartyA = await request<{ id: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P38-A-${Date.now()}`,
        branchId,
        senderReceiverId: party1Id,
        status: 'confirmed',
        notes: 'Phase38 analytics inflow A',
        originalAmount: 200,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(receiptPartyA.status === 201 && receiptPartyA.body.success, 'Receipt A creation failed');

    const paymentPartyA = await request<{ id: string }>(baseUrl, '/api/v1/payment-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `PV-P38-A-${Date.now()}`,
        branchId,
        senderReceiverId: party1Id,
        status: 'confirmed',
        notes: 'Phase38 analytics outflow A',
        originalAmount: 40,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(paymentPartyA.status === 201 && paymentPartyA.body.success, 'Payment A creation failed');

    const receiptPartyB = await request<{ id: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P38-B-${Date.now()}`,
        branchId,
        senderReceiverId: party2Id,
        status: 'confirmed',
        notes: 'Phase38 analytics inflow B',
        originalAmount: 110,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(receiptPartyB.status === 201 && receiptPartyB.body.success, 'Receipt B creation failed');

    const analyticsRes = await request<AnalyticsResponse>(
      baseUrl,
      `/api/v1/party-statements/analytics?partyType=sender_receiver&fromAt=${encodeURIComponent(fromAt)}&topN=2`,
      { auth: { userId: adminUserId } },
    );
    ensure(analyticsRes.status === 200 && analyticsRes.body.success, 'Analytics endpoint failed');
    const payload = analyticsRes.body.data;
    ensure(Boolean(payload), 'Analytics payload missing');

    ensure(Number(payload!.kpis.entries_count) >= 3, 'Entries KPI should include test postings');
    ensure(Number(payload!.kpis.parties_count) >= 2, 'Parties KPI should include both test parties');
    ensure(Number(payload!.kpis.inflow_base_usd) >= 310, 'Inflow KPI should include both receipts');
    ensure(Number(payload!.kpis.outflow_base_usd) >= 40, 'Outflow KPI should include payment');
    ensure(payload!.topParties.length >= 1, 'Top parties should not be empty');
    ensure(payload!.trend.length >= 1, 'Trend should include at least one day bucket');

    const topPartyIds = new Set(payload!.topParties.map((row) => row.party_id));
    ensure(topPartyIds.has(party1Id!), 'Top parties should include party A with highest net');

    console.info('[PHASE3.8 ANALYTICS SNAPSHOT SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase38AnalyticsSnapshotSmoke().catch((error) => {
  console.error('[PHASE3.8 ANALYTICS SNAPSHOT SMOKE] Failed:', error);
  process.exit(1);
});
