import { pool } from '../db/pool.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { loadUserContextByUserId } from '../auth/userContext.js';
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function validateActiveCompanyBranch(branchId, companyId) {
    const result = await pool.query(`
    select 1
    from branches
    where id = $1
      and company_id = $2
      and is_active = true
    limit 1
    `, [branchId, companyId]);
    return (result.rowCount ?? 0) > 0;
}
export async function requestContextMiddleware(req, res, next) {
    const requestedBranchHeader = req.headers['x-branch-id'];
    const requestedBranchId = Array.isArray(requestedBranchHeader) ? requestedBranchHeader[0] : requestedBranchHeader;
    if (requestedBranchId && !uuidRegex.test(requestedBranchId)) {
        res.status(400).json({ success: false, error: 'Invalid x-branch-id header format.' });
        return;
    }
    const authorization = req.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    if (bearerToken) {
        try {
            const payload = verifyAccessToken(bearerToken);
            const context = await loadUserContextByUserId(payload.sub);
            if (!context || context.status !== 'active') {
                res.status(401).json({ success: false, error: 'Authentication required.' });
                return;
            }
            const sessionResult = await pool.query(`
        select id
        from auth_sessions
        where id = $1
          and user_id = $2
          and revoked_at is null
          and expires_at > now()
        limit 1
        `, [payload.sid, payload.sub]);
            if (!sessionResult.rowCount) {
                res.status(401).json({ success: false, error: 'Session expired or revoked.' });
                return;
            }
            const tokenBranchId = payload.branchId;
            const fallbackBranchId = tokenBranchId ?? context.scope.branchId ?? context.allowedBranchIds[0];
            const effectiveBranchId = requestedBranchId ?? fallbackBranchId;
            if (effectiveBranchId && !context.allowedBranchIds.includes(effectiveBranchId)) {
                res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
                return;
            }
            if (effectiveBranchId) {
                const isValidBranch = await validateActiveCompanyBranch(effectiveBranchId, context.companyId);
                if (!isValidBranch) {
                    res.status(403).json({ success: false, error: 'Requested branch is inactive or outside company scope.' });
                    return;
                }
            }
            const enriched = {
                ...context,
                sessionId: payload.sid,
                activeBranchId: effectiveBranchId,
                scope: {
                    ...context.scope,
                    branchId: effectiveBranchId,
                },
            };
            req.requestUserContext = enriched;
            req.requestScope = enriched.scope;
            req.requestContext = {
                ...enriched.scope,
                companyId: enriched.companyId,
                baseCurrency: enriched.baseCurrency,
            };
            next();
            return;
        }
        catch {
            res.status(401).json({ success: false, error: 'Invalid or expired access token.' });
            return;
        }
    }
    const userIdHeader = req.headers['x-user-id'];
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
        next();
        return;
    }
    if (!uuidRegex.test(userId)) {
        res.status(400).json({ success: false, error: 'Invalid x-user-id header format.' });
        return;
    }
    const context = await loadUserContextByUserId(userId);
    if (!context) {
        res.status(401).json({ success: false, error: 'User context not found for provided x-user-id.' });
        return;
    }
    if (context.status !== 'active') {
        res.status(403).json({ success: false, error: `User is not active (${context.status}).` });
        return;
    }
    const effectiveBranchId = requestedBranchId ?? context.scope.branchId ?? context.allowedBranchIds[0];
    if (effectiveBranchId && !context.allowedBranchIds.includes(effectiveBranchId)) {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
    }
    if (effectiveBranchId) {
        const isValidBranch = await validateActiveCompanyBranch(effectiveBranchId, context.companyId);
        if (!isValidBranch) {
            res.status(403).json({ success: false, error: 'Requested branch is inactive or outside company scope.' });
            return;
        }
    }
    const enriched = {
        ...context,
        activeBranchId: effectiveBranchId,
        scope: {
            ...context.scope,
            branchId: effectiveBranchId,
        },
    };
    req.requestUserContext = enriched;
    req.requestScope = enriched.scope;
    req.requestContext = {
        ...enriched.scope,
        companyId: enriched.companyId,
        baseCurrency: enriched.baseCurrency,
    };
    next();
}
