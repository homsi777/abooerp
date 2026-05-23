import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type DashboardCacheMetrics = {
  ttlMs: number;
  cacheEntries: number;
  inFlightEntries: number;
  counters: {
    hits: number;
    misses: number;
    inFlightHits: number;
    sets: number;
    invalidations: number;
    evictions: number;
  };
};

type DashboardCacheResetResult = {
  resetCache: boolean;
  resetMetrics: boolean;
  before: DashboardCacheMetrics;
  after: DashboardCacheMetrics;
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

async function runPhase312CacheControlSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const admin = await pool.query<{ id: string }>(
      `select id from users where username = 'admin' limit 1`,
    );
    ensure(Boolean(admin.rowCount), 'Admin missing');
    const adminUserId = admin.rows[0].id;

    const partySeed = await request<{ id: string }>(baseUrl, '/api/v1/senders-receivers', {
      method: 'POST',
      body: JSON.stringify({
        code: `P312-SR-${Date.now()}`,
        full_name: `Phase312 Party ${Date.now()}`,
        type: 'both',
        status: 'active',
      }),
    });
    ensure(partySeed.status === 201 && partySeed.body.success, 'Cannot create isolated party');
    const partyId = partySeed.body.data?.id;
    ensure(Boolean(partyId), 'Isolated party id missing');

    const now = Date.now();
    const fromAt = new Date(now - 5 * 60 * 1000).toISOString();
    const toAt = new Date(now + 60 * 1000).toISOString();
    const comparisonFromAt = new Date(now - 10 * 60 * 1000).toISOString();
    const comparisonToAt = new Date(now - 6 * 60 * 1000).toISOString();
    const packagePath =
      `/api/v1/party-statements/dashboard-package?partyType=sender_receiver&partyId=${partyId}` +
      `&fromAt=${encodeURIComponent(fromAt)}&toAt=${encodeURIComponent(toAt)}` +
      `&tabs=statement,comparison,analytics&comparisonFromAt=${encodeURIComponent(comparisonFromAt)}&comparisonToAt=${encodeURIComponent(comparisonToAt)}`;

    const warm1 = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
    ensure(warm1.status === 200 && warm1.body.success, 'First dashboard package read failed');

    const warm2 = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
    ensure(warm2.status === 200 && warm2.body.success, 'Second dashboard package read failed');

    const metricsBeforeReset = await request<DashboardCacheMetrics>(
      baseUrl,
      '/api/v1/party-statements/dashboard-cache-metrics',
      { auth: { userId: adminUserId } },
    );
    ensure(metricsBeforeReset.status === 200 && metricsBeforeReset.body.success, 'Cannot fetch cache metrics before reset');
    const before = metricsBeforeReset.body.data!;
    ensure(before.ttlMs >= 1000, 'TTL should be configured and >= 1000ms');
    ensure(before.counters.hits >= 1, 'Expected at least one cache hit before reset');

    const resetRes = await request<DashboardCacheResetResult>(
      baseUrl,
      '/api/v1/party-statements/dashboard-cache-reset',
      {
        method: 'POST',
        auth: { userId: adminUserId },
        body: JSON.stringify({ resetCache: true, resetMetrics: true }),
      },
    );
    ensure(resetRes.status === 200 && resetRes.body.success, 'Cache reset endpoint failed');
    const resetPayload = resetRes.body.data!;
    ensure(resetPayload.after.cacheEntries === 0, 'Cache entries should be zero after reset');
    ensure(resetPayload.after.counters.hits === 0, 'Hits counter should reset to zero');
    ensure(resetPayload.after.counters.misses === 0, 'Misses counter should reset to zero');

    const afterResetRead = await request(baseUrl, packagePath, { auth: { userId: adminUserId } });
    ensure(afterResetRead.status === 200 && afterResetRead.body.success, 'Dashboard package read failed after reset');

    const metricsAfterResetRead = await request<DashboardCacheMetrics>(
      baseUrl,
      '/api/v1/party-statements/dashboard-cache-metrics',
      { auth: { userId: adminUserId } },
    );
    ensure(metricsAfterResetRead.status === 200 && metricsAfterResetRead.body.success, 'Cannot fetch cache metrics after reset read');
    const after = metricsAfterResetRead.body.data!;
    ensure(after.counters.misses >= 1, 'Expected miss after reset and first read');
    ensure(after.counters.sets >= 1, 'Expected set after reset and first read');

    console.info('[PHASE3.12 CACHE CONTROL SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase312CacheControlSmoke().catch((error) => {
  console.error('[PHASE3.12 CACHE CONTROL SMOKE] Failed:', error);
  process.exit(1);
});
