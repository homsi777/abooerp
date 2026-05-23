import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { pool, testDatabaseConnection } from '../db/pool.js';

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & {
    auth?: { userId?: string };
    scope?: { branchId?: string; agentId?: string };
    idempotencyKey?: string;
  },
): Promise<{ status: number; body: ApiResponse<T> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (init?.auth?.userId) headers['x-user-id'] = init.auth.userId;
  if (init?.scope?.branchId) headers['x-branch-id'] = init.scope.branchId;
  if (init?.scope?.agentId) headers['x-agent-id'] = init.scope.agentId;
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

async function runAuthScopeSmoke() {
  await testDatabaseConnection();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const adminUser = await pool.query<{ id: string; branch_id: string | null }>(
      `select id, branch_id from users where username = 'admin' limit 1`,
    );
    ensure(Boolean(adminUser.rowCount), 'Missing admin user');
    const adminUserId = adminUser.rows[0].id;
    const adminBranchId = adminUser.rows[0].branch_id;
    ensure(Boolean(adminBranchId), 'Admin has no branch scope');

    const branchResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/branches', {
      auth: { userId: adminUserId },
    });
    ensure(branchResp.status === 200 && branchResp.body.success, 'Cannot list branches');
    const branchA = branchResp.body.data?.[0]?.id;
    ensure(Boolean(branchA), 'Missing branch A');

    const branchBCreate = await request<{ id: string }>(baseUrl, '/api/v1/branches', {
      method: 'POST',
      auth: { userId: adminUserId },
      body: JSON.stringify({
        code: `BR-AUTH-${Date.now()}`,
        name: 'Auth Scope Branch',
        city: 'Auth',
        address: 'Auth Scope Address',
        phone: '+963-000',
        is_active: true,
      }),
    });
    ensure(branchBCreate.status === 201 && branchBCreate.body.success, 'Cannot create branch B');
    const branchB = branchBCreate.body.data?.id;
    ensure(Boolean(branchB), 'Missing branch B');

    await pool.query(
      `insert into user_branches(user_id, branch_id) values($1, $2) on conflict (user_id, branch_id) do nothing`,
      [adminUserId, branchB],
    );

    const srResp = await request<Array<{ id: string }>>(baseUrl, '/api/v1/senders-receivers', {
      auth: { userId: adminUserId },
    });
    ensure(srResp.status === 200 && srResp.body.success, 'Cannot list senders/receivers');
    const senderId = srResp.body.data?.[0]?.id;
    const receiverId = srResp.body.data?.[1]?.id || srResp.body.data?.[0]?.id;
    ensure(Boolean(senderId && receiverId), 'Missing sender/receiver');

    const roleQuery = await pool.query<{ id: string }>(`select id from roles where code = 'operator' limit 1`);
    ensure(Boolean(roleQuery.rowCount), 'Missing operator role');
    const operatorRoleId = roleQuery.rows[0].id;

    const scopedUserInsert = await pool.query<{ id: string }>(
      `
      insert into users(username, full_name, email, phone, password_hash, role_id, role, company_id, branch_id, status)
      select $1, $2, $3, $4, $5, r.id, r.code, b.company_id, $6, 'active'
      from roles r
      join branches b on b.id = $6
      where r.id = $7
      on conflict (username) do update
      set branch_id = excluded.branch_id, role_id = excluded.role_id, role = excluded.role, company_id = excluded.company_id, status = 'active'
      returning id
      `,
      [
        `scope_user_${Date.now()}`,
        'Scope User',
        `scope_${Date.now()}@local.erp`,
        `+963${Math.floor(Math.random() * 900000 + 100000)}`,
        'seed_hash_placeholder',
        branchB,
        operatorRoleId,
      ],
    );
    const scopedUserId = scopedUserInsert.rows[0].id;

    await pool.query(
      `insert into user_branches(user_id, branch_id) values($1, $2) on conflict (user_id, branch_id) do nothing`,
      [scopedUserId, branchB],
    );

    const ts = Date.now();
    const shipmentInAdminBranch = await request<{ id: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      auth: { userId: adminUserId },
      scope: { branchId: adminBranchId! },
      idempotencyKey: `phase23-shipment-a-${ts}`,
      body: JSON.stringify({
        shipmentNo: `SHP-AUTH-A-${ts}`,
        senderId,
        receiverId,
        branchId: adminBranchId,
        destinationCity: 'Auth A',
        piecesCount: 1,
        status: 'created',
        originalAmount: 20,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(shipmentInAdminBranch.status === 201, 'Failed to create shipment in admin branch');
    const shipmentAId = shipmentInAdminBranch.body.data?.id;

    const shipmentInScopeUserBranch = await request<{ id: string }>(baseUrl, '/api/v1/shipments', {
      method: 'POST',
      auth: { userId: adminUserId },
      scope: { branchId: branchB! },
      idempotencyKey: `phase23-shipment-b-${ts}`,
      body: JSON.stringify({
        shipmentNo: `SHP-AUTH-B-${ts + 1}`,
        senderId,
        receiverId,
        branchId: branchB,
        destinationCity: 'Auth B',
        piecesCount: 1,
        status: 'created',
        originalAmount: 22,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
      }),
    });
    ensure(shipmentInScopeUserBranch.status === 201, 'Failed to create shipment in branch B');
    const shipmentBId = shipmentInScopeUserBranch.body.data?.id;

    const scopedList = await request<Array<{ id: string }>>(baseUrl, '/api/v1/shipments', {
      auth: { userId: scopedUserId },
    });
    ensure(scopedList.status === 200 && scopedList.body.success, 'Scoped user list failed');
    ensure(scopedList.body.data?.some((s) => s.id === shipmentBId) === true, 'Scoped user missing own branch shipment');
    ensure(scopedList.body.data?.some((s) => s.id === shipmentAId) === false, 'Scoped user leaked other branch shipment');

    const scopedListWithManualOverrideAttempt = await request<Array<{ id: string }>>(baseUrl, '/api/v1/shipments', {
      auth: { userId: scopedUserId },
      scope: { branchId: adminBranchId! },
    });
    ensure(
      scopedListWithManualOverrideAttempt.status === 403,
      'Scoped user should be rejected when x-branch-id targets a branch they are not allowed to access',
    );

    const unknownUserResp = await request(baseUrl, '/api/v1/shipments', {
      auth: { userId: '11111111-1111-4111-8111-111111111111' },
    });
    ensure(unknownUserResp.status === 401, 'Unknown user id did not return 401');

    console.info('[PHASE2.3 AUTH SCOPE SMOKE] All checks passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runAuthScopeSmoke().catch(async (error) => {
  console.error('[PHASE2.3 AUTH SCOPE SMOKE] Failed:', error);
  process.exit(1);
});
