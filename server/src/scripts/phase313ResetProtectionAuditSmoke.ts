import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

type DashboardCacheMetrics = {
  ttlMs: number;
  resetControl: {
    enabled: boolean;
    requireConfirm: boolean;
  };
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

type ResetAuditPayload = {
  total: number;
  entries: Array<{
    outcome: 'success' | 'blocked';
    reason?: string;
    confirm: boolean;
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
  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    body = { success: false, error: 'Invalid JSON response' };
  }
  return { status: response.status, body };
}

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runPhase313ResetProtectionAuditSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const admin = await pool.query<{ id: string }>(
      `select id from users where username = 'admin' limit 1`,
    );
    ensure(Boolean(admin.rowCount), 'Admin missing');
    const adminUserId = admin.rows[0].id;

    const metricsRes = await request<DashboardCacheMetrics>(
      baseUrl,
      '/api/v1/party-statements/dashboard-cache-metrics',
      { auth: { userId: adminUserId } },
    );
    ensure(metricsRes.status === 200 && metricsRes.body.success, 'Cannot read dashboard cache metrics');
    const metrics = metricsRes.body.data!;

    if (!metrics.resetControl.enabled) {
      const resetDisabledRes = await request(
        baseUrl,
        '/api/v1/party-statements/dashboard-cache-reset',
        {
          method: 'POST',
          auth: { userId: adminUserId },
          body: JSON.stringify({ resetCache: true, resetMetrics: true, confirm: true }),
        },
      );
      ensure(resetDisabledRes.status === 403, 'Reset should be blocked when reset control is disabled');
    } else if (metrics.resetControl.requireConfirm) {
      const withoutConfirm = await request(
        baseUrl,
        '/api/v1/party-statements/dashboard-cache-reset',
        {
          method: 'POST',
          auth: { userId: adminUserId },
          body: JSON.stringify({ resetCache: true, resetMetrics: false, confirm: false }),
        },
      );
      ensure(withoutConfirm.status === 403, 'Reset should require confirm=true in protected mode');

      const withConfirm = await request(
        baseUrl,
        '/api/v1/party-statements/dashboard-cache-reset',
        {
          method: 'POST',
          auth: { userId: adminUserId },
          body: JSON.stringify({ resetCache: true, resetMetrics: true, confirm: true }),
        },
      );
      ensure(withConfirm.status === 200 && withConfirm.body.success, 'Reset with confirm=true should pass in protected mode');
    } else {
      const resetRes = await request(
        baseUrl,
        '/api/v1/party-statements/dashboard-cache-reset',
        {
          method: 'POST',
          auth: { userId: adminUserId },
          body: JSON.stringify({ resetCache: true, resetMetrics: true }),
        },
      );
      ensure(resetRes.status === 200 && resetRes.body.success, 'Reset should pass when protection confirm is disabled');
    }

    const auditRes = await request<ResetAuditPayload>(
      baseUrl,
      '/api/v1/party-statements/dashboard-cache-reset-audit?limit=5',
      { auth: { userId: adminUserId } },
    );
    ensure(auditRes.status === 200 && auditRes.body.success, 'Cannot fetch reset audit');
    const audit = auditRes.body.data!;
    ensure(audit.total >= 1, 'Reset audit should contain at least one entry');
    ensure((audit.entries || []).length >= 1, 'Reset audit entries missing');

    if (metrics.resetControl.requireConfirm && metrics.resetControl.enabled) {
      ensure(audit.entries.some((entry) => entry.outcome === 'blocked' && entry.reason === 'confirmation_required'), 'Audit should contain blocked confirmation-required entry');
      ensure(audit.entries.some((entry) => entry.outcome === 'success' && entry.confirm === true), 'Audit should contain successful confirmed reset entry');
    }

    console.info('[PHASE3.13 RESET PROTECTION AUDIT SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPhase313ResetProtectionAuditSmoke().catch((error) => {
  console.error('[PHASE3.13 RESET PROTECTION AUDIT SMOKE] Failed:', error);
  process.exit(1);
});
