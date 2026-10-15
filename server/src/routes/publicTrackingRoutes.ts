import express from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { normalizeShipmentStatus } from '../domain/shipmentStatus.js';

/**
 * تتبّع عام لرقم الإيصال — بلا تسجيل دخول (شاشة الزبون قبل شاشة الدخول).
 * يعرض فقط بيانات غير حساسة (لا مبالغ مالية) كي يبقى آمناً للعرض العام.
 */

const STATUS_LABELS_AR: Record<string, string> = {
  DRAFT: 'قيد الإعداد',
  REGISTERED: 'تم تسجيل الشحنة',
  CONFIRMED: 'تم تأكيد الشحنة',
  READY_FOR_PICKUP: 'جاهزة للاستلام من الفرع',
  HANDED_TO_DRIVER: 'تم التسليم للسائق',
  HANDED_TO_AGENT: 'تم التسليم للوكيل',
  AGENT_RECEIVED: 'استلمها الوكيل في الوجهة',
  IN_TRANSIT: 'قيد النقل',
  ARRIVED_AT_DESTINATION: 'وصلت إلى فرع الوجهة',
  OUT_FOR_DELIVERY: 'خارجة للتوصيل',
  DELIVERED: 'تم التسليم للمستلم',
  RETURN_REQUESTED: 'طلب إرجاع',
  RETURNED: 'تم إرجاع الشحنة',
  CANCELLED: 'ملغاة',
  FINANCIALLY_CLOSED: 'تم التسليم (مغلقة مالياً)',
  UNKNOWN: 'تم الاستلام في الفرع — بانتظار الشحن',
};

const trackingQuerySchema = z.object({
  receiptNo: z.string().trim().min(1).max(64),
});

type TrackingRow = {
  receipt_no: string | null;
  ledger_date: string;
  destination: string;
  sender_name: string | null;
  receiver_name: string | null;
  parcel_type: string;
  parcel_count: number | null;
  weight_kg: string | null;
  posted_shipment_id: string | null;
  shipment_status: string | null;
  shipment_no: string | null;
};

export function createPublicTrackingRouter() {
  const router = express.Router();

  router.get(
    '/tracking',
    asyncHandler(async (req, res) => {
      const { receiptNo } = trackingQuerySchema.parse(req.query);

      const result = await pool.query<TrackingRow>(
        `
        select
          r.receipt_no,
          sess.ledger_date::text as ledger_date,
          r.destination,
          r.sender_name,
          r.receiver_name,
          r.parcel_type,
          r.parcel_count,
          r.weight_kg::text as weight_kg,
          r.posted_shipment_id,
          sh.status as shipment_status,
          sh.shipment_no
        from daily_ledger_rows r
        join daily_ledger_sessions sess on sess.id = r.session_id
        left join shipments sh on sh.id = r.posted_shipment_id
        where r.receipt_no = $1 and r.deleted_at is null
        order by r.created_at desc
        limit 1
        `,
        [receiptNo],
      );

      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ success: false, error: 'لم يتم العثور على إيصال بهذا الرقم.' });
        return;
      }

      const canonicalStatus = row.posted_shipment_id
        ? normalizeShipmentStatus(row.shipment_status)
        : 'UNKNOWN';

      res.json({
        success: true,
        data: {
          receiptNo: row.receipt_no ?? receiptNo,
          date: row.ledger_date,
          destination: row.destination,
          senderName: row.sender_name,
          receiverName: row.receiver_name,
          parcelType: row.parcel_type,
          parcelCount: row.parcel_count,
          weightKg: row.weight_kg,
          shipmentNo: row.shipment_no,
          status: canonicalStatus,
          statusLabel: STATUS_LABELS_AR[canonicalStatus] ?? STATUS_LABELS_AR.UNKNOWN,
        },
      });
    }),
  );

  return router;
}
