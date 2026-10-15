/**
 * Tiny, dependency-free mirror of the server's computeLineTotal/decimal
 * helpers (server/src/services/goodsPricing/resolve.ts) — used ONLY to
 * recompute the line total instantly client-side after the server/resolve
 * endpoint has already supplied unitPriceUsd + unit. The group/VIP matching
 * logic itself stays server-only (it needs the full goods_types/parties
 * datasets); this file never re-implements that part.
 *
 * Kept numerically identical to the server version so the displayed total
 * always matches what gets saved. See goodsPricingTotal.selftest.ts.
 */

export type PricingUnit = 'parcel' | 'kg';

export function decimalToHundredths(value: string | number): bigint {
  const str = typeof value === 'number' ? normalizeNumberInput(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`invalid non-negative amount (max 2 decimals): ${String(value)}`);
  }
  const [intPart, fracPartRaw] = str.split('.');
  const fracPart = (fracPartRaw ?? '').padEnd(2, '0').slice(0, 2);
  return BigInt(intPart) * 100n + BigInt(fracPart || '0');
}

function normalizeNumberInput(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`invalid amount: ${value}`);
  return value.toFixed(2);
}

export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const s = `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

export function computeLineTotal(
  unit: PricingUnit,
  parcelCount: number | null | undefined,
  weightKg: string | number | null | undefined,
  unitPriceUsd: string | number | null | undefined,
): string | null {
  if (unitPriceUsd == null || unitPriceUsd === '') return null;
  let quantityHundredths: bigint;
  if (unit === 'parcel') {
    if (parcelCount == null) return null;
    if (!Number.isInteger(parcelCount) || parcelCount < 0) return null;
    quantityHundredths = BigInt(parcelCount) * 100n;
  } else {
    if (weightKg == null || weightKg === '') return null;
    try {
      quantityHundredths = decimalToHundredths(weightKg);
    } catch {
      return null;
    }
  }
  let priceCents: bigint;
  try {
    priceCents = decimalToHundredths(unitPriceUsd);
  } catch {
    return null;
  }
  const product = quantityHundredths * priceCents;
  const totalCents = (product + 50n) / 100n;
  return centsToDecimalString(totalCents);
}
