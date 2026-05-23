import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & {
    auth?: { userId?: string };
    scope?: { branchId?: string };
    idempotencyKey?: string;
  }
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init?.auth?.userId) headers['x-user-id'] = init.auth.userId;
  if (init?.scope?.branchId) headers['x-branch-id'] = init.scope.branchId;
  if (init?.idempotencyKey) headers['x-idempotency-key'] = init.idempotencyKey;

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

async function runC9Smoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const admin = await pool.query<{ id: string; branch_id: string | null }>(
      `select id, branch_id from users where username = 'admin' limit 1`
    );
    ensure(Boolean(admin.rowCount), 'Admin missing');
    const adminId = admin.rows[0].id;
    const branchId = admin.rows[0].branch_id;
    ensure(Boolean(branchId), 'Admin branch missing');

    const parties = await pool.query<{ id: string }>(
      `select id from senders_receivers where status = 'active' order by created_at asc limit 2`
    );
    ensure((parties.rowCount ?? 0) >= 2, 'Need at least 2 sender/receiver records');
    const senderId = parties.rows[0].id;
    const receiverId = parties.rows[1].id;

    const shipmentNo = `C9-SHP-${Date.now()}`;
    const idemKey = `c9-shipment-create-${Date.now()}`;
    const shipmentPayload = {
      shipmentNo,
      senderId,
      receiverId,
      branchId,
      destinationCity: 'Damascus',
      piecesCount: 1,
      status: 'created',
      originalAmount: 100,
      originalCurrency: 'USD',
      exchangeRateToUsd: 1,
    };

    const [s1, s2] = await Promise.all([
      request<any>(baseUrl, '/api/v1/shipments', {
        method: 'POST',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: idemKey,
        body: JSON.stringify(shipmentPayload),
      }),
      request<any>(baseUrl, '/api/v1/shipments', {
        method: 'POST',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: idemKey,
        body: JSON.stringify(shipmentPayload),
      }),
    ]);

    const shipmentSuccessCount = [s1.status, s2.status].filter((status) => status === 201).length;
    const shipmentConflictCount = [s1.status, s2.status].filter((status) => status === 409).length;
    ensure(
      shipmentSuccessCount === 1 && shipmentConflictCount === 1,
      'Shipment idempotency guard failed under concurrent execution'
    );

    const createdShipment = (s1.status === 201 ? s1.body.data : s2.body.data) as any;
    ensure(Boolean(createdShipment?.id), 'Created shipment missing');

    const optimisticTs = String(createdShipment.updated_at);
    const updatePayload = {
      status: 'in_transit',
      expectedUpdatedAt: optimisticTs,
    };

    const [u1, u2] = await Promise.all([
      request<any>(baseUrl, `/api/v1/shipments/${createdShipment.id}`, {
        method: 'PUT',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: `c9-shipment-update-1-${Date.now()}`,
        body: JSON.stringify(updatePayload),
      }),
      request<any>(baseUrl, `/api/v1/shipments/${createdShipment.id}`, {
        method: 'PUT',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: `c9-shipment-update-2-${Date.now()}`,
        body: JSON.stringify(updatePayload),
      }),
    ]);

    const optimisticSuccessCount = [u1.status, u2.status].filter((status) => status === 200).length;
    const optimisticConflictCount = [u1.status, u2.status].filter((status) => status === 409).length;
    ensure(
      optimisticSuccessCount === 1 && optimisticConflictCount === 1,
      'Shipment optimistic concurrency guard failed'
    );

    const receiptPayload = {
      voucherNo: `C9-RV-${Date.now()}`,
      branchId,
      status: 'draft',
      originalAmount: 50,
      originalCurrency: 'USD',
      exchangeRateToUsd: 1,
      notes: 'C9 finance idempotency test',
    };

    const rvKey = `c9-receipt-${Date.now()}`;
    const [r1, r2] = await Promise.all([
      request<any>(baseUrl, '/api/v1/receipt-vouchers', {
        method: 'POST',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: rvKey,
        body: JSON.stringify(receiptPayload),
      }),
      request<any>(baseUrl, '/api/v1/receipt-vouchers', {
        method: 'POST',
        auth: { userId: adminId },
        scope: { branchId: branchId! },
        idempotencyKey: rvKey,
        body: JSON.stringify(receiptPayload),
      }),
    ]);
    const receiptSuccessCount = [r1.status, r2.status].filter((status) => status === 201).length;
    const receiptConflictCount = [r1.status, r2.status].filter((status) => status === 409).length;
    ensure(
      receiptSuccessCount === 1 && receiptConflictCount === 1,
      'Finance idempotency guard failed under concurrent execution'
    );

    const diagnostics = await request<any>(baseUrl, '/api/v1/system/diagnostics', {
      auth: { userId: adminId },
      scope: { branchId: branchId! },
    });
    ensure(diagnostics.status === 200 && diagnostics.body.success, 'Diagnostics endpoint failed');
    ensure(typeof diagnostics.body.data?.databaseLatencyMs === 'number', 'Expected database latency metric');
    ensure(typeof diagnostics.body.data?.activeSessions === 'number', 'Expected active sessions metric');

    console.info('[PHASE C9 RUNTIME READINESS SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runC9Smoke().catch((error) => {
  console.error('[PHASE C9 RUNTIME READINESS SMOKE] Failed:', error);
  process.exit(1);
});
