import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { pool } from '../db/pool.js';
const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
    branchId: z.string().uuid().optional(),
});
const refreshSchema = z.object({
    refreshToken: z.string().min(1),
    branchId: z.string().uuid().optional(),
});
const logoutSchema = z
    .object({
    refreshToken: z.string().min(1).optional(),
})
    .optional();
function resolveIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (Array.isArray(xff))
        return xff[0];
    if (typeof xff === 'string')
        return xff.split(',')[0]?.trim();
    return req.ip;
}
export function createAuthRouter(service) {
    const router = Router();
    router.get('/branches', asyncHandler(async (_req, res) => {
        const result = await pool.query(`
        select id, code, name
        from branches
        where is_active = true
        order by created_at asc
        `);
        res.json({ success: true, data: result.rows });
    }));
    router.post('/login', asyncHandler(async (req, res) => {
        const payload = loginSchema.parse(req.body);
        const data = await service.login({
            username: payload.username,
            password: payload.password,
            branchId: payload.branchId,
            userAgent: req.headers['user-agent'],
            ipAddress: resolveIp(req),
        });
        res.json({ success: true, data });
    }));
    router.get('/me', asyncHandler(async (req, res) => {
        const userId = req.requestUserContext?.userId;
        const context = req.requestUserContext;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required.' });
            return;
        }
        const data = await service.me(userId);
        if (context?.activeBranchId) {
            data.branchId = context.activeBranchId;
        }
        if (Array.isArray(context?.allowedBranchIds)) {
            data.allowedBranchIds = context.allowedBranchIds;
        }
        res.json({ success: true, data });
    }));
    router.post('/refresh', asyncHandler(async (req, res) => {
        const payload = refreshSchema.parse(req.body);
        const data = await service.refresh({
            refreshToken: payload.refreshToken,
            branchId: payload.branchId,
            userAgent: req.headers['user-agent'],
            ipAddress: resolveIp(req),
        });
        res.json({ success: true, data });
    }));
    router.post('/logout', asyncHandler(async (req, res) => {
        const payload = logoutSchema.parse(req.body);
        const sessionId = req.requestUserContext?.sessionId;
        if (sessionId) {
            await service.logoutBySession(sessionId);
        }
        if (payload?.refreshToken) {
            await service.logoutByRefreshToken(payload.refreshToken);
        }
        res.json({ success: true });
    }));
    return router;
}
