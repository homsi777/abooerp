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

async function runPrinterSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const adminUser = await pool.query<{ id: string; company_id: string; branch_id: string | null }>(
      `select id, company_id, branch_id from users where username = 'admin' limit 1`
    );
    ensure(Boolean(adminUser.rowCount), 'Admin user not found');
    const adminUserId = adminUser.rows[0].id;
    const companyId = adminUser.rows[0].company_id;
    const branchId = adminUser.rows[0].branch_id;
    ensure(Boolean(branchId), 'Admin user has no active branch');

    const branchCreate = await request<{ id: string }>(baseUrl, '/api/v1/branches', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        code: `BR-C6-${Date.now()}`,
        name: 'Printer Smoke Branch',
        city: 'Smoke',
        is_active: true,
      }),
    });
    ensure(branchCreate.status === 201 && branchCreate.body.success, 'Failed creating branch override scope');
    const overrideBranchId = branchCreate.body.data?.id;
    ensure(Boolean(overrideBranchId), 'Missing override branch id');

    await pool.query(
      `
      insert into user_branches(user_id, branch_id)
      values($1, $2), ($1, $3)
      on conflict do nothing
      `,
      [adminUserId, branchId, overrideBranchId]
    );

    const createPrinter = await request<{ id: string; name: string }>(baseUrl, '/api/v1/printers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        code: `PRN-C6-${Date.now()}`,
        name: 'C6 Base A4 Printer',
        printer_type: 'a4',
        connection_type: 'network',
        target: '192.168.10.44',
        is_default: true,
      }),
    });
    ensure(createPrinter.status === 201 && createPrinter.body.success, 'Failed create printer');
    const basePrinterId = createPrinter.body.data?.id;
    ensure(Boolean(basePrinterId), 'Missing created printer id');

    const updatePrinter = await request<{ name: string }>(baseUrl, `/api/v1/printers/${basePrinterId}`, {
      method: 'PUT',
      auth: { userId: adminUserId },
      body: JSON.stringify({ name: 'C6 Updated A4 Printer' }),
    });
    ensure(updatePrinter.status === 200 && updatePrinter.body.success, 'Failed update printer');
    ensure(updatePrinter.body.data?.name === 'C6 Updated A4 Printer', 'Printer name update mismatch');

    const createFallbackRoute = await request<{ id: string }>(baseUrl, '/api/v1/printer-routes', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        document_type: 'delivery_note',
        printer_id: basePrinterId,
        copies: 1,
        is_default: true,
        is_active: true,
      }),
    });
    ensure(createFallbackRoute.status === 201 && createFallbackRoute.body.success, 'Failed create fallback route');

    const createOverridePrinter = await request<{ id: string }>(baseUrl, '/api/v1/printers', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        branch_id: overrideBranchId,
        code: `PRN-C6-BR-${Date.now()}`,
        name: 'C6 Branch Thermal',
        printer_type: 'label',
        connection_type: 'network',
        target: '192.168.10.99:9100',
        is_default: true,
      }),
    });
    ensure(createOverridePrinter.status === 201 && createOverridePrinter.body.success, 'Failed create branch printer');
    const overridePrinterId = createOverridePrinter.body.data?.id;
    ensure(Boolean(overridePrinterId), 'Missing override printer id');

    const createOverrideRoute = await request<{ id: string }>(baseUrl, '/api/v1/printer-routes', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        branch_id: overrideBranchId,
        document_type: 'shipment_label',
        printer_id: overridePrinterId,
        copies: 2,
        is_default: true,
        is_active: true,
      }),
    });
    ensure(createOverrideRoute.status === 201 && createOverrideRoute.body.success, 'Failed create branch override route');

    const resolveOverride = await request<{ printer_id: string; route_scope: string }>(
      baseUrl,
      `/api/v1/printer-routes/resolve?documentType=shipment_label&branchId=${overrideBranchId}`,
      { auth: { userId: adminUserId } }
    );
    ensure(resolveOverride.status === 200 && resolveOverride.body.success, 'Failed resolve override route');
    ensure(resolveOverride.body.data?.printer_id === overridePrinterId, 'Branch override did not win route resolution');
    ensure(resolveOverride.body.data?.route_scope === 'branch', 'Resolved route scope should be branch');

    const resolveFallback = await request<{ printer_id: string; route_scope: string }>(
      baseUrl,
      `/api/v1/printer-routes/resolve?documentType=delivery_note&branchId=${branchId}`,
      { auth: { userId: adminUserId } }
    );
    ensure(resolveFallback.status === 200 && resolveFallback.body.success, 'Failed resolve fallback route');
    ensure(resolveFallback.body.data?.printer_id === basePrinterId, 'Company fallback route not resolved');
    ensure(resolveFallback.body.data?.route_scope === 'company', 'Resolved fallback scope should be company');

    const deactivateOverridePrinter = await request(baseUrl, `/api/v1/printers/${overridePrinterId}`, {
      method: 'DELETE',
      auth: { userId: adminUserId },
    });
    ensure(deactivateOverridePrinter.status === 200 && deactivateOverridePrinter.body.success, 'Failed deactivate printer');

    const routeWithInactivePrinter = await request(baseUrl, '/api/v1/printer-routes', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        branch_id: overrideBranchId,
        document_type: 'receipt_voucher',
        printer_id: overridePrinterId,
        copies: 1,
        is_default: true,
      }),
    });
    ensure(routeWithInactivePrinter.status === 400, 'Inactive printer should be rejected for route creation');

    const viewerRole = await pool.query<{ id: string }>(`select id from roles where code = 'viewer' limit 1`);
    ensure(Boolean(viewerRole.rowCount), 'Missing viewer role');
    const viewerInsert = await pool.query<{ id: string }>(
      `
      insert into users(username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, status, is_active)
      values($1, $2, $3, $4, $5, $6, 'viewer', $7, $8, 'active', true)
      returning id
      `,
      [
        `viewer_c6_${Date.now()}`,
        'C6 Viewer',
        `viewer_c6_${Date.now()}@local.erp`,
        `+963${Math.floor(100000000 + Math.random() * 899999999)}`,
        'seed_hash_placeholder',
        viewerRole.rows[0].id,
        companyId,
        branchId,
      ]
    );
    const viewerId = viewerInsert.rows[0].id;
    await pool.query(
      `
      insert into user_branches(user_id, branch_id)
      values($1, $2)
      on conflict do nothing
      `,
      [viewerId, branchId]
    );

    const viewerWriteDenied = await request(baseUrl, '/api/v1/printers', {
      method: 'POST',
      auth: { userId: viewerId },
      body: JSON.stringify({
        code: `PRN-VIEW-${Date.now()}`,
        name: 'Viewer denied printer',
        printer_type: 'receipt',
        connection_type: 'local',
        target: 'Viewer Printer',
      }),
    });
    ensure(viewerWriteDenied.status === 403, 'Viewer should not have settings.printers.write');

    console.info('[PHASE C6 PRINTER SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runPrinterSmoke().catch((error) => {
  console.error('[PHASE C6 PRINTER SMOKE] Failed:', error);
  process.exit(1);
});
