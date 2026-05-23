import type { NextFunction, Request, Response } from 'express';
import { LicenseRepository } from '../repositories/licenseRepository.js';

export type LicenseResource = 'shipment' | 'delivery' | 'receipt';

const licenseRepo = new LicenseRepository();

/**
 * Middleware that enforces license quotas for TEST licenses.
 * LOCAL licenses (LOC1/2/3) have no limits.
 * If no license is found for the company, the request is allowed through
 * (backwards-compatible behaviour during pilot onboarding).
 */
export function licenseGuard(resource: LicenseResource) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = (req as any).requestUserContext?.companyId as string | undefined;
      if (!companyId) return next(); // no company scope — route handler will catch it

      const license = await licenseRepo.findActiveByCompany(companyId);
      if (!license) return next(); // no license row — allow (pilot compatibility)

      const limitMap: Record<LicenseResource, number | null> = {
        shipment: license.shipmentLimit,
        delivery: license.deliveryLimit,
        receipt:  license.receiptLimit,
      };

      const limit = limitMap[resource];
      if (limit == null) return next(); // unlimited (LOCAL licenses)

      const usage = await licenseRepo.getUsage(companyId);
      const usedMap: Record<LicenseResource, number> = {
        shipment: usage.shipmentsUsed,
        delivery: usage.deliveriesUsed,
        receipt:  usage.receiptsUsed,
      };

      if (usedMap[resource] >= limit) {
        res.status(403).json({
          success: false,
          error: 'LICENSE_LIMIT_REACHED',
          code: 'LICENSE_LIMIT_REACHED',
          details: {
            resource,
            limit,
            used: usedMap[resource],
            licenseType: license.licenseType,
          },
        });
        return;
      }

      next();
    } catch {
      // Never block a request because of a license-check failure
      next();
    }
  };
}
