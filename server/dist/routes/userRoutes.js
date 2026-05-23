import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
const createUserSchema = z.object({
    username: z.string().min(3),
    full_name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    password: z.string().min(6),
    role_id: z.string().uuid(),
    status: z.enum(['active', 'inactive', 'locked']).optional(),
    is_active: z.boolean().optional(),
    branch_ids: z.array(z.string().uuid()).optional().default([]),
});
const updateUserSchema = z.object({
    username: z.string().min(3).optional(),
    full_name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    password: z.string().min(6).optional(),
    role_id: z.string().uuid().optional(),
    status: z.enum(['active', 'inactive', 'locked']).optional(),
    is_active: z.boolean().optional(),
});
const assignBranchesSchema = z.object({
    branchIds: z.array(z.string().uuid()),
});
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId) {
        throw new HttpError(403, 'Company scope is required.');
    }
    return companyId;
}
export function createUserRouter(repository) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/', requirePermissions(['settings.users.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const users = await repository.listUsers(companyId);
        res.json({ success: true, data: users });
    }));
    router.post('/', requirePermissions(['settings.users.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = createUserSchema.parse(req.body);
        const roleAllowed = await repository.isRoleAllowedForCompany(payload.role_id, companyId);
        if (!roleAllowed) {
            throw new HttpError(403, 'Role is not allowed for your company scope.');
        }
        const password_hash = await bcrypt.hash(payload.password, 12);
        const created = await repository.createUser(companyId, {
            username: payload.username,
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone,
            password_hash,
            role_id: payload.role_id,
            status: payload.status,
            is_active: payload.is_active ?? payload.status === 'active',
        });
        if (payload.branch_ids.length > 0) {
            await repository.assignBranches(created.id, companyId, payload.branch_ids);
        }
        const data = await repository.getUserById(created.id, companyId);
        auditService.logAsync({
            req,
            action: 'USER_CREATED',
            entityType: 'user',
            entityId: created.id,
            metadata: {
                username: created.username,
                roleId: created.role_id,
                branchIds: payload.branch_ids,
            },
        });
        res.status(201).json({ success: true, data });
    }));
    router.put('/:id', requirePermissions(['settings.users.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = updateUserSchema.parse(req.body);
        if (payload.role_id) {
            const roleAllowed = await repository.isRoleAllowedForCompany(payload.role_id, companyId);
            if (!roleAllowed) {
                throw new HttpError(403, 'Role is not allowed for your company scope.');
            }
        }
        const data = await repository.updateUser(String(req.params.id), companyId, {
            username: payload.username,
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone,
            password_hash: payload.password ? await bcrypt.hash(payload.password, 12) : undefined,
            role_id: payload.role_id,
            status: payload.status,
            is_active: payload.is_active,
        });
        if (!data) {
            res.status(404).json({ success: false, error: 'User not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'USER_UPDATED',
            entityType: 'user',
            entityId: String(req.params.id),
            metadata: {
                changedFields: Object.keys(payload),
                roleId: payload.role_id,
                status: payload.status,
                isActive: payload.is_active,
            },
        });
        if (payload.password) {
            auditService.logAsync({
                req,
                action: 'PASSWORD_RESET',
                entityType: 'user',
                entityId: String(req.params.id),
                metadata: {
                    trigger: 'user_update',
                },
            });
        }
        res.json({ success: true, data });
    }));
    router.delete('/:id', requirePermissions(['settings.users.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const ok = await repository.deactivateUser(String(req.params.id), companyId);
        if (!ok) {
            res.status(404).json({ success: false, error: 'User not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'USER_DEACTIVATED',
            entityType: 'user',
            entityId: String(req.params.id),
        });
        res.json({ success: true });
    }));
    router.post('/:id/branches', requirePermissions(['settings.users.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = assignBranchesSchema.parse(req.body);
        const targetUserId = String(req.params.id);
        const user = await repository.getUserById(targetUserId, companyId);
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found.' });
            return;
        }
        await repository.assignBranches(targetUserId, companyId, payload.branchIds);
        const data = await repository.getUserById(targetUserId, companyId);
        auditService.logAsync({
            req,
            action: 'USER_UPDATED',
            entityType: 'user',
            entityId: targetUserId,
            metadata: {
                branchAssignment: payload.branchIds,
            },
        });
        res.json({ success: true, data });
    }));
    return router;
}
