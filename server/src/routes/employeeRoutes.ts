import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import type { EmployeeRepository } from '../repositories/employeeRepository.js';

const createSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  position: z.string().optional(),
  basicSalary: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  salaryType: z.enum(['monthly', 'weekly']).optional(),
  hireDate: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

export function createEmployeeRouter(repository: EmployeeRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['hr.employees.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
      const data = await repository.list(companyId, includeInactive);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['hr.employees.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.getById(String(req.params.id), companyId);
      if (!data) throw new HttpError(404, 'Employee not found.');
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/',
    requirePermissions(['hr.employees.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = createSchema.parse(req.body);
      let data;
      try {
        data = await repository.create({ ...body, companyId });
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new HttpError(409, `رمز الموظف '${body.code}' مستخدم مسبقاً في هذه الشركة.`);
        }
        throw err;
      }
      auditService.logAsync({ req, action: 'EMPLOYEE_CREATED', entityType: 'employee', entityId: data.id, metadata: { code: data.code, name: data.name } });
      res.status(201).json({ success: true, data });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['hr.employees.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = updateSchema.parse(req.body);
      const data = await repository.update(String(req.params.id), companyId, body);
      if (!data) throw new HttpError(404, 'Employee not found.');
      auditService.logAsync({ req, action: 'EMPLOYEE_UPDATED', entityType: 'employee', entityId: data.id, metadata: { changedFields: Object.keys(body) } });
      res.json({ success: true, data });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['hr.employees.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repository.remove(String(req.params.id), companyId);
      if (!removed) throw new HttpError(404, 'Employee not found.');
      auditService.logAsync({ req, action: 'EMPLOYEE_DELETED', entityType: 'employee', entityId: String(req.params.id) });
      res.json({ success: true });
    }),
  );

  return router;
}
