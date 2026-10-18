import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';

// نقاط نهاية تطبيق السائق (AbooERP Driver) — تحديداً كما في العقد الموثَّق في
// docs/DRIVER_ANDROID_APP_SPEC_AR.md: GET current-trip، POST trip/start،
// POST trip/end، POST location-ping. أسماء الحقول (lat, lng, accuracyM,
// recordedAt, tripId) مطابقة لما يرسله التطبيق فعلياً (تم التحقق من الكود).

function driverIdFrom(req: any): string {
  const driverId = req.requestUserContext?.driverId as string | null | undefined;
  if (!driverId) throw new HttpError(403, 'هذا الحساب غير مرتبط بسجل سائق.');
  return driverId;
}

function companyIdFrom(req: any): string | undefined {
  return (req.requestUserContext?.companyId as string | undefined) ?? undefined;
}

const tripActionSchema = z.object({
  tripId: z.string().uuid(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().nullable().optional(),
  recordedAt: z.string(),
  // لا تُرفَض نبضة موقع بسبب معرّف رحلة غير صالح (قد يُرسِل التطبيق قيمة
  // احتياطية نصية وليست UUID حقيقياً) — نتجاهل الربط بالرحلة في هذه الحالة
  // فقط، ونُسجِّل النبضة نفسها دائماً.
  tripId: z.string().nullable().optional(),
});

/** يتأكد أن هذا المانيفست (الرحلة) يخص هذا السائق فعلاً قبل أي إجراء عليه. */
async function assertManifestBelongsToDriver(manifestId: string, driverId: string, companyId?: string) {
  const conditions = ['id = $1', 'driver_id = $2', 'deleted_at is null'];
  const values: unknown[] = [manifestId, driverId];
  if (companyId) {
    values.push(companyId);
    conditions.push(`company_id = $${values.length}`);
  }
  const result = await pool.query(`select id from manifests where ${conditions.join(' and ')} limit 1`, values);
  if (!result.rows[0]) throw new HttpError(404, 'هذه الرحلة غير موجودة أو لا تخص هذا السائق.');
}

export function createDriverMobileRouter() {
  const router = Router();

  router.get(
    '/current-trip',
    requirePermissions(['driver.trip.read']),
    asyncHandler(async (req, res) => {
      const driverId = driverIdFrom(req);
      const companyId = companyIdFrom(req);

      const conditions = ['m.driver_id = $1', "m.status = 'dispatched'", 'm.deleted_at is null'];
      const values: unknown[] = [driverId];
      if (companyId) {
        values.push(companyId);
        conditions.push(`m.company_id = $${values.length}`);
      }

      const manifestResult = await pool.query(
        `
        select m.id, m.manifest_no, m.status, m.created_at, m.branch_id, b.name as branch_name
        from manifests m
        left join branches b on b.id = m.branch_id
        where ${conditions.join(' and ')}
        order by m.created_at desc
        limit 1
        `,
        values,
      );
      const manifest = manifestResult.rows[0];
      if (!manifest) {
        res.json({ success: true, data: null });
        return;
      }

      const shipmentsResult = await pool.query(
        `
        select
          s.id,
          coalesce(dlr.receipt_no, s.shipment_no) as receipt_number,
          sr_s.full_name as sender_name,
          sr_r.full_name as receiver_name,
          s.destination_city,
          s.pieces_count,
          s.weight_kg,
          s.status
        from manifest_shipments ms
        join shipments s on s.id = ms.shipment_id and s.deleted_at is null
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        left join lateral (
          select dlr.receipt_no
          from daily_ledger_rows dlr
          where dlr.posted_shipment_id = s.id
          order by dlr.created_at desc
          limit 1
        ) dlr on true
        where ms.manifest_id = $1
        order by s.created_at asc
        `,
        [manifest.id],
      );

      const destinationCities = Array.from(
        new Set(shipmentsResult.rows.map((r) => r.destination_city).filter(Boolean)),
      );

      res.json({
        success: true,
        data: {
          id: manifest.id,
          tripNumber: manifest.manifest_no,
          date: manifest.created_at,
          originCity: manifest.branch_name ?? null,
          destinationCities,
          status: manifest.status,
          shipments: shipmentsResult.rows.map((r) => ({
            id: r.id,
            receiptNumber: r.receipt_number,
            senderName: r.sender_name,
            receiverName: r.receiver_name,
            destinationCity: r.destination_city,
            parcelCount: r.pieces_count,
            weightKg: r.weight_kg,
            status: r.status,
          })),
        },
      });
    }),
  );

  router.post(
    '/trip/start',
    requirePermissions(['driver.trip.read']),
    asyncHandler(async (req, res) => {
      const driverId = driverIdFrom(req);
      const body = tripActionSchema.parse(req.body);
      await assertManifestBelongsToDriver(body.tripId, driverId, companyIdFrom(req));

      // لا تُنشأ جلسة جديدة إن كانت هناك جلسة مفتوحة أصلاً لنفس الرحلة (إعادة فتح التطبيق مثلاً).
      const existing = await pool.query(
        `select id from driver_trip_sessions where manifest_id = $1 and driver_id = $2 and ended_at is null limit 1`,
        [body.tripId, driverId],
      );
      if (!existing.rows[0]) {
        await pool.query(
          `insert into driver_trip_sessions (manifest_id, driver_id) values ($1, $2)`,
          [body.tripId, driverId],
        );
      }
      res.json({ success: true });
    }),
  );

  router.post(
    '/trip/end',
    requirePermissions(['driver.trip.read']),
    asyncHandler(async (req, res) => {
      const driverId = driverIdFrom(req);
      const body = tripActionSchema.parse(req.body);
      await assertManifestBelongsToDriver(body.tripId, driverId, companyIdFrom(req));

      await pool.query(
        `update driver_trip_sessions set ended_at = now() where manifest_id = $1 and driver_id = $2 and ended_at is null`,
        [body.tripId, driverId],
      );
      res.json({ success: true });
    }),
  );

  router.post(
    '/location-ping',
    requirePermissions(['driver.location.write']),
    asyncHandler(async (req, res) => {
      const driverId = driverIdFrom(req);
      const body = locationPingSchema.parse(req.body);

      const manifestId = body.tripId && UUID_RE.test(body.tripId) ? body.tripId : null;
      await pool.query(
        `
        insert into driver_location_pings (driver_id, manifest_id, lat, lng, accuracy_m, recorded_at)
        values ($1, $2, $3, $4, $5, $6::timestamptz)
        `,
        [driverId, manifestId, body.lat, body.lng, body.accuracyM ?? null, body.recordedAt],
      );
      res.json({ success: true });
    }),
  );

  return router;
}
