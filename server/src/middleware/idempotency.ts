import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';

export function requireIdempotencyKey(routeKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = req.headers['x-idempotency-key'];
    const idempotencyKey = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!idempotencyKey) {
      res.status(400).json({ success: false, error: 'x-idempotency-key header is required for this operation.' });
      return;
    }

    const userContext = (req as any).requestUserContext;
    const companyId = userContext?.companyId ?? null;
    const userId = userContext?.userId ?? null;

    await pool.query(
      `
      delete from idempotency_keys
      where created_at < now() - interval '24 hours'
      `
    );

    const result = await pool.query(
      `
      insert into idempotency_keys(company_id, user_id, route_key, idempotency_key, status)
      values($1, $2, $3, $4, 'processing')
      on conflict do nothing
      `,
      [companyId, userId, routeKey, idempotencyKey]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(409).json({ success: false, error: 'تم منع تكرار نفس الطلب. يرجى إعادة المحاولة.' });
      return;
    }

    res.on('finish', async () => {
      try {
        await pool.query(
          `
          update idempotency_keys
          set
            status = $5,
            updated_at = now()
          where coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
            and coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
            and route_key = $3
            and idempotency_key = $4
          `,
          [companyId, userId, routeKey, idempotencyKey, res.statusCode < 400 ? 'completed' : 'failed']
        );
      } catch {
        // no-op
      }
    });

    next();
  };
}
