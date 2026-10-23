import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermissions, requirePermissions } from '../middleware/authorization.js';
import { UserRepository } from '../repositories/userRepository.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const emptyToNull = (value: unknown) => (value === '' ? null : value);

const createUserSchema = z.object({
  username: z.string().trim().min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل.'),
  full_name: z.string().trim().min(1, 'الاسم الكامل مطلوب.'),
  email: z.preprocess(emptyToUndefined, z.string().email('البريد الإلكتروني غير صالح.').optional()),
  phone: z.preprocess(emptyToUndefined, z.string().optional()),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'),
  role_id: z.string().uuid('الدور المحدد غير صالح.'),
  user_type: z.enum(['admin', 'employee', 'agent', 'accountant', 'branch_supervisor', 'delivery', 'viewer']).optional(),
  agent_id: z.preprocess(emptyToNull, z.string().uuid('الوكيل المحدد غير صالح.').nullable().optional()),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
  is_active: z.boolean().optional(),
  branch_ids: z.array(z.string().uuid('أحد الفروع المحددة غير صالح.')).optional().default([]),
});

const updateUserSchema = z.object({
  username: z.string().trim().min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل.').optional(),
  full_name: z.string().trim().min(1, 'الاسم الكامل مطلوب.').optional(),
  email: z.preprocess(emptyToNull, z.string().email('البريد الإلكتروني غير صالح.').nullable().optional()),
  phone: z.preprocess(emptyToNull, z.string().nullable().optional()),
  password: z.preprocess(emptyToUndefined, z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.').optional()),
  role_id: z.string().uuid('الدور المحدد غير صالح.').optional(),
  user_type: z.enum(['admin', 'employee', 'agent', 'accountant', 'branch_supervisor', 'delivery', 'viewer']).optional(),
  agent_id: z.preprocess(emptyToNull, z.string().uuid('الوكيل المحدد غير صالح.').nullable().optional()),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
  is_active: z.boolean().optional(),
});

const assignBranchesSchema = z.object({
  branchIds: z.array(z.string().uuid()),
});

const accessScopeSchema = z.object({
  role_id: z.string().uuid().optional(),
  user_type: z.enum(['admin', 'employee', 'agent', 'accountant', 'branch_supervisor', 'delivery', 'viewer']).optional(),
  agent_id: z.string().uuid().nullable().optional(),
  branchIds: z.array(z.string().uuid()).default([]),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

function parsePayload<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new HttpError(400, firstIssue?.message || 'بيانات الطلب غير مكتملة أو غير صحيحة.');
  }
  return parsed.data;
}

/**
 * Accountants and branch supervisors can create/edit users too, but only
 * "مدخل بيانات — تطبيق أندرويد" (data_entry_mobile — the narrow-permission
 * role meant for the tablet app) within their own branch — not the broad
 * desktop "مدخل بيانات" (data_entry) role, which stays admin-only. They
 * don't have full settings.users.write, only the narrower
 * settings.users.manage_data_entry. This enforces that narrower scope
 * server-side (not just hidden in the UI) whenever the requester lacks the
 * full permission. Throws if the attempted role/branch/user_type falls
 * outside what they're allowed to touch.
 */
async function enforceDataEntryScopeIfRestricted(
  req: any,
  repository: UserRepository,
  attempt: { roleId?: string; branchIds?: string[]; userType?: string },
): Promise<void> {
  const permissions: string[] = req.requestUserContext?.permissions ?? [];
  if (permissions.includes('settings.users.write')) return; // full power, no restriction

  if (attempt.roleId) {
    const roleCode = await repository.getRoleCodeById(attempt.roleId);
    if (roleCode !== 'data_entry_mobile') {
      throw new HttpError(403, 'يمكنك فقط إنشاء أو تعديل حسابات "مدخل بيانات — تطبيق أندرويد" — لا تملكين صلاحية إدارة أنواع حسابات أخرى.');
    }
  }
  if (attempt.userType && attempt.userType !== 'employee') {
    throw new HttpError(403, 'يمكنك فقط إنشاء أو تعديل حسابات "مدخل بيانات — تطبيق أندرويد".');
  }
  if (attempt.branchIds) {
    const allowedBranchIds: string[] = req.requestUserContext?.allowedBranchIds ?? [];
    const allowedSet = new Set(allowedBranchIds);
    if (attempt.branchIds.length === 0 || attempt.branchIds.some((id) => !allowedSet.has(id))) {
      throw new HttpError(403, 'يمكنك فقط إنشاء أو تعديل حسابات ضمن فرعك المخوَّل.');
    }
  }
}

export function createUserRouter(repository: UserRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requireAnyPermissions(['settings.users.read', 'settings.users.manage_data_entry']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const users = await repository.listUsers(companyId);
      const permissions: string[] = (req as any).requestUserContext?.permissions ?? [];
      if (permissions.includes('settings.users.write') || permissions.includes('settings.users.read')) {
        res.json({ success: true, data: users });
        return;
      }
      // Restricted viewer (manage_data_entry only, no settings.users.read):
      // only ever see data_entry accounts within their own branch — not
      // every employee/admin in the company.
      const allowedBranchIds: string[] = (req as any).requestUserContext?.allowedBranchIds ?? [];
      const allowedSet = new Set(allowedBranchIds);
      const scoped = users.filter(
        (u: any) => u.role_code === 'data_entry_mobile' && (u.branch_ids ?? []).some((b: string) => allowedSet.has(b)),
      );
      res.json({ success: true, data: scoped });
    }),
  );

  router.post(
    '/',
    requireAnyPermissions(['settings.users.write', 'settings.users.manage_data_entry']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = parsePayload(createUserSchema, req.body);

      if (payload.user_type === 'agent' && !payload.agent_id) {
        throw new HttpError(400, 'هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل.');
      }
      if (payload.user_type !== 'admin' && payload.branch_ids.length === 0) {
        throw new HttpError(400, 'يجب تحديد فرع واحد على الأقل للمستخدم غير الإداري.');
      }
      await enforceDataEntryScopeIfRestricted(req, repository, {
        roleId: payload.role_id,
        branchIds: payload.branch_ids,
        userType: payload.user_type,
      });

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
        user_type: payload.user_type,
        agent_id: payload.agent_id,
        status: payload.status,
        is_active: payload.is_active ?? (payload.status !== 'inactive' && payload.status !== 'locked'),
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
    }),
  );

  router.put(
    '/:id',
    requireAnyPermissions(['settings.users.write', 'settings.users.manage_data_entry']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = parsePayload(updateUserSchema, req.body);
      const targetId = String(req.params.id);

      const permissions: string[] = (req as any).requestUserContext?.permissions ?? [];
      if (!permissions.includes('settings.users.write')) {
        // Restricted manager: the TARGET user (as it stands today) must
        // already be a data_entry account within their branch — checked
        // regardless of what this particular payload changes, so they
        // can't reuse this endpoint to touch an admin/accountant account
        // just because this request happens not to include role_id.
        const existing = await repository.getUserById(targetId, companyId);
        if (!existing) {
          res.status(404).json({ success: false, error: 'User not found.' });
          return;
        }
        await enforceDataEntryScopeIfRestricted(req, repository, {
          roleId: (existing as any).role_id,
          branchIds: (existing as any).branch_ids ?? [],
          userType: (existing as any).user_type,
        });
        await enforceDataEntryScopeIfRestricted(req, repository, {
          roleId: payload.role_id,
          userType: payload.user_type,
        });
      }

      if (payload.role_id) {
        const roleAllowed = await repository.isRoleAllowedForCompany(payload.role_id, companyId);
        if (!roleAllowed) {
          throw new HttpError(403, 'Role is not allowed for your company scope.');
        }
      }

      const data = await repository.updateUser(targetId, companyId, {
        username: payload.username,
        full_name: payload.full_name,
        email: payload.email,
        phone: payload.phone,
        password_hash: payload.password ? await bcrypt.hash(payload.password, 12) : undefined,
        role_id: payload.role_id,
        user_type: payload.user_type,
        agent_id: payload.agent_id,
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
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['settings.users.write']),
    asyncHandler(async (req, res) => {
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
    }),
  );

  router.post(
    '/:id/access-scope',
    requireAnyPermissions(['settings.users.write', 'settings.users.manage_data_entry']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = parsePayload(accessScopeSchema, req.body);
      const targetUserId = String(req.params.id);
      const user = await repository.getUserById(targetUserId, companyId);
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found.' });
        return;
      }

      const permissions: string[] = (req as any).requestUserContext?.permissions ?? [];
      if (!permissions.includes('settings.users.write')) {
        // Same rule as PUT /:id: the existing account must already be
        // data_entry within their branch, and whatever they're changing it
        // to must stay within that same restriction.
        await enforceDataEntryScopeIfRestricted(req, repository, {
          roleId: (user as any).role_id,
          branchIds: (user as any).branch_ids ?? [],
          userType: (user as any).user_type,
        });
        await enforceDataEntryScopeIfRestricted(req, repository, {
          roleId: payload.role_id,
          branchIds: payload.branchIds,
          userType: payload.user_type,
        });
      }

      const nextUserType = payload.user_type ?? user.user_type;
      const nextAgentId = typeof payload.agent_id === 'undefined' ? user.agent_id : payload.agent_id;
      if (nextUserType === 'agent' && !nextAgentId) {
        throw new HttpError(400, 'هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل.');
      }
      if (nextUserType !== 'admin' && payload.branchIds.length === 0) {
        throw new HttpError(400, 'يجب تحديد فرع واحد على الأقل للمستخدم غير الإداري.');
      }
      const data = await repository.setAccessScope(targetUserId, companyId, {
        role_id: payload.role_id,
        user_type: payload.user_type,
        agent_id: payload.agent_id,
        branch_ids: payload.branchIds,
      });
      auditService.logAsync({
        req,
        action: 'USER_SCOPE_UPDATED',
        entityType: 'user',
        entityId: targetUserId,
        metadata: {
          roleId: payload.role_id,
          userType: payload.user_type,
          agentId: payload.agent_id,
          branchIds: payload.branchIds,
        },
      });
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/:id/branches',
    requirePermissions(['settings.users.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = parsePayload(assignBranchesSchema, req.body);
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
    }),
  );

  return router;
}
