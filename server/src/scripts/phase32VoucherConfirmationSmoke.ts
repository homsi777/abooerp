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

async function runConfirmationSmoke() {
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

    const parties = await request<Array<{ id: string }>>(baseUrl, '/api/v1/senders-receivers');
    ensure(parties.status === 200 && parties.body.success, 'Cannot load parties');
    const partyId = parties.body.data?.[0]?.id;
    ensure(Boolean(partyId), 'Party id missing');

    const draftReceipt = await request<{ id: string; status: string }>(baseUrl, '/api/v1/receipt-vouchers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        voucherNo: `RV-P32-${Date.now()}`,
        branchId,
        senderReceiverId: partyId,
        status: 'draft',
        notes: 'Phase32 draft receipt',
        originalAmount: 35,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        createdByUserId: adminUserId,
      }),
    });
    ensure(draftReceipt.status === 201 && draftReceipt.body.success, 'Draft receipt create failed');
    const draftReceiptId = draftReceipt.body.data?.id;
    ensure(Boolean(draftReceiptId), 'Draft receipt id missing');

    const cashAfterDraft = await request<Array<{ source_voucher_type: string; source_voucher_id: string }>>(
      baseUrl,
      '/api/v1/cashbox-transactions',
      { auth: { userId: adminUserId } },
    );
    ensure(
      cashAfterDraft.body.data?.some((row) => row.source_voucher_type === 'receipt' && row.source_voucher_id === draftReceiptId) === false,
      'Draft receipt should not create cashbox transaction before confirmation',
    );

    const movementAfterDraft = await request<Array<{ voucher_type: string; voucher_id: string }>>(
      baseUrl,
      '/api/v1/party-financial-movements',
      { auth: { userId: adminUserId } },
    );
    ensure(
      movementAfterDraft.body.data?.some((row) => row.voucher_type === 'receipt' && row.voucher_id === draftReceiptId) === false,
      'Draft receipt should not create party movement before confirmation',
    );

    const confirmReceipt = await request<{ id: string; status: string }>(baseUrl, `/api/v1/receipt-vouchers/${draftReceiptId}`, {
      method: 'PUT',
      auth: { userId: adminUserId },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    ensure(confirmReceipt.status === 200 && confirmReceipt.body.success, 'Receipt confirmation failed');

    const cashAfterConfirm = await request<Array<{ source_voucher_type: string; source_voucher_id: string }>>(
      baseUrl,
      '/api/v1/cashbox-transactions',
      { auth: { userId: adminUserId } },
    );
    ensure(
      cashAfterConfirm.body.data?.some((row) => row.source_voucher_type === 'receipt' && row.source_voucher_id === draftReceiptId) === true,
      'Confirmed receipt should create cashbox transaction',
    );

    const movementAfterConfirm = await request<Array<{ voucher_type: string; voucher_id: string }>>(
      baseUrl,
      '/api/v1/party-financial-movements',
      { auth: { userId: adminUserId } },
    );
    ensure(
      movementAfterConfirm.body.data?.some((row) => row.voucher_type === 'receipt' && row.voucher_id === draftReceiptId) === true,
      'Confirmed receipt should create party movement',
    );

    console.info('[PHASE3.2 CONFIRMATION POSTING SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runConfirmationSmoke().catch((error) => {
  console.error('[PHASE3.2 CONFIRMATION POSTING SMOKE] Failed:', error);
  process.exit(1);
});
