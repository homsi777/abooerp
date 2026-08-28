import { pool } from '../db/pool.js';

type CleanupTarget = {
  table: 'audit_logs' | 'sync_operation_results' | 'sync_change_feed';
  eligible: number;
  preserved: string;
  cutoff: string | null;
};

const policy = {
  // Only technical noise is eligible. Financial, shipment, ledger, access and
  // security evidence are deliberately excluded from all deletion predicates.
  technicalAuditDays: readPositiveInt('RETENTION_TECHNICAL_AUDIT_DAYS', 180),
  failedShipmentAuditDays: readPositiveInt('RETENTION_FAILED_SHIPMENT_AUDIT_DAYS', 90),
  operationResultDays: readPositiveInt('RETENTION_OPERATION_RESULT_DAYS', 90),
  changeFeedDays: readPositiveInt('RETENTION_CHANGE_FEED_DAYS', 90),
  batchSize: readPositiveInt('RETENTION_BATCH_SIZE', 500),
};

function readPositiveInt(name: string, fallback: number) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) throw new Error(`${name} must be an integer between 1 and 3650`);
  return parsed;
}

function hasFlag(flag: string) { return process.argv.includes(flag); }

async function count(sql: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function inspect(): Promise<CleanupTarget[]> {
  const technicalCutoff = new Date(Date.now() - policy.technicalAuditDays * 86_400_000).toISOString();
  const failedShipmentCutoff = new Date(Date.now() - policy.failedShipmentAuditDays * 86_400_000).toISOString();
  const operationCutoff = new Date(Date.now() - policy.operationResultDays * 86_400_000).toISOString();
  const feedCutoff = new Date(Date.now() - policy.changeFeedDays * 86_400_000).toISOString();
  const auditEligible = await count(
    `select count(*)::text count from audit_logs
      where (action in ('TOKEN_REFRESH','SESSION_EXPIRED','LOGOUT') and created_at < $1)
         or (action='SHIPMENT_UPDATE_FAILED' and created_at < $2)`,
    [technicalCutoff, failedShipmentCutoff],
  );
  const operationEligible = await count(
    `select count(*)::text count from sync_operation_results
      where completed_at < $1
        and result_status in ('ACCEPTED','ALREADY_APPLIED','VALIDATION_REJECTED','PERMISSION_REJECTED','DEVICE_REVOKED')`,
    [operationCutoff],
  );
  const watermark = await pool.query<{ active_devices: string; min_cursor: string | null }>(
    `select count(*)::text active_devices, min(last_central_cursor)::text min_cursor
       from linked_devices where sync_state='active' and is_blocked=false`,
  );
  const activeDevices = Number(watermark.rows[0]?.active_devices ?? 0);
  const minCursor = Number(watermark.rows[0]?.min_cursor ?? 0);
  // A zero acknowledgement means an active device may need the entire feed.
  const feedEligible = activeDevices > 0 && minCursor > 0
    ? await count(`select count(*)::text count from sync_change_feed where cursor_id <= $1 and created_at < $2`, [minCursor, feedCutoff])
    : 0;
  return [
    { table: 'audit_logs', eligible: auditEligible, cutoff: failedShipmentCutoff, preserved: 'All accounting, business, security, ledger-row, shipment-success and access audit records.' },
    { table: 'sync_operation_results', eligible: operationEligible, cutoff: operationCutoff, preserved: 'PROCESSING, CONFLICT and CENTRAL_PROCESSING_FAILED records; all results newer than the configured window.' },
    { table: 'sync_change_feed', eligible: feedEligible, cutoff: feedCutoff, preserved: activeDevices > 0 && minCursor === 0 ? 'All rows: at least one active device has not acknowledged any cursor.' : `Rows above active-device watermark ${minCursor}.` },
  ];
}

async function deleteInBatches(target: CleanupTarget) {
  if (!target.eligible) return 0;
  let removed = 0;
  for (;;) {
    let result;
    if (target.table === 'audit_logs') result = await pool.query(
      `delete from audit_logs where id in (select id from audit_logs where (action in ('TOKEN_REFRESH','SESSION_EXPIRED','LOGOUT') and created_at < now()-($1::text||' days')::interval) or (action='SHIPMENT_UPDATE_FAILED' and created_at < now()-($2::text||' days')::interval) order by created_at limit $3)`,
      [policy.technicalAuditDays, policy.failedShipmentAuditDays, policy.batchSize],
    );
    else if (target.table === 'sync_operation_results') result = await pool.query(
      `delete from sync_operation_results where id in (select id from sync_operation_results where completed_at < now()-($1::text||' days')::interval and result_status in ('ACCEPTED','ALREADY_APPLIED','VALIDATION_REJECTED','PERMISSION_REJECTED','DEVICE_REVOKED') order by completed_at limit $2)`,
      [policy.operationResultDays, policy.batchSize],
    );
    else break; // feed cleanup is intentionally manual after reviewing device watermarks.
    removed += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < policy.batchSize) break;
  }
  return removed;
}

async function main() {
  const apply = hasFlag('--apply');
  const targets = await inspect();
  const run = await pool.query<{ id: string }>(
    `insert into maintenance_cleanup_runs(dry_run,status,policy,result) values($1,'RUNNING',$2::jsonb,$3::jsonb) returning id`,
    [!apply, JSON.stringify(policy), JSON.stringify({ targets })],
  );
  const runId = run.rows[0].id;
  try {
    const removed: Record<string, number> = {};
    if (apply) for (const target of targets) removed[target.table] = await deleteInBatches(target);
    const result = { runId, mode: apply ? 'apply' : 'dry-run', policy, targets, removed };
    await pool.query(`update maintenance_cleanup_runs set status='COMPLETED',completed_at=now(),result=$2::jsonb where id=$1`, [runId, JSON.stringify(result)]);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await pool.query(`update maintenance_cleanup_runs set status='FAILED',completed_at=now(),error_message=$2 where id=$1`, [runId, error instanceof Error ? error.message : String(error)]);
    throw error;
  } finally { await pool.end(); }
}

void main();
