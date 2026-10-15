import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { normalizeName } from '../services/dailyLedgerShipmentPostingService.js';

const READ_PERMISSIONS = ['finance.read'];
const WRITE_PERMISSIONS = ['finance.write'];

function userIdFrom(req: any): string | null {
  return (req.requestUserContext?.userId as string | undefined) ?? null;
}

const createSchema = z.object({
  goodsName: z.string().min(1),
  origin: z.string().min(1),
  destination: z.string().min(1),
  weightKg: z.coerce.number().nonnegative().nullable().optional(),
  parcelCount: z.coerce.number().int().nonnegative().nullable().optional(),
  unitPriceUsd: z.coerce.number().nonnegative(),
  customerName: z.string().nullable().optional(),
});

export function createGoodsShippingPricesRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const { rows } = await pool.query(
        `
        select id, goods_name, origin, destination, weight_kg, parcel_count, unit_price_usd, customer_name, created_at
        from goods_shipping_prices
        order by created_at desc
        limit $1
        `,
        [limit],
      );
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = createSchema.parse(req.body);
      const { rows } = await pool.query(
        `
        insert into goods_shipping_prices (
          goods_name, goods_name_normalized, origin, origin_normalized,
          destination, destination_normalized,
          weight_kg, parcel_count, unit_price_usd, customer_name, created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning id, goods_name, origin, destination, weight_kg, parcel_count, unit_price_usd, customer_name, created_at
        `,
        [
          body.goodsName.trim(),
          normalizeName(body.goodsName).toLowerCase(),
          body.origin.trim(),
          normalizeName(body.origin).toLowerCase(),
          body.destination.trim(),
          normalizeName(body.destination).toLowerCase(),
          body.weightKg ?? null,
          body.parcelCount ?? null,
          body.unitPriceUsd,
          body.customerName?.trim() || null,
          userIdFrom(req),
        ],
      );
      res.status(201).json({ success: true, data: rows[0] });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      await pool.query(`delete from goods_shipping_prices where id = $1`, [req.params.id]);
      res.json({ success: true });
    }),
  );

  return router;
}
