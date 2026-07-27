/**
 * Smoke: begin dispatch save operation → journal row → finalize → undo → restore location.
 * Requires local DB with at least one company/branch/session/row.
 */
import { pool, testDatabaseConnection } from '../db/pool.js';
import { DailyLedgerDispatchOperationRepository } from '../repositories/dailyLedgerDispatchOperationRepository.js';
import { DailyLedgerDispatchSaveRepository } from '../repositories/dailyLedgerDispatchSaveRepository.js';
import { DailyLedgerDispatchUndoService } from '../services/dailyLedgerDispatchUndoService.js';

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await testDatabaseConnection();

  const ops = new DailyLedgerDispatchOperationRepository();
  const saves = new DailyLedgerDispatchSaveRepository();
  const undo = new DailyLedgerDispatchUndoService();

  const sample = await pool.query<{
    company_id: string;
    branch_id: string;
    session_id: string;
    row_id: string;
    row_no: number;
    ledger_date: string;
    line_label: string;
    dispatch_id: string | null;
  }>(
    `
    select
      s.company_id,
      s.branch_id,
      s.id as session_id,
      r.id as row_id,
      r.row_no,
      s.ledger_date::text as ledger_date,
      s.line_label,
      r.dispatch_id
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null
      and s.deleted_at is null
      and r.loaded_at is null
    order by r.updated_at desc nulls last
    limit 1
    `,
  );

  if (!sample.rows[0]) {
    console.log('dailyLedgerDispatchUndoSmoke: SKIP (no ledger row available)');
    return;
  }

  const row = sample.rows[0];
  const scope = { companyId: row.company_id, branchId: row.branch_id, userId: undefined };

  const before = await pool.query<{
    session_id: string;
    row_no: number;
    dispatch_id: string | null;
    posted_shipment_id: string | null;
  }>(`select session_id, row_no, dispatch_id, posted_shipment_id from daily_ledger_rows where id = $1`, [
    row.row_id,
  ]);
  ensure(Boolean(before.rows[0]), 'row missing before test');

  const operation = await ops.begin(scope, {
    branchId: row.branch_id,
    ledgerDate: row.ledger_date,
    lineLabel: row.line_label || 'smoke',
    saveMode: 'custom',
    existingRowIds: [row.row_id],
    idempotencyKey: `undo-smoke:${row.row_id}:${Date.now()}`,
  });
  ensure(operation.status === 'PROCESSING', 'operation should start PROCESSING');

  await ops.ensureRowForUpsert(scope, operation.id, row.row_id);

  const saveLog = await saves.create(scope, {
    branchId: row.branch_id,
    ledgerDate: row.ledger_date,
    lineLabel: row.line_label || 'smoke',
    saveMode: 'custom',
    rowCount: 1,
    piecesCount: 1,
    postedCount: 0,
    errorCount: 0,
    skippedCount: 0,
    rowIds: [row.row_id],
    outcome: 'success',
    summary: 'undo smoke',
  });

  await ops.finalize(scope, operation.id, {
    saveLogId: saveLog.id,
    status: 'COMPLETED',
    resultSummary: { smoke: true },
  });

  const preview = await undo.preview(scope, saveLog.id);
  ensure(preview.undoable, `expected undoable, got blockers: ${preview.blockers.join(' | ')}`);
  ensure(preview.rowCount === 1, 'expected one journaled row');

  const result = await undo.undo(scope, saveLog.id, { reason: 'smoke undo' });
  ensure(result.restoredRows === 1, 'expected one restored row');

  const after = await pool.query<{
    session_id: string;
    row_no: number;
    dispatch_id: string | null;
    posted_shipment_id: string | null;
  }>(`select session_id, row_no, dispatch_id, posted_shipment_id from daily_ledger_rows where id = $1`, [
    row.row_id,
  ]);
  ensure(after.rows[0].session_id === before.rows[0].session_id, 'session restored');
  ensure(after.rows[0].row_no === before.rows[0].row_no, 'row_no restored');

  const previewAgain = await undo.preview(scope, saveLog.id);
  ensure(!previewAgain.undoable, 'second undo must be blocked');
  ensure(previewAgain.blockers.includes('already_undone') || Boolean(previewAgain.reason), 'already undone');

  let threw = false;
  try {
    await undo.undo(scope, saveLog.id, { reason: 'second' });
  } catch {
    threw = true;
  }
  ensure(threw, 'second undo must throw');

  const orphanLog = await saves.create(scope, {
    branchId: row.branch_id,
    ledgerDate: row.ledger_date,
    lineLabel: row.line_label || 'smoke',
    saveMode: 'all',
    rowCount: 0,
    outcome: 'success',
    summary: 'legacy-like save without operation',
  });
  const legacyPreview = await undo.preview(scope, orphanLog.id);
  ensure(!legacyPreview.undoable, 'legacy save log must not be undoable');
  ensure(legacyPreview.blockers.includes('legacy_save_log'), 'legacy blocker expected');

  console.log('dailyLedgerDispatchUndoSmoke: OK', {
    operationId: operation.id,
    saveLogId: saveLog.id,
    rowId: row.row_id,
  });
}

main()
  .catch((error) => {
    console.error('dailyLedgerDispatchUndoSmoke: FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
