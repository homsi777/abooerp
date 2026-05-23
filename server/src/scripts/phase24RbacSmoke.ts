import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { auth?: { userId?: string } },
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
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

async function upsertUserByRole(roleCode: 'operator' | 'viewer', branchId: string) {
  const role = await pool.query<{ id: string }>('select id from roles where code = $1 limit 1', [roleCode]);
  ensure(Boolean(role.rowCount), `Missing role ${roleCode}`);

  const timestamp = Date.now();
  const username = `${roleCode}_phase24_${timestamp}`;
  const userInsert = await pool.query<{ id: string }>(
    `
    insert into users(username, full_name, email, phone, password_hash, role_id, branch_id, status)
    values($1, $2, $3, $4, $5, $6, $7, 'active')
    returning id
    `,
    [
      username,
      `${roleCode} phase24`,
      `${username}@local.erp`,
      `+963${Math.floor(Math.random() * 900000 + 100000)}`,
      'seed_hash_placeholder',
      role.rows[0].id,
      branchId,
    ],
  );

  return userInsert.rows[0].id;
}

async function runRbacSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const branches = await request<Array<{ id: string }>>(baseUrl, '/api/v1/branches');
    ensure(branches.status === 200 && branches.body.success, 'Cannot list branches');
    const branchId = branches.body.data?.[0]?.id;
    ensure(Boolean(branchId), 'Missing branch for RBAC smoke');

    const senders = await request<Array<{ id: string }>>(baseUrl, '/api/v1/senders-receivers');
    ensure(senders.status === 200 && senders.body.success, 'Cannot list sender/receiver');
    const senderId = senders.body.data?.[0]?.id;
    const receiverId = senders.body.data?.[1]?.id || senders.body.data?.[0]?.id;
    ensure(Boolean(senderId && receiverId), 'Missing sender/receiver seed data');

    const operatorUserId = await upsertUserByRole('operator', branchId!);
    const viewerUserId = await upsertUserByRole('viewer', branchId!);

    const viewerCreateAttempt = await request(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      auth: { userId: viewerUserId },
      body: JSON.stringify({
        shipmentNo: `SHP-RBAC-VIEWER-${Date.now()}`,
        senderId,
        receiverId,
        branchId,
        destinationCity: 'RBAC City',
        piecesCount: 1,
        status: 'created',
        originalAmount: 30,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(viewerCreateAttempt.status === 403, 'Viewer should be blocked from shipment create');

    const operatorCreate = await request<{ id: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      auth: { userId: operatorUserId },
      body: JSON.stringify({
        shipmentNo: `SHP-RBAC-OPER-${Date.now()}`,
        senderId,
        receiverId,
        branchId,
        destinationCity: 'RBAC City',
        piecesCount: 1,
        status: 'created',
        originalAmount: 40,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(operatorCreate.status === 201 && operatorCreate.body.success, 'Operator should create shipment');
    const shipmentId = operatorCreate.body.data?.id;
    ensure(Boolean(shipmentId), 'Operator-created shipment id missing');

    const viewerUpdateAttempt = await request(baseUrl, `/api/v1/shipments/${shipmentId}`, {
      method: 'PUT',
      auth: { userId: viewerUserId },
      body: JSON.stringify({ status: 'in_transit' }),
    });
    ensure(viewerUpdateAttempt.status === 403, 'Viewer should be blocked from shipment update');

    const operatorUpdate = await request(baseUrl, `/api/v1/shipments/${shipmentId}`, {
      method: 'PUT',
      auth: { userId: operatorUserId },
      body: JSON.stringify({ status: 'in_transit' }),
    });
    ensure(operatorUpdate.status === 200, 'Operator should update shipment');

    console.info('[PHASE2.4 RBAC SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runRbacSmoke().catch(async (error) => {
  console.error('[PHASE2.4 RBAC SMOKE] Failed:', error);
  process.exit(1);
});
