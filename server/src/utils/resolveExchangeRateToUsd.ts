import type { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import { HttpError } from './errors.js';

/**
 * 1 وحدة من العملة الأصلية → مضاعف USD (مثل exchange_rates.rate في النظام: SYP × rate = USD).
 */
export async function resolveExchangeRateToUsd(
  exchangeRepo: ExchangeRateRepository,
  companyId: string,
  currencyCode: string,
  effectiveDateIso: string,
): Promise<number> {
  const code = String(currencyCode || 'USD').trim().toUpperCase();
  if (!code) throw new HttpError(400, 'currency is required.');
  if (code === 'USD') return 1;

  const date = effectiveDateIso.slice(0, 10);
  const byDate = await exchangeRepo.getRateByDateByCode(code, date, companyId);
  if (byDate && byDate.rate > 0) return Number(byDate.rate);

  const latest = await exchangeRepo.getLatestRateByCode(code, companyId);
  if (latest && latest.rate > 0) return Number(latest.rate);

  throw new HttpError(
    400,
    `لا يوجد سعر صرف مسجّل للعملة ${code}. أضف سعراً في الإعدادات ← العملات وأسعار الصرف.`,
  );
}
