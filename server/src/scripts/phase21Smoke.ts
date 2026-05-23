import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  return { status: response.status, body };
}

function ensure(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runSmoke() {
  await testDatabaseConnection();

  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await request<{ status: string }>(baseUrl, '/api/health');
    ensure(health.status === 200 && health.body.success, 'Health endpoint failed');

    const branchesResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/branches');
    ensure(branchesResp.status === 200 && branchesResp.body.success, 'Branches list failed');
    const branchId = branchesResp.body.data?.[0]?.id;
    ensure(Boolean(branchId), 'No branch available for smoke test');

    const srResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/senders-receivers');
    ensure(srResp.status === 200 && srResp.body.success, 'Senders/receivers list failed');
    const senderId = srResp.body.data?.[0]?.id;
    const receiverId = srResp.body.data?.[1]?.id || srResp.body.data?.[0]?.id;
    ensure(Boolean(senderId && receiverId), 'No sender/receiver available for smoke test');

    const shipmentCreate = await request<{ id: string; status: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      body: JSON.stringify({
        shipmentNo: `SHP-SMOKE-${Date.now()}`,
        senderId,
        receiverId,
        branchId,
        destinationCity: 'Smoke City',
        piecesCount: 1,
        status: 'created',
        originalAmount: 100,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(shipmentCreate.status === 201 && shipmentCreate.body.success, 'Shipment create failed');
    const shipmentId = shipmentCreate.body.data?.id;
    ensure(Boolean(shipmentId), 'Shipment ID missing after create');

    const shipmentValidTransition = await request<{ status: string }>(baseUrl, `/api/v1/shipments/${shipmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'in_transit' }),
    });
    ensure(
      shipmentValidTransition.status === 200 && shipmentValidTransition.body.success,
      'Valid shipment status transition failed',
    );

    const shipmentInvalidTransition = await request(baseUrl, `/api/v1/shipments/${shipmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'created' }),
    });
    ensure(shipmentInvalidTransition.status === 400, 'Invalid shipment transition was not rejected');

    const vehiclesResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/vehicles');
    const driversResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/drivers');
    const vehicleId = vehiclesResp.body.data?.[0]?.id;
    const driverId = driversResp.body.data?.[0]?.id;

    const manifestCreate = await request<{ id: string }>(baseUrl, '/api/v1/manifests', {
      method: 'POST',
      body: JSON.stringify({
        manifestNo: `MAN-SMOKE-${Date.now()}`,
        branchId,
        vehicleId,
        driverId,
        status: 'created',
        shipmentIds: [shipmentId],
      }),
    });
    ensure(manifestCreate.status === 201 && manifestCreate.body.success, 'Manifest create failed');
    const manifestId = manifestCreate.body.data?.id;
    ensure(Boolean(manifestId), 'Manifest ID missing after create');

    const manifestValidTransition = await request(baseUrl, `/api/v1/manifests/${manifestId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'dispatched' }),
    });
    ensure(manifestValidTransition.status === 200, 'Valid manifest transition failed');

    const manifestInvalidTransition = await request(baseUrl, `/api/v1/manifests/${manifestId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'created' }),
    });
    ensure(manifestInvalidTransition.status === 400, 'Invalid manifest transition was not rejected');

    const deliveryCreate = await request<{ id: string }>(baseUrl, '/api/v1/deliveries', {
      method: 'POST',
      body: JSON.stringify({
        deliveryNo: `DEL-SMOKE-${Date.now()}`,
        shipmentId,
        status: 'pending',
        recipientName: 'Smoke Recipient',
        originalAmount: 100,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(deliveryCreate.status === 201 && deliveryCreate.body.success, 'Delivery create failed');
    const deliveryId = deliveryCreate.body.data?.id;
    ensure(Boolean(deliveryId), 'Delivery ID missing after create');

    const deliveryValidTransition = await request(baseUrl, `/api/v1/deliveries/${deliveryId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'delivered' }),
    });
    ensure(deliveryValidTransition.status === 200, 'Valid delivery transition failed');

    const deliveryInvalidTransition = await request(baseUrl, `/api/v1/deliveries/${deliveryId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'failed' }),
    });
    ensure(deliveryInvalidTransition.status === 400, 'Invalid delivery transition was not rejected');

    console.info('[PHASE2.1 SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runSmoke().catch(async (error) => {
  console.error('[PHASE2.1 SMOKE] Failed:', error);
  await pool.end();
  process.exit(1);
});
