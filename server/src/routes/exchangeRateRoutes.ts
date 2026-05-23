import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { CurrencyRepository } from '../repositories/currencyRepository.js';
import { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const createSchema = z.object({
  currencyId: z.string().uuid(),
  rate: z.coerce.number().positive(),
  effectiveDate: z.string().min(10),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createExchangeRateRouter(exchangeRateRepository: ExchangeRateRepository, currencyRepository: CurrencyRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['settings.exchangeRates.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const currencyId = typeof req.query.currencyId === 'string' ? req.query.currencyId : undefined;
      const rows = await exchangeRateRepository.listExchangeRates(companyId, currencyId);
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/',
    requirePermissions(['settings.exchangeRates.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = createSchema.parse(req.body);
      const currency = await currencyRepository.getCurrencyById(payload.currencyId, companyId);
      if (!currency) {
        throw new HttpError(404, 'Currency not found for this company.');
      }
      const previousRate = await exchangeRateRepository.getRateByDate(payload.currencyId, payload.effectiveDate, companyId);
      const normalizedRate = currency.is_base ? 1 : payload.rate;
      const row = await exchangeRateRepository.setExchangeRate(payload.currencyId, normalizedRate, payload.effectiveDate, companyId);
      auditService.logAsync({
        req,
        action: previousRate ? 'EXCHANGE_RATE_UPDATED' : 'EXCHANGE_RATE_SET',
        entityType: 'exchange_rate',
        entityId: row.id,
        metadata: {
          currencyCode: row.currency_code,
          previousRate: previousRate?.rate,
          newRate: row.rate,
          effectiveDate: row.effective_date,
        },
      });
      res.status(201).json({ success: true, data: row });
    }),
  );

  router.get(
    '/:currencyId/history',
    requirePermissions(['settings.exchangeRates.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const currencyId = String(req.params.currencyId);
      const currency = await currencyRepository.getCurrencyById(currencyId, companyId);
      if (!currency) {
        res.status(404).json({ success: false, error: 'Currency not found for this company.' });
        return;
      }
      const rows = await exchangeRateRepository.listExchangeRates(companyId, currencyId);
      res.json({ success: true, data: rows });
    }),
  );

  return router;
}
