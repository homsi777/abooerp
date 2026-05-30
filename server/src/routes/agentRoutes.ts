import { Router } from 'express';
import { z } from 'zod';
import { AgentRepository } from '../repositories/agentRepository.js';
import { requireAnyPermissions, requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import type { FinanceService } from '../services/financeService.js';

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  governorate: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  branch_id: z.string().uuid(),
  telegram_chat_id: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  commission_percentage: z.coerce.number().min(0).max(100).optional(),
});

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  governorate: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  branch_id: z.union([z.string().uuid(), z.null()]).optional(),
  telegram_chat_id: z.union([z.string(), z.null()]).optional(),
  is_active: z.boolean().optional(),
  commission_percentage: z.coerce.number().min(0).max(100).optional(),
});

const reconciliationSchema = z.object({
  balanceAmount: z.coerce.number().optional(),
  currencyCode: z.string().min(1).max(10).optional(),
  notes: z.string().optional(),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

function parseBoolFlag(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

export function createAgentRouter(repository: AgentRepository, financeService: FinanceService) {
  const router = Router();
  const auditService = new AuditService();

  /** Used by دفتر الشحن اليومي — must work for agent users (shipments.read/write), not only settings.agents.read */
  router.get(
    '/lookup-by-destination',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const destination = typeof req.query.destination === 'string' ? req.query.destination : '';
      if (!destination.trim()) {
        res.status(400).json({ success: false, error: 'destination is required.' });
        return;
      }
      const branchIdQuery = req.query.branchId;
      const branchId = typeof branchIdQuery === 'string' ? branchIdQuery : undefined;
      const rows = await repository.lookupByDestination(companyId, destination, branchId);
      res.json({ success: true, data: rows });
    }),
  );

  /** List for company scope: settings UI + دفتر الشحن اليومي (shipments.read only). */
  router.get(
    '/',
    requireAnyPermissions(['settings.agents.read', 'shipments.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const branchIdQuery = req.query.branchId;
      const branchId = typeof branchIdQuery === 'string' ? branchIdQuery : undefined;
      if (branchId) {
        const branchAllowed = await repository.branchBelongsToCompany(branchId, companyId);
        if (!branchAllowed) {
          throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
      }
      const includeInactive = parseBoolFlag(req.query.includeInactive);
      const data = await repository.listAgents(companyId, branchId, includeInactive);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/:id/financial-statement',
    requireAnyPermissions(['settings.agents.read', 'finance.read', 'finance.view']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.getAgentFinancialStatement(companyId, String(req.params.id));
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/:id/account-statement',
    requireAnyPermissions(['settings.agents.read', 'finance.read', 'finance.view']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.getAgentAccountStatement(companyId, String(req.params.id));
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/:id/reconciliations',
    requireAnyPermissions(['finance.write', 'finance.vouchers.write', 'settings.agents.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = reconciliationSchema.parse(req.body);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const data = await repository.createAgentReconciliation(companyId, String(req.params.id), {
        balanceAmount: payload.balanceAmount,
        currencyCode: payload.currencyCode,
        notes: payload.notes,
        createdByUserId: userId ?? null,
      });
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'AGENT_ACCOUNT_RECONCILED',
        entityType: 'agent',
        entityId: String(req.params.id),
        metadata: {
          balanceAmount: data.balance_amount,
          currencyCode: data.currency_code,
        },
      });
      res.status(201).json({ success: true, data });
    }),
  );

  router.post(
    '/',
    requirePermissions(['settings.agents.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = createSchema.parse(req.body);
      if (payload.branch_id) {
        const branchAllowed = await repository.branchBelongsToCompany(payload.branch_id, companyId);
        if (!branchAllowed) {
          throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
      }
      const data = await repository.createAgent(companyId, payload);
      try {
        await financeService.ensureDefaultAgentCashbox(companyId, {
          id: data.id,
          code: data.code,
          name: data.name,
          branch_id: data.branch_id,
        });
      } catch (cashErr) {
        console.error('[agents] ensureDefaultAgentCashbox failed:', cashErr);
      }
      auditService.logAsync({
        req,
        action: 'AGENT_CREATED',
        entityType: 'agent',
        entityId: data.id,
        metadata: {
          code: data.code,
          name: data.name,
          branchId: data.branch_id,
        },
      });
      res.status(201).json({ success: true, data });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['settings.agents.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = updateSchema.parse(req.body);
      const before = await repository.getAgentById(String(req.params.id), companyId);
      if (typeof payload.branch_id === 'string') {
        const branchAllowed = await repository.branchBelongsToCompany(payload.branch_id, companyId);
        if (!branchAllowed) {
          throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
      }
      const data = await repository.updateAgent(String(req.params.id), companyId, payload);
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'AGENT_UPDATED',
        entityType: 'agent',
        entityId: String(req.params.id),
        metadata: {
          changedFields: Object.keys(payload),
          branchId: payload.branch_id,
        },
      });
      if (
        before
        && typeof payload.commission_percentage === 'number'
        && Number(before.commission_percentage ?? 0) !== Number(payload.commission_percentage)
      ) {
        auditService.logAsync({
          req,
          action: 'AGENT_COMMISSION_PERCENTAGE_CHANGED',
          entityType: 'agent',
          entityId: String(req.params.id),
          metadata: {
            before: Number(before.commission_percentage ?? 0),
            after: Number(payload.commission_percentage),
          },
        });
      }
      res.json({ success: true, data });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['settings.agents.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repository.deactivateAgent(String(req.params.id), companyId);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'AGENT_DEACTIVATED',
        entityType: 'agent',
        entityId: String(req.params.id),
      });
      res.json({ success: true });
    }),
  );

  return router;
}
