import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { auth?: { userId?: string }; scope?: { branchId?: string } }
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init?.auth?.userId) headers['x-user-id'] = init.auth.userId;
  if (init?.scope?.branchId) headers['x-branch-id'] = init.scope.branchId;

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

async function runBackupSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const adminRow = await pool.query<{ id: string; company_id: string; branch_id: string | null }>(
      `select id, company_id, branch_id from users where username = 'admin' limit 1`
    );
    ensure(Boolean(adminRow.rowCount), 'Admin user missing');
    const adminId = adminRow.rows[0].id;
    const adminCompanyId = adminRow.rows[0].company_id;
    const adminBranchId = adminRow.rows[0].branch_id;
    ensure(Boolean(adminBranchId), 'Admin branch missing');

    const createdBackup = await request<{ id: string; backup_code: string; status: string }>(baseUrl, '/api/v1/backups', {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({
        backupType: 'manual',
        scope: 'company',
        notes: 'phase c7 smoke backup',
      }),
    });
    ensure(createdBackup.status === 201 && createdBackup.body.success, 'Backup creation failed');
    const backupId = createdBackup.body.data?.id;
    const backupCode = createdBackup.body.data?.backup_code;
    ensure(Boolean(backupId && backupCode), 'Missing backup identifiers');

    const listBackups = await request<Array<{ id: string; company_id: string }>>(baseUrl, '/api/v1/backups', {
      auth: { userId: adminId },
    });
    ensure(listBackups.status === 200 && listBackups.body.success, 'Backup listing failed');
    const listed = listBackups.body.data?.find((row) => row.id === backupId);
    ensure(Boolean(listed), 'Created backup not found in list');
    ensure(listed?.company_id === adminCompanyId, 'Backup company scoping mismatch');

    const verifyBackup = await request<{ id: string; status: string }>(baseUrl, `/api/v1/backups/${backupId}/verify`, {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({}),
    });
    ensure(verifyBackup.status === 200 && verifyBackup.body.success, 'Backup verify failed');

    const restoreRejected = await request(baseUrl, `/api/v1/backups/${backupId}/restore`, {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({
        confirmBackupCode: 'INVALID-CODE',
        dryRun: true,
      }),
    });
    ensure(restoreRejected.status === 400, 'Restore safety validation should reject invalid confirm code');

    const restoreDryRun = await request<{ restored: { id: string; status: string } }>(
      baseUrl,
      `/api/v1/backups/${backupId}/restore`,
      {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({
        confirmBackupCode: backupCode,
        dryRun: true,
      }),
    });
    ensure(restoreDryRun.status === 200 && restoreDryRun.body.success, 'Dry run restore should succeed');
    ensure(restoreDryRun.body.data?.restored.status === 'restored', 'Dry run restore should set restored status');

    const blockedWithoutMaintenance = await request(baseUrl, `/api/v1/backups/${backupId}/restore`, {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({
        confirmBackupCode: backupCode,
        dryRun: false,
      }),
    });
    ensure(blockedWithoutMaintenance.status === 409, 'Real restore must be blocked when safety controls fail');

    const readinessBefore = await request<{ ready: boolean; blockers: Array<{ code: string }> }>(
      baseUrl,
      `/api/v1/backups/${backupId}/restore-readiness`,
      { auth: { userId: adminId } }
    );
    ensure(readinessBefore.status === 200 && readinessBefore.body.success, 'Restore readiness endpoint failed');
    ensure(
      readinessBefore.body.data?.blockers.some((b) => b.code === 'maintenance_mode_required') === true,
      'Maintenance-mode blocker should be reported'
    );

    await request(baseUrl, '/api/v1/system-settings/runtime.maintenanceMode', {
      method: 'PUT',
      auth: { userId: adminId },
      body: JSON.stringify({ value: true }),
    });

    const restoreToken = await request<{ token: string }>(baseUrl, `/api/v1/backups/${backupId}/restore-token`, {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({}),
    });
    ensure(restoreToken.status === 200 && restoreToken.body.success, 'Restore token issuance failed');
    ensure(Boolean(restoreToken.body.data?.token), 'Missing execution token');

    const blockedWithSessionsOrOps = await request(baseUrl, `/api/v1/backups/${backupId}/restore`, {
      method: 'POST',
      auth: { userId: adminId },
      body: JSON.stringify({
        confirmBackupCode: backupCode,
        dryRun: false,
        executionToken: restoreToken.body.data?.token,
      }),
    });
    ensure(blockedWithSessionsOrOps.status === 409, 'Real restore should remain blocked by active runtime operations');

    const diagnostics = await request<{ latestBackupCode: string | null; restoreReadiness: { ready: boolean } }>(
      baseUrl,
      '/api/v1/backup/diagnostics',
      {
      auth: { userId: adminId },
    });
    ensure(diagnostics.status === 200 && diagnostics.body.success, 'Backup diagnostics failed');
    ensure(diagnostics.body.data?.latestBackupCode === backupCode, 'Diagnostics latest backup mismatch');
    ensure(diagnostics.body.data?.restoreReadiness.ready === false, 'Diagnostics should expose blocked restore readiness');

    const policyUpdate = await request<{ retentionDays: number }>(baseUrl, '/api/v1/backup-policy', {
      method: 'PUT',
      auth: { userId: adminId },
      body: JSON.stringify({
        autoEnabled: true,
        intervalHours: 24,
        retentionDays: 45,
        verifyAfterCreate: true,
      }),
    });
    ensure(policyUpdate.status === 200 && policyUpdate.body.success, 'Policy update failed');
    ensure(policyUpdate.body.data?.retentionDays === 45, 'Policy retention days not updated');

    const viewerRole = await pool.query<{ id: string }>(`select id from roles where code = 'viewer' limit 1`);
    ensure(Boolean(viewerRole.rowCount), 'Viewer role missing');

    const viewerInsert = await pool.query<{ id: string }>(
      `
      insert into users(username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, status, is_active)
      values($1, $2, $3, $4, $5, $6, 'viewer', $7, $8, 'active', true)
      returning id
      `,
      [
        `viewer_c7_${Date.now()}`,
        'C7 Viewer',
        `viewer_c7_${Date.now()}@local.erp`,
        `+963${Math.floor(100000000 + Math.random() * 899999999)}`,
        'seed_hash_placeholder',
        viewerRole.rows[0].id,
        adminCompanyId,
        adminBranchId,
      ]
    );
    const viewerId = viewerInsert.rows[0].id;
    await pool.query(
      `
      insert into user_branches(user_id, branch_id)
      values($1, $2)
      on conflict do nothing
      `,
      [viewerId, adminBranchId]
    );

    const viewerDeniedWrite = await request(baseUrl, '/api/v1/backups', {
      method: 'POST',
      auth: { userId: viewerId },
      body: JSON.stringify({
        backupType: 'manual',
        scope: 'company',
      }),
    });
    ensure(viewerDeniedWrite.status === 403, 'Viewer should not be allowed to create backups');

    console.info('[PHASE C7 BACKUP SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runBackupSmoke().catch((error) => {
  console.error('[PHASE C7 BACKUP SMOKE] Failed:', error);
  process.exit(1);
});
