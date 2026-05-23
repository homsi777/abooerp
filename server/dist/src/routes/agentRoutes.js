import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
const createSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    phone: z.string().optional(),
    governorate: z.string().optional(),
    branch_id: z.string().uuid(),
    is_active: z.boolean().optional(),
});
const updateSchema = z.object({
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    governorate: z.string().optional(),
    branch_id: z.union([z.string().uuid(), z.null()]).optional(),
    is_active: z.boolean().optional(),
});
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId) {
        throw new HttpError(403, 'Company scope is required.');
    }
    return companyId;
}
function parseBoolFlag(value) {
    if (typeof value !== 'string')
        return false;
    return value === '1' || value.toLowerCase() === 'true';
}
export function createAgentRouter(repository) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/', requirePermissions(['settings.agents.read']), asyncHandler(async (req, res) => {
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
    }));
    router.post('/', requirePermissions(['settings.agents.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = createSchema.parse(req.body);
        if (payload.branch_id) {
            const branchAllowed = await repository.branchBelongsToCompany(payload.branch_id, companyId);
            if (!branchAllowed) {
                throw new HttpError(403, 'Branch does not belong to your company scope.');
            }
        }
        const data = await repository.createAgent(companyId, payload);
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
    }));
    router.put('/:id', requirePermissions(['settings.agents.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = updateSchema.parse(req.body);
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
        res.json({ success: true, data });
    }));
    router.delete('/:id', requirePermissions(['settings.agents.write']), asyncHandler(async (req, res) => {
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
    }));
    return router;
}
