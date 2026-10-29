import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import { pool } from '../db/pool.js';

/**
 * Parcel tracking driven by the QR code on the tablet label.
 *
 * The QR carries the tablet receipt number, which is unique company-wide
 * (sequence starting at 40000 — see migration 137). Agents still working
 * on paper keep their own numbering in receipt_no, and those shipments are
 * deliberately NOT reachable here: lookups match tablet_receipt_no only,
 * so a paper number can never collide with a scanned one.
 */

const SCAN_PERMISSIONS = ['parcels.scan'];
const READ_PERMISSIONS = ['shipments.read'];

/** Where a parcel can go next. 'delivered' is terminal — a parcel cannot
 *  be handed over twice, which is the whole point of scanning it. */
const NEXT_STATUS: Record<string, string | null> = {
  intake: 'warehouse',
  warehouse: 'arrived',
  arrived: 'delivered',
  delivered: null,
};

const STATUS_LABEL: Record<string, string> = {
  intake: 'مستلمة من المرسل',
  warehouse: 'في المستودع',
  arrived: 'وصلت إلى الوجهة',
  delivered: 'سُلّمت للمستلم',
};

const ROW_SELECT = `
  select
    r.id,
    r.tablet_receipt_no,
    r.receipt_no,
    r.parcel_status,
    r.delivered_to_name,
    r.destination,
    r.parcel_type,
    r.parcel_count,
    r.weight_kg,
    r.sender_name,
    r.receiver_name,
    r.collect_amount_usd,
    r.prepaid_amount_usd,
    r.hawala_amount_usd,
    r.fees_amount_usd,
    r.notes,
    r.created_at,
    s.ledger_date,
    s.branch_id,
    b.name as branch_name
  from daily_ledger_rows r
  join daily_ledger_sessions s on s.id = r.session_id
  left join branches b on b.id = s.branch_id
`;

function userIdFrom(req: any): string | null {
  return (req.requestUserContext?.userId as string | undefined) ?? null;
}

function branchIdFrom(req: any): string | null {
  const ctx = req.requestUserContext ?? {};
  return (
    (typeof ctx.activeBranchId === 'string' ? ctx.activeBranchId : undefined) ??
    (typeof ctx.scope?.branchId === 'string' ? ctx.scope.branchId : undefined) ??
    (Array.isArray(ctx.allowedBranchIds) ? ctx.allowedBranchIds[0] : undefined) ??
    null
  );
}

