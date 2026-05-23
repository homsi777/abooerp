import { z } from 'zod';
export const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Invalid currency code.');
export const moneySchema = z.object({
    originalAmount: z.coerce.number(),
    originalCurrency: currencyCodeSchema,
    exchangeRateToUsd: z.coerce.number().positive(),
    baseAmountUsd: z.coerce.number(),
});
export function computeBaseAmountUsd(originalAmount, exchangeRateToUsd) {
    return Number((originalAmount * exchangeRateToUsd).toFixed(2));
}
