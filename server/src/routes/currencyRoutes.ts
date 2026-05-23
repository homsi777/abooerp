import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { CurrencyRepository } from '../repositories/currencyRepository.js';
import { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const createSchema = z.object({
  code: z.string().min(3).max(3),
  name: z.string().min(1),
  symbol: z.string().optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  code: z.string().min(3).max(3).optional(),
  name: z.string().min(1).optional(),
  symbol: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createCurrencyRouter(currencyRepository: CurrencyRepository, exchangeRateRepository: ExchangeRateRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['settings.currencies.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const rows = await currencyRepository.listCurrencies(companyId);
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/',
    requirePermissions(['settings.currencies.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = createSchema.parse(req.body);
      const created = await currencyRepository.createCurrency(companyId, payload);
      auditService.logAsync({
        req,
        action: 'CURRENCY_CREATED',
        entityType: 'currency',
        entityId: created.id,
        metadata: {
          code: created.code,
          name: created.name,
          isBase: created.is_base,
        },
      });
      res.status(201).json({ success: true, data: created });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['settings.currencies.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = updateSchema.parse(req.body);
      const updated = await currencyRepository.updateCurrency(String(req.params.id), companyId, payload);
      if (!updated) {
        res.status(404).json({ success: false, error: 'Currency not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'CURRENCY_UPDATED',
        entityType: 'currency',
        entityId: String(req.params.id),
        metadata: {
          changedFields: Object.keys(payload),
          code: updated.code,
        },
      });
      res.json({ success: true, data: updated });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['settings.currencies.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const ok = await currencyRepository.deactivateCurrency(String(req.params.id), companyId);
      if (!ok) {
        res.status(404).json({ success: false, error: 'Currency not found or cannot deactivate base currency.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'CURRENCY_UPDATED',
        entityType: 'currency',
        entityId: String(req.params.id),
        metadata: {
          operation: 'deactivate',
        },
      });
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/set-base',
    requirePermissions(['settings.currencies.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const currencyId = String(req.params.id);
      const base = await currencyRepository.setBaseCurrency(currencyId, companyId);
      if (!base) {
        res.status(404).json({ success: false, error: 'Currency not found.' });
        return;
      }
      // Base currency must always have rate 1 at least for today.
      await exchangeRateRepository.setExchangeRate(base.id, 1, new Date().toISOString().slice(0, 10), companyId);
      auditService.logAsync({
        req,
        action: 'BASE_CURRENCY_CHANGED',
        entityType: 'currency',
        entityId: base.id,
        metadata: {
          currencyCode: base.code,
        },
      });
      res.json({ success: true, data: base });
    }),
  );

  return router;
}
