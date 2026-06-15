/**
 * Backfill script: updates effective_date on shipments and posted_at on
 * party_financial_movements from the daily_ledger_sessions.ledger_date.
 *
 * Safe to run multiple times (idempotent). Only touches rows where
 * effective_date IS NULL or posted_at doesn't match the ledger date.
 *
 * Usage:
 *   npx tsx server/src/scripts/backfillEffectiveDate.ts
 */
import dotenv from 'dotenv';
import { pool } from '../db/pool.js';
dotenv.config();
async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 1. Backfill shipments.effective_date from ledger sessions
        const shipResult = await client.query(`
      UPDATE shipments s
      SET effective_date = ls.ledger_date
      FROM daily_ledger_rows dlr
      JOIN daily_ledger_sessions ls ON ls.id = dlr.session_id
      WHERE dlr.posted_shipment_id = s.id
        AND dlr.deleted_at IS NULL
        AND ls.deleted_at IS NULL
        AND s.effective_date IS NULL
    `);
        console.log(`[1/3] Updated effective_date on ${shipResult.rowCount} shipments from ledger_date.`);
        // 2. For shipments NOT linked to any ledger row, set effective_date = created_at::date
        const defaultResult = await client.query(`
      UPDATE shipments
      SET effective_date = created_at::date
      WHERE effective_date IS NULL
        AND deleted_at IS NULL
    `);
        console.log(`[2/3] Defaulted effective_date to created_at for ${defaultResult.rowCount} shipments.`);
        // 3. Update posted_at on party_financial_movements to match effective_date
        const movResult = await client.query(`
      UPDATE party_financial_movements pfm
      SET posted_at = s.effective_date::timestamptz
      FROM shipments s
      WHERE pfm.shipment_id = s.id
        AND s.effective_date IS NOT NULL
        AND pfm.posted_at::date != s.effective_date
        AND pfm.is_reversal = false
    `);
        console.log(`[3/3] Corrected posted_at on ${movResult.rowCount} financial movements.`);
        await client.query('COMMIT');
        console.log('Backfill complete.');
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('Backfill failed, rolled back:', err);
        process.exit(1);
    }
    finally {
        client.release();
        await pool.end();
    }
}
main();
