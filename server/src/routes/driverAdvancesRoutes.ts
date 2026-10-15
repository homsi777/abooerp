import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import type { FinanceRepository } from '../repositories/financeRepository.js';

const READ_PERMISSIONS = ['drivers.view', 'shipments.read'];
const WRITE_PERMISSIONS = ['parties.manage', 'drivers.manage'];

function userIdFrom(req: any): string | null {
  return (req.requestUserContext?.userId as string | undefined) ?? null;
}

function companyIdFrom(req: any): string | null {
  return (req.requestUserContext?.companyId as string | undefined) ?? null;
}

const createAdvanceSchema = z.object({
  agentId: z.string().uuid().nullable().optional(),
  amountUsd: z.coerce.number().positive(),
  notes: z.string().nullable().optional(),
  /** تاريخ الرحلة الأساسية — قد يختلف عن تاريخ استلام المبلغ فعلياً */
  tripDate: z.string().nullable().optional(),
  /** تاريخ استلام السائق للمبلغ فعلياً من الوكيل */
  receivedDate: z.string().nullable().optional(),
});

/** صندوق/كشف السائق: يحسب المتبقي من أجرة السفرة، أو الذمة عليه إن تجاوز. */
async function buildDriverSummary(driverId: string) {
  const driverResult = await pool.query(
    `select id, full_name, trip_wage_usd from drivers where id = $1`,
    [driverId],
  );
  const driver = driverResult.rows[0];
  if (!driver) throw new HttpError(404, 'السائق غير موجود.');

  const entriesResult = await pool.query(
    `
    select a.id, a.agent_id, ag.name as agent_name, a.amount_usd, a.notes, a.created_at, a.payment_voucher_id,
           a.trip_date, a.received_date
    from driver_trip_advances a
    left join agents ag on ag.id = a.agent_id
    where a.driver_id = $1 and a.settled_at is null
    order by a.created_at asc
    `,
    [driverId],
  );

  const tripWageUsd = Number(driver.trip_wage_usd ?? 0);
  const totalTaken = entriesResult.rows.reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const remaining = Math.round((tripWageUsd - totalTaken) * 100) / 100;

  return {
    driverId: driver.id,
    driverName: driver.full_name,
    tripWageUsd,
    totalTaken: Math.round(totalTaken * 100) / 100,
    remainingForDriver: remaining > 0 ? remaining : 0,
    owedByDriver: remaining < 0 ? Math.abs(remaining) : 0,
    entries: entriesResult.rows,
  };
}

const reportQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

