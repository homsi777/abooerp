import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { scope?: { branchId?: string; agentId?: string } },
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (init?.scope?.branchId) headers['x-branch-id'] = init.scope.branchId;
  if (init?.scope?.agentId) headers['x-agent-id'] = init.scope.agentId;

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

async function runScopeSmoke() {
  await testDatabaseConnection();

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const branches = await request<Array<{ id: string; code: string }>>(baseUrl, '/api/v1/branches');
    ensure(branches.status === 200 && branches.body.success, 'Branches endpoint unavailable');
    const branchA = branches.body.data?.[0]?.id;
    ensure(Boolean(branchA), 'Missing base branch for scope smoke');

    const branchBCreate = await request<{ id: string }>(baseUrl, '/api/v1/branches', {
      method: 'POST',
      body: JSON.stringify({
        code: `BR-SCOPE-${Date.now()}`,
        name: 'Scope Test Branch',
        city: 'Scope City',
        address: 'Scope Address',
        phone: '+111',
        is_active: true,
      }),
    });
    ensure(branchBCreate.status === 201 && branchBCreate.body.success, 'Failed to create second branch');
    const branchB = branchBCreate.body.data?.id;
    ensure(Boolean(branchB), 'Missing second branch id');

    const srs = await request<Array<{ id: string }>>(baseUrl, '/api/v1/senders-receivers');
    ensure(srs.status === 200 && srs.body.success, 'Senders/receivers endpoint unavailable');
    const senderId = srs.body.data?.[0]?.id;
    const receiverId = srs.body.data?.[1]?.id || srs.body.data?.[0]?.id;
    ensure(Boolean(senderId && receiverId), 'Missing sender/receiver for scope smoke');

    const shipmentA = await request<{ id: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      body: JSON.stringify({
        shipmentNo: `SHP-SCOPE-A-${Date.now()}`,
        senderId,
        receiverId,
        branchId: branchA,
        destinationCity: 'Scope A',
        piecesCount: 1,
        status: 'created',
        originalAmount: 10,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(shipmentA.status === 201 && shipmentA.body.success, 'Failed to create shipment for branch A');
    const shipmentAId = shipmentA.body.data?.id;

    const shipmentB = await request<{ id: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      body: JSON.stringify({
        shipmentNo: `SHP-SCOPE-B-${Date.now()}`,
        senderId,
        receiverId,
        branchId: branchB,
        destinationCity: 'Scope B',
        piecesCount: 1,
        status: 'created',
        originalAmount: 12,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(shipmentB.status === 201 && shipmentB.body.success, 'Failed to create shipment for branch B');
    const shipmentBId = shipmentB.body.data?.id;

    const shipmentsScopedA = await request<Array<{ id: string; branch_id: string }>>(baseUrl, '/api/v1/shipments', {
      scope: { branchId: branchA! },
    });
    ensure(shipmentsScopedA.status === 200, 'Scoped shipment list failed for branch A');
    ensure(
      shipmentsScopedA.body.data?.some((s) => s.id === shipmentAId) === true,
      'Branch A scoped shipments missing own shipment',
    );
    ensure(
      shipmentsScopedA.body.data?.some((s) => s.id === shipmentBId) === false,
      'Branch A scoped shipments leaked branch B shipment',
    );

    const forbiddenCreate = await request(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      scope: { branchId: branchA! },
      body: JSON.stringify({
        shipmentNo: `SHP-SCOPE-FORBID-${Date.now()}`,
        senderId,
        receiverId,
        branchId: branchB,
        destinationCity: 'Scope Forbidden',
        piecesCount: 1,
        status: 'created',
        originalAmount: 11,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(forbiddenCreate.status === 403, 'Scoped shipment create did not reject cross-branch insert');

    const manifestsA = await request<Array<{ id: string }>>(baseUrl, '/api/v1/manifests', { scope: { branchId: branchA! } });
    ensure(manifestsA.status === 200, 'Scoped manifest list failed');

    const deliveriesA = await request<Array<{ id: string }>>(baseUrl, '/api/v1/deliveries', { scope: { branchId: branchA! } });
    ensure(deliveriesA.status === 200, 'Scoped delivery list failed');

    console.info('[PHASE2.2 SCOPE SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runScopeSmoke().catch(async (error) => {
  console.error('[PHASE2.2 SCOPE SMOKE] Failed:', error);
  await pool.end();
  process.exit(1);
});