export function createParcelTrackingRouter() {
  const router = Router();

  /**
   * Hands the tablet a block of receipt numbers to use offline.
   *
   * The app prints the receipt while the customer is still standing there,
   * so it cannot wait for the server to allocate a number at save time —
   * it reserves a block whenever it has signal and consumes it offline.
   * Numbers are drawn from one shared sequence, so two tablets can never
   * produce the same one.
   */
  router.post(
    '/receipt-numbers/reserve',
    requirePermissions(['shipments.write']),
    asyncHandler(async (req, res) => {
      const { count } = z.object({ count: z.number().int().min(1).max(200).default(50) }).parse(req.body ?? {});
      const result = await pool.query<{ n: string }>(
        `select nextval('tablet_receipt_no_seq')::text as n from generate_series(1, $1)`,
        [count],
      );
      res.json({ success: true, data: { numbers: result.rows.map((r) => Number(r.n)) } });
    }),
  );

  /** Resolve a scanned code without changing anything — lets the scanner
   *  screen show what it is about to act on before acting. */
  router.get(
    '/lookup',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const code = z.coerce.number().int().parse(req.query.code);
      const found = await pool.query(
        `${ROW_SELECT} where r.tablet_receipt_no = $1 and r.deleted_at is null limit 1`,
        [code],
      );
      const row = found.rows[0];
      if (!row) throw new HttpError(404, 'لا توجد شحنة بهذا الرمز.');
      const history = await pool.query(
        `select e.from_status, e.to_status, e.delivered_to_name, e.created_at,
                u.full_name as scanned_by_name, b.name as branch_name
         from parcel_scan_events e
         left join users u on u.id = e.scanned_by
         left join branches b on b.id = e.branch_id
         where e.row_id = $1
         order by e.created_at`,
        [row.id],
      );
      res.json({
        success: true,
        data: { ...row, statusLabel: STATUS_LABEL[row.parcel_status] ?? row.parcel_status, history: history.rows },
      });
    }),
  );

  /**
   * Advances one parcel to its next status.
   *
   * The caller never says which status to move to: the server derives it
   * from where the parcel currently is. That is what stops an out-of-order
   * scan (delivering something that never left the origin) and a parcel
   * being delivered twice.
   */
  router.post(
    '/scan',
    requirePermissions(SCAN_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          code: z.coerce.number().int(),
          deliveredToName: z.string().trim().max(200).optional(),
          notes: z.string().trim().max(500).optional(),
        })
        .parse(req.body);

      const client = await pool.connect();
      try {
        await client.query('begin');
        // Locked for the duration: two agents scanning the same parcel at
        // the same moment must not both be told they delivered it.
        const current = await client.query<{ id: string; parcel_status: string; receiver_name: string }>(
          `select r.id, r.parcel_status, r.receiver_name
           from daily_ledger_rows r
           where r.tablet_receipt_no = $1 and r.deleted_at is null
           for update`,
          [body.code],
        );
        const row = current.rows[0];
        if (!row) throw new HttpError(404, 'لا توجد شحنة بهذا الرمز.');

        const nextStatus = NEXT_STATUS[row.parcel_status] ?? null;
        if (!nextStatus) {
          throw new HttpError(409, `هذه الشحنة ${STATUS_LABEL[row.parcel_status] ?? row.parcel_status} مسبقاً.`);
        }

        // Who collected it: whoever the agent typed, else the receiver
        // already on the shipment.
        const deliveredTo =
          nextStatus === 'delivered' ? (body.deliveredToName?.trim() || row.receiver_name || null) : null;

        const updated = await client.query(
          `update daily_ledger_rows
             set parcel_status = $2,
                 delivered_to_name = coalesce($3, delivered_to_name),
                 updated_at = now()
           where id = $1
           returning id`,
          [row.id, nextStatus, deliveredTo],
        );
        if (updated.rowCount !== 1) throw new HttpError(500, 'تعذر تحديث حالة الشحنة.');

        await client.query(
          `insert into parcel_scan_events (row_id, from_status, to_status, branch_id, scanned_by, delivered_to_name, notes)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, row.parcel_status, nextStatus, branchIdFrom(req), userIdFrom(req), deliveredTo, body.notes ?? null],
        );
        await client.query('commit');

        const fresh = await pool.query(`${ROW_SELECT} where r.id = $1`, [row.id]);
        res.json({
          success: true,
          data: {
            ...fresh.rows[0],
            statusLabel: STATUS_LABEL[nextStatus] ?? nextStatus,
            previousStatus: row.parcel_status,
          },
        });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  /**
   * The browser list. Delivered parcels are filtered out by default rather
   * than deleted — the proof of who took the goods and when has to survive
   * any dispute weeks later, so it stays searchable on demand.
   */
  router.get(
    '/',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          status: z.enum(['intake', 'warehouse', 'arrived', 'delivered', 'all', 'open']).default('open'),
          search: z.string().trim().max(120).optional(),
          branchId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        })
        .parse(req.query);

      const conditions = ['r.deleted_at is null', 'r.tablet_receipt_no is not null'];
      const params: unknown[] = [];

      if (query.status === 'open') {
        conditions.push(`r.parcel_status <> 'delivered'`);
      } else if (query.status !== 'all') {
        params.push(query.status);
        conditions.push(`r.parcel_status = $${params.length}`);
      }
      if (query.branchId) {
        params.push(query.branchId);
        conditions.push(`s.branch_id = $${params.length}`);
      }
      if (query.search) {
        params.push(`%${query.search}%`);
        const like = `$${params.length}`;
        conditions.push(
          `(r.tablet_receipt_no::text ilike ${like}
            or r.sender_name ilike ${like}
            or r.receiver_name ilike ${like}
            or r.destination ilike ${like})`,
        );
      }
      params.push(query.limit);

      const result = await pool.query(
        `${ROW_SELECT} where ${conditions.join(' and ')} order by r.created_at desc limit $${params.length}`,
        params,
      );
      res.json({
        success: true,
        data: result.rows.map((row) => ({
          ...row,
          statusLabel: STATUS_LABEL[row.parcel_status] ?? row.parcel_status,
        })),
      });
    }),
  );

  return router;
}
