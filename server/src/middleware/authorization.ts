import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AuditService } from '../services/auditService.js';

interface RoleGuardOptions {
  requireAuth?: boolean;
}

function getRoleCode(req: Request): string | undefined {
  return (req as any).requestUserContext?.roleCode as string | undefined;
}

function getPermissions(req: Request): string[] {
  return ((req as any).requestUserContext?.permissions as string[] | undefined) ?? [];
}

function getUserType(req: Request): string | undefined {
  return (req as any).requestUserContext?.userType as string | undefined;
}

function hasUserContext(req: Request): boolean {
  return Boolean((req as any).requestUserContext?.userId);
}

const auditService = new AuditService();

function auditForbidden(req: Request, metadata: Record<string, unknown>) {
  auditService.logAsync({
    req,
    action: 'FORBIDDEN_ACCESS',
    entityType: 'authorization',
    metadata: {
      path: req.originalUrl,
      method: req.method,
      ...metadata,
    },
  });
}

export function requireRoles(allowedRoles: string[], options: RoleGuardOptions = {}) {
  const allowed = new Set(allowedRoles);

  return (req: Request, res: Response, next: NextFunction) => {
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
      auditForbidden(req, {
        reason: 'role_not_allowed',
        roleCode: roleCode ?? 'unknown',
        allowedRoles,
      });
      res.status(403).json({
        success: false,
        error: `Role '${roleCode ?? 'unknown'}' is not allowed for this action.`,
      });
      return;
    }

    next();
  };
}

/** Permissions an agent user may ever be required to present (Phase 2A.10 mini-ERP). */
const AGENT_SCOPED_WHITELIST = new Set([
  'agent_workspace.view',
  'agent_portal.view',
  'agent_portal.status_action',
  'shipments.view',
  'shipments.read',
  'shipments.write',
  'shipments.create',
  'shipments.update',
  'shipments.confirm',
  'shipments.handover_driver',
  'shipments.handover_agent',
  'shipments.agent_received',
  'shipments.mark_in_transit',
  'shipments.mark_arrived',
  'shipments.out_for_delivery',
  'shipments.deliver',
  'shipments.cancel',
  'deliveries.read',
  'deliveries.write',
  'parties.view',
  'parties.manage',
  'drivers.view',
  'vehicles.view',
  'finance.read',
  'finance.view',
  'finance.write',
  'finance.vouchers.create',
  'finance.vouchers.view',
  'finance.vouchers.read',
  'finance.vouchers.write',
  'finance.vouchers.manage',
  'finance.cashbox.read',
  'finance.cashbox.write',
  'finance.cashboxes.view',
  'finance.cashboxes.manage',
  'finance.cashboxes.movements.view',
  'manifests.read',
  'shipping.label.read',
]);

export function requirePermissions(requiredPermissions: string[], options: RoleGuardOptions = {}) {
  const required = new Set(requiredPermissions);

  return (req: Request, res: Response, next: NextFunction) => {
    const authenticated = hasUserContext(req);
    const roleCode = getRoleCode(req);
    const userType = getUserType(req);
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

    if (userType === 'agent') {
      const notAllowedForAgentRole = [...required].filter((permission) => !AGENT_SCOPED_WHITELIST.has(permission));
      if (notAllowedForAgentRole.length > 0) {
        auditForbidden(req, {
          reason: 'agent_user_admin_permission_blocked',
          roleCode: roleCode ?? 'unknown',
          userType,
          requiredPermissions: [...required],
        });
        res.status(403).json({
          success: false,
          error: 'مستخدم الوكيل لا يملك صلاحية الوصول إلى هذه العملية.',
        });
        return;
      }
      const missing = [...required].filter((permission) => !permissions.has(permission));
      if (missing.length > 0) {
        auditForbidden(req, {
          reason: 'missing_permissions',
          roleCode: roleCode ?? 'unknown',
          userType,
          missing,
        });
        res.status(403).json({
          success: false,
          error: `مستخدم الوكيل يفتقد صلاحيات: ${missing.join(', ')}`,
        });
        return;
      }
      next();
      return;
    }

    const missing = [...required].filter((permission) => !permissions.has(permission));
    if (missing.length > 0) {
      auditForbidden(req, {
        reason: 'missing_permissions',
        roleCode: roleCode ?? 'unknown',
        missing,
      });
      res.status(403).json({
        success: false,
        error: `Role '${roleCode ?? 'unknown'}' lacks required permissions: ${missing.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/** At least one of the listed permissions (OR). Respects agent scoped whitelist. */
export function requireAnyPermissions(
  alternativePermissions: string[],
  options: RoleGuardOptions = {},
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authenticated = hasUserContext(req);
    const roleCode = getRoleCode(req);
    const userType = getUserType(req);
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

    if (userType === 'agent') {
      const allowedAlts = alternativePermissions.filter((p) => AGENT_SCOPED_WHITELIST.has(p));
      if (allowedAlts.length === 0) {
        auditForbidden(req, {
          reason: 'agent_user_admin_permission_blocked',
          roleCode: roleCode ?? 'unknown',
          userType,
          requiredAny: alternativePermissions,
        });
        res.status(403).json({ success: false, error: 'مستخدم الوكيل لا يملك صلاحية الوصول إلى هذه العملية.' });
        return;
      }
      const hasOne = allowedAlts.some((p) => permissions.has(p));
      if (!hasOne) {
        auditForbidden(req, {
          reason: 'missing_permissions_any',
          roleCode: roleCode ?? 'unknown',
          userType,
          missingAny: allowedAlts,
        });
        res.status(403).json({
          success: false,
          error: `مستخدم الوكيل يفتقد إحدى الصلاحيات: ${allowedAlts.join(', ')}`,
        });
        return;
      }
      next();
      return;
    }

    const hasOne = alternativePermissions.some((p) => permissions.has(p));
    if (!hasOne) {
      auditForbidden(req, {
        reason: 'missing_permissions_any',
        roleCode: roleCode ?? 'unknown',
        missingAny: alternativePermissions,
      });
      res.status(403).json({
        success: false,
        error: `Role '${roleCode ?? 'unknown'}' needs one of: ${alternativePermissions.join(', ')}`,
      });
      return;
    }

    next();
  };
}

export function forbidUserTypes(forbiddenTypes: string[], messageAr: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ut = getUserType(req);
    if (ut && forbiddenTypes.includes(ut)) {
      auditForbidden(req, {
        reason: 'user_type_forbidden',
        userType: ut,
      });
      res.status(403).json({ success: false, error: messageAr });
      return;
    }
    next();
  };
}
