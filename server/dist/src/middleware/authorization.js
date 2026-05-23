import { env } from '../config/env.js';
function getRoleCode(req) {
    return req.requestUserContext?.roleCode;
}
function getPermissions(req) {
    return req.requestUserContext?.permissions ?? [];
}
function hasUserContext(req) {
    return Boolean(req.requestUserContext?.userId);
}
export function requireRoles(allowedRoles, options = {}) {
    const allowed = new Set(allowedRoles);
    return (req, res, next) => {
        const authenticated = hasUserContext(req);
        const roleCode = getRoleCode(req);
        if (!authenticated) {
            const enforceAuth = options.requireAuth || env.AUTH_STRICT_RBAC;
            if (enforceAuth) {
                res.status(401).json({ success: false, error: 'Authentication required for this action.' });
                return;
            }
            // Compatibility mode for gradual rollout before full auth enablement.
            next();
            return;
        }
        if (!roleCode || !allowed.has(roleCode)) {
            res.status(403).json({
                success: false,
                error: `Role '${roleCode ?? 'unknown'}' is not allowed for this action.`,
            });
            return;
        }
        next();
    };
}
export function requirePermissions(requiredPermissions, options = {}) {
    const required = new Set(requiredPermissions);
    return (req, res, next) => {
        const authenticated = hasUserContext(req);
        const roleCode = getRoleCode(req);
        const permissions = new Set(getPermissions(req));
        if (!authenticated) {
            const enforceAuth = options.requireAuth || env.AUTH_STRICT_RBAC;
            if (enforceAuth) {
                res.status(401).json({ success: false, error: 'Authentication required for this action.' });
                return;
            }
            next();
            return;
        }
        const missing = [...required].filter((permission) => !permissions.has(permission));
        if (missing.length > 0) {
            res.status(403).json({
                success: false,
                error: `Role '${roleCode ?? 'unknown'}' lacks required permissions: ${missing.join(', ')}`,
            });
            return;
        }
        next();
    };
}
