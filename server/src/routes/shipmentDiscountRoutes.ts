import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import type { FinanceRepository } from '../repositories/financeRepository.js';
import type { ShipmentRepository } from '../repositories/shipmentRepository.js';

const READ_PERMISSIONS = ['finance.read'];
const WRITE_PERMISSIONS = ['finance.vouchers.manage', 'finance.read'];

function userIdFrom(req: any): string | null {
  return (req.requestUserContext?.userId as string | undefined) ?? null;
}
function companyIdFrom(req: any): string | null {
  return (req.requestUserContext?.companyId as string | undefined) ?? null;
}
function scopeFrom(req: any) {
  return {
    companyId: companyIdFrom(req) ?? undefined,
    branchId: (req.requestUserContext?.branchId as string | undefined) ?? undefined,
  };
}

const createDiscountSchema = z.object({
  shipmentNo: z.string().min(1),
  amountUsd: z.coerce.number().positive(),
  notes: z.string().nullable().optional(),
});

export function createShipmentDiscountRouter(financeRepository: FinanceRepository, shipmentRepository: ShipmentRepository) {
  const router = Router();

  // البحث عن شحنة برقم إيصالها قبل تسجيل الحسم — يعرض المطالَب به الحالي
  // على الوكيل لهذه الشحنة (بعد خصم أي حسومات سابقة) ليقرر المحاسب المبلغ.
  router.get(
    '/lookup',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const shipmentNo = String(req.query.shipmentNo ?? '').trim();
      if (!shipmentNo) throw new HttpError(400, 'أدخل رقم إيصال الشحنة.');

      const shipment = await shipmentRepository.getByShipmentNo(shipmentNo, scopeFrom(req));
      if (!shipment) throw new HttpError(404, 'لا توجد شحنة بهذا رقم الإيصال.');
      if (!shipment.agent_id) throw new HttpError(400, 'هذه الشحنة غير مرتبطة بوكيل — لا يمكن تسجيل حسم عليها.');

      const amountOwedUsd = await financeRepository.getShipmentAgentNetUsd(shipment.id);

      res.json({
        success: true,
        data: {
          shipmentId: shipment.id,
          shipmentNo: shipment.shipment_no,
          agentId: shipment.agent_id,
          agentName: shipment.agent_name,
          branchId: shipment.branch_id,
          amountOwedUsd,
        },
      });
    }),
  );

  router.get(
    '/',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const scope = scopeFrom(req);
      const values: unknown[] = [];
      const conditions: string[] = [];
      if (scope.companyId) {
        values.push(scope.companyId);
        conditions.push(`sdv.company_id = $${values.length}`);
      }
      const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const result = await pool.query(
        `
        select sdv.*, ag.name as agent_name
        from shipment_discount_vouchers sdv
        left join agents ag on ag.id = sdv.agent_id
        ${whereClause}
        order by sdv.created_at desc
        limit 500
        `,
        values,
      );
      res.json({ success: true, data: result.rows });
    }),
  );

  router.post(
    '/',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = createDiscountSchema.parse(req.body);
      const companyId = companyIdFrom(req);
      const userId = userIdFrom(req);

      const shipment = await shipmentRepository.getByShipmentNo(body.shipmentNo, scopeFrom(req));
      if (!shipment) throw new HttpError(404, 'لا توجد شحنة بهذا رقم الإيصال.');
      if (!shipment.agent_id) throw new HttpError(400, 'هذه الشحنة غير مرتبطة بوكيل — لا يمكن تسجيل حسم عليها.');

      const amountOwedUsd = await financeRepository.getShipmentAgentNetUsd(shipment.id);
      if (body.amountUsd > amountOwedUsd + 0.0001) {
        throw new HttpError(
          400,
          `مبلغ الحسم (${body.amountUsd}$) أكبر من المطالَب به حالياً على هذه الشحنة (${amountOwedUsd}$).`,
        );
      }

      const client = await pool.connect();
      try {
        await client.query('begin');

        const movementNotes = `حسم عند استلام الشحنة رقم ${shipment.shipment_no}${body.notes ? ' — ' + body.notes : ''}`;
        const movementId = await financeRepository.insertShipmentDiscountMovement(client, {
          shipmentId: shipment.id,
          shipmentNo: shipment.shipment_no,
          agentId: shipment.agent_id,
          branchId: shipment.branch_id ?? null,
          notes: movementNotes,
          amountUsd: body.amountUsd,
          createdByUserId: userId,
        });

        const voucherNo = `SDV-${String(Date.now()).slice(-9)}`;
        const inserted = await client.query(
          `
          insert into shipment_discount_vouchers
            (voucher_no, shipment_id, shipment_no, agent_id, branch_id, company_id, amount_usd, notes, party_financial_movement_id, created_by)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning id
          `,
          [
            voucherNo,
            shipment.id,
            shipment.shipment_no,
            shipment.agent_id,
            shipment.branch_id ?? null,
            companyId,
            body.amountUsd,
            body.notes ?? null,
            movementId,
            userId,
          ],
        );

        await client.query('commit');
        res.status(201).json({ success: true, data: { id: inserted.rows[0].id, voucherNo } });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    '/:id/reverse',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const userId = userIdFrom(req);

      const existing = await pool.query(`select * from shipment_discount_vouchers where id = $1`, [id]);
      const voucher = existing.rows[0];
      if (!voucher) throw new HttpError(404, 'سند الحسم غير موجود.');
      if (voucher.reversed_at) throw new HttpError(400, 'تم عكس هذا السند مسبقاً.');

      const client = await pool.connect();
      try {
        await client.query('begin');

        const reversalMovementId = await financeRepository.insertShipmentDiscountReversalMovement(client, {
          shipmentId: voucher.shipment_id,
          shipmentNo: voucher.shipment_no,
          agentId: voucher.agent_id,
          branchId: voucher.branch_id,
          notes: `عكس سند حسم ${voucher.voucher_no}`,
          amountUsd: Number(voucher.amount_usd),
          createdByUserId: userId,
        });

        await client.query(
          `update shipment_discount_vouchers set reversed_at = now(), reversal_movement_id = $2 where id = $1`,
          [id, reversalMovementId],
        );

        await client.query('commit');
        res.json({ success: true });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  return router;
}
