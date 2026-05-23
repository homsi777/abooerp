import { Router, type Request } from 'express';
import { z } from 'zod';
import type { ShipmentService } from '../services/shipmentService.js';
import type { FinanceService } from '../services/financeService.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { normalizeShipmentStatus, type CanonicalShipmentStatus } from '../domain/shipmentStatus.js';
import { pool } from '../db/pool.js';

const actionSchema = z.object({
  note: z.string().max(400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const actionMap: Record<string, CanonicalShipmentStatus> = {
  'agent-received': 'AGENT_RECEIVED',
  'mark-in-transit': 'IN_TRANSIT',
  arrived: 'ARRIVED_AT_DESTINATION',
  'out-for-delivery': 'OUT_FOR_DELIVERY',
  deliver: 'DELIVERED',
  'request-return': 'RETURN_REQUESTED',
  'mark-returned': 'RETURNED',
};

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function workspaceSummaryPayload(
  service: ShipmentService,
  financeService: FinanceService,
  req: Request,
) {
  const scope = parseDataScope(req);
  const shipments = await service.list(scope);
  const t0 = startOfTodayUtc().toISOString();
  const counts: Record<string, number> = {};
  for (const row of shipments) {
    const k = normalizeShipmentStatus(String(row.status));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const todayShipments = shipments.filter((s) => String(s.created_at) >= t0);
  const upcoming = shipments.filter((s) => {
    const st = normalizeShipmentStatus(String(s.status));
    return ['REGISTERED', 'CONFIRMED', 'READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT'].includes(st);
  });

  let receiptToday = 0;
  let paymentToday = 0;
  try {
    const receipts = await financeService.listReceiptVouchers(scope, {});
    const payments = await financeService.listPaymentVouchers(scope);
    receiptToday = receipts.filter((r: { created_at?: string }) => String(r.created_at) >= t0).length;
    paymentToday = payments.filter((r: { created_at?: string }) => String(r.created_at) >= t0).length;
  } catch {
    receiptToday = -1;
    paymentToday = -1;
  }

  return {
    counts,
    totals: {
      all: shipments.length,
      today: todayShipments.length,
      upcoming: upcoming.length,
    },
    financeToday: {
      receiptVouchers: receiptToday,
      paymentVouchers: paymentToday,
    },
  };
}

export function createAgentPortalRouter(service: ShipmentService, financeService: FinanceService, agents: AgentRepository) {
  const router = Router();

  router.get(
    '/profile',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const ctx = (req as any).requestUserContext;
      const companyId = ctx?.companyId as string | undefined;
      const agentId = ctx?.scope?.agentId as string | undefined;
      if (!companyId || !agentId) {
        res.status(403).json({ success: false, error: 'لا يوجد وكيل مرتبط بهذا الحساب.' });
        return;
      }
      const agent = await agents.getAgentById(agentId, companyId);
      if (!agent) {
        res.status(404).json({ success: false, error: 'الوكيل غير موجود.' });
        return;
      }
      let branchLabel: string | null = null;
      if (agent.branch_id) {
        const br = await pool.query<{ name: string }>(`select name from branches where id = $1 limit 1`, [agent.branch_id]);
        branchLabel = br.rows[0]?.name ?? null;
      }
      res.json({
        success: true,
        data: {
          agent,
          branchLabel,
          username: ctx.username as string,
        },
      });
    }),
  );

  router.get(
    '/workspace-summary',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const data = await workspaceSummaryPayload(service, financeService, req);
      res.json({ success: true, data });
    }),
  );

  /** Alias for older clients / cached bundles expecting `/stats` */
  router.get(
    '/stats',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const data = await workspaceSummaryPayload(service, financeService, req);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/shipments',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const items = await service.list(scope);
      res.json({ success: true, data: items });
    }),
  );

  router.post(
    '/shipments/:id/:action',
    requirePermissions(['agent_portal.status_action']),
    asyncHandler(async (req, res) => {
      const action = String(req.params.action);
      const target = actionMap[action];
      if (!target) {
        res.status(400).json({ success: false, error: 'الإجراء المطلوب غير مدعوم في بوابة الوكيل.' });
        return;
      }
      const payload = actionSchema.parse(req.body ?? {});
      const updated = await service.transitionStatus({
        shipmentId: String(req.params.id),
        nextStatus: target,
        note: payload.note,
        metadata: payload.metadata,
        changedBy: (req as any).requestUserContext?.userId,
        source: `agent-portal.${action}`,
        scope: parseDataScope(req),
      });
      res.json({ success: true, data: updated });
    }),
  );

  return router;
}
