import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type LedgerResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    voucher_id: string;
    original_currency: 'USD' | 'SYP' | 'TRY';
    signed_base_amount_usd: number;
    is_reversal: boolean;
  }>;
};

type CurrencySummaryRow = {
  original_currency: 'USD' | 'SYP' | 'TRY';
  entries_count: number;
  inflow_original_amount: number;
  outflow_original_amount: number;
  net_original_amount: number;
  inflow_base_usd: number;
  outflow_base_usd: number;
  net_base_usd: number;
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

async function runPhase35LedgerAggregationSmoke() {
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
        code: `P35-SR-${Date.now()}`,
        full_name: `Phase35 Party ${Date.now()}`,
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
        voucherNo: `RV-P35-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase35 ledger receipt',
        originalAmount: 100,
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
        voucherNo: `PV-P35-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'confirmed',
        notes: 'Phase35 ledger payment',
        originalAmount: 50,
        originalCurrency: 'TRY',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(paymentRes.status === 201 && paymentRes.body.success, 'Payment creation failed');
    const paymentVoucherId = paymentRes.body.data?.id;
    ensure(Boolean(paymentVoucherId), 'Payment voucher id missing');

    const ledgerAll = await request<LedgerResponse>(
      baseUrl,
      `/api/v1/party-statements/ledger?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}&page=1&pageSize=50`,
      { auth: { userId: adminUserId } },
    );
    ensure(ledgerAll.status === 200 && ledgerAll.body.success, 'Ledger fetch failed');
    const allData = ledgerAll.body.data;
    ensure(Boolean(allData), 'Ledger full data missing');
    const allVoucherIds = new Set((allData?.rows || []).map((row) => row.voucher_id));
    ensure(allVoucherIds.has(receiptVoucherId!), 'Receipt voucher should appear in ledger');
    ensure(allVoucherIds.has(paymentVoucherId!), 'Payment voucher should appear in ledger');

    const ledgerPage1 = await request<LedgerResponse>(
      baseUrl,
      `/api/v1/party-statements/ledger?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}&page=1&pageSize=1`,
      { auth: { userId: adminUserId } },
    );
    ensure(ledgerPage1.status === 200 && ledgerPage1.body.success, 'Ledger page 1 fetch failed');
    const page1Data = ledgerPage1.body.data;
    ensure(Boolean(page1Data), 'Ledger page 1 data missing');
    ensure(page1Data!.page === 1 && page1Data!.pageSize === 1, 'Ledger pagination metadata mismatch');
    ensure(page1Data!.total >= 2, 'Ledger total should include at least two entries');
    ensure(page1Data!.rows.length === 1, 'Ledger page 1 should return one row');

    const ledgerPage2 = await request<LedgerResponse>(
      baseUrl,
      `/api/v1/party-statements/ledger?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}&page=2&pageSize=1`,
      { auth: { userId: adminUserId } },
    );
    ensure(ledgerPage2.status === 200 && ledgerPage2.body.success, 'Ledger page 2 fetch failed');
    const page2Data = ledgerPage2.body.data;
    ensure(Boolean(page2Data), 'Ledger page 2 data missing');
    ensure(page2Data!.rows.length === 1, 'Ledger page 2 should return one row');

    const summaryRes = await request<CurrencySummaryRow[]>(
      baseUrl,
      `/api/v1/party-statements/currency-summary?partyType=sender_receiver&partyId=${partyId}&fromAt=${encodeURIComponent(fromAt)}`,
      { auth: { userId: adminUserId } },
    );
    ensure(summaryRes.status === 200 && summaryRes.body.success, 'Currency summary fetch failed');
    const summaryRows = summaryRes.body.data || [];
    const usdRow = summaryRows.find((row) => row.original_currency === 'USD');
    const tryRow = summaryRows.find((row) => row.original_currency === 'TRY');
    ensure(Boolean(usdRow), 'USD summary row missing');
    ensure(Boolean(tryRow), 'TRY summary row missing');
    ensure(Number(usdRow!.inflow_original_amount) >= 100, 'USD inflow should include confirmed receipt amount');
    ensure(Number(tryRow!.outflow_original_amount) >= 50, 'TRY outflow should include confirmed payment amount');

    console.info('[PHASE3.5 LEDGER AGGREGATION SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase35LedgerAggregationSmoke().catch((error) => {
  console.error('[PHASE3.5 LEDGER AGGREGATION SMOKE] Failed:', error);
  process.exit(1);
});
