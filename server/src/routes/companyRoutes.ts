import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { CompanyRepository } from '../repositories/companyRepository.js';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  logo_data_url: z.string().nullable().optional(),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createCompanyRouter(repository: CompanyRepository) {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['settings.system.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const row = await repository.getById(companyId);
      if (!row) {
        res.status(404).json({ success: false, error: 'Company not found.' });
        return;
      }
      res.json({ success: true, data: row });
    }),
  );

  router.put(
    '/',
    requirePermissions(['settings.system.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = updateSchema.parse(req.body ?? {});
      const updated = await repository.update(companyId, payload);
      if (!updated) {
        res.status(404).json({ success: false, error: 'Company not found.' });
        return;
      }
      res.json({ success: true, data: updated });
    }),
  );

  return router;
}