/** تقرير عام أو حسب تاريخ رحلة — يشمل السجلات المسوّاة وغير المسوّاة. */
async function buildDriverReport(filters: { driverId?: string; fromDate?: string; toDate?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.driverId) {
    params.push(filters.driverId);
    conditions.push(`a.driver_id = $${params.length}`);
  }
  if (filters.fromDate) {
    params.push(filters.fromDate);
    conditions.push(`coalesce(a.trip_date, a.created_at::date) >= $${params.length}`);
  }
  if (filters.toDate) {
    params.push(filters.toDate);
    conditions.push(`coalesce(a.trip_date, a.created_at::date) <= $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const result = await pool.query(
    `
    select
      a.id, a.driver_id, d.full_name as driver_name, d.trip_wage_usd,
      a.agent_id, ag.name as agent_name, a.amount_usd, a.notes,
      a.trip_date, a.received_date, a.created_at, a.payment_voucher_id, a.settled_at
    from driver_trip_advances a
    join drivers d on d.id = a.driver_id
    left join agents ag on ag.id = a.agent_id
    ${where}
    order by coalesce(a.trip_date, a.created_at::date) desc, a.created_at desc
    `,
    params,
  );

  return { entries: result.rows };
}

export function createDriverAdvancesRouter(financeRepository: FinanceRepository) {
  const router = Router();

  router.get(
    '/report',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const filters = reportQuerySchema.parse(req.query);
      const report = await buildDriverReport(filters);
      res.json({ success: true, data: report });
    }),
  );

  router.get(
    '/:driverId/advances',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const summary = await buildDriverSummary(String(req.params.driverId));
      res.json({ success: true, data: summary });
    }),
  );

  router.post(
    '/:driverId/advances',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const driverId = String(req.params.driverId);
      const body = createAdvanceSchema.parse(req.body);
      const companyId = companyIdFrom(req);
      const userId = userIdFrom(req);

      if (!companyId) throw new HttpError(403, 'نطاق الشركة غير محدَّد لهذا المستخدم.');

      const driverResult = await pool.query(`select id, full_name from drivers where id = $1`, [driverId]);
      const driver = driverResult.rows[0];
      if (!driver) throw new HttpError(404, 'السائق غير موجود.');

      let paymentVoucherId: string | null = null;

      const client = await pool.connect();
      try {
        await client.query('begin');

        // إن حُدِّد وكيل، يُنشأ سند صرف حقيقي ومؤكَّد من صندوق ذلك الوكيل —
        // هذا يضمن خصم المبلغ فعلياً من رصيده، فلا تُطالَب به مرة أخرى.
        if (body.agentId) {
          const cashbox = await financeRepository.findAnyAgentCashbox(companyId ?? '', body.agentId);
          if (!cashbox) {
            throw new HttpError(400, 'لا يوجد صندوق نشط لهذا الوكيل — تعذر تسجيل المبلغ محاسبياً.');
          }
          const voucherNo = `DRV-${String(Date.now()).slice(-9)}`;
          const voucher = await financeRepository.createPaymentVoucherWithClient(client, {
            voucherNo,
            agentId: body.agentId,
            relatedEntityType: 'driver_trip_advance',
            status: 'confirmed',
            notes: `دفعة نقدية للسائق ${driver.full_name} أثناء الرحلة${body.notes ? ' — ' + body.notes : ''}`,
            originalAmount: body.amountUsd,
            originalCurrency: 'USD',
            exchangeRateToUsd: 1,
            baseAmountUsd: body.amountUsd,
            createdByUserId: userId ?? undefined,
            companyId: companyId ?? undefined,
            cashboxId: String((cashbox as any).id),
          });
          paymentVoucherId = voucher.id;
        }

        const inserted = await client.query(
          `
          insert into driver_trip_advances
            (driver_id, agent_id, amount_usd, notes, payment_voucher_id, created_by, trip_date, received_date)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id
          `,
          [
            driverId,
            body.agentId ?? null,
            body.amountUsd,
            body.notes ?? null,
            paymentVoucherId,
            userId,
            body.tripDate ?? null,
            body.receivedDate ?? null,
          ],
        );

        await client.query('commit');
        void inserted;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      const summary = await buildDriverSummary(driverId);
      res.status(201).json({ success: true, data: summary });
    }),
  );

  router.delete(
    '/:driverId/advances/:advanceId',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const { advanceId } = req.params;
      const existing = await pool.query(
        `select payment_voucher_id from driver_trip_advances where id = $1 and settled_at is null`,
        [advanceId],
      );
      if (!existing.rows.length) {
        throw new HttpError(404, 'السطر غير موجود أو تمت تسويته مسبقاً.');
      }
      if (existing.rows[0].payment_voucher_id) {
        throw new HttpError(
          400,
          'هذا السطر مرتبط بسند دفع مؤكَّد في صندوق الوكيل — يجب عكس السند من شاشة السندات أولاً، ثم حذف هذا السطر.',
        );
      }
      await pool.query(`delete from driver_trip_advances where id = $1`, [advanceId]);
      const summary = await buildDriverSummary(String(req.params.driverId));
      res.json({ success: true, data: summary });
    }),
  );

  router.post(
    '/:driverId/advances/settle',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      await pool.query(
        `update driver_trip_advances set settled_at = now() where driver_id = $1 and settled_at is null`,
        [String(req.params.driverId)],
      );
      const summary = await buildDriverSummary(String(req.params.driverId));
      res.json({ success: true, data: summary });
    }),
  );

  return router;
}
