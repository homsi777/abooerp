/**
 * Pure, DB-free goods-pricing resolution logic. No imports from pg/pool/etc.
 * Used identically by the server (authoritative) and the ledger UI (instant
 * local preview) so the displayed total always matches what the server
 * will store. See server/src/services/goodsPricing/resolve.selftest.ts.
 */

export type PricingUnit = 'parcel' | 'kg';
export type PriceSource = 'party' | 'general';
export type ResolveStatus = 'priced' | 'no_group' | 'no_price' | 'conflict';

export interface ResolveInput {
  parcelTypeNorm: string;
  senderNorm: string;
  receiverNorm: string;
}

export interface GroupPrice {
  unit: PricingUnit;
  unitPriceCents: bigint;
}

export interface ResolveContext {
  /** normalized goods_types.name -> pricing group id */
  typeToGroup: Map<string, string>;
  /** group id -> active general price */
  generalByGroup: Map<string, GroupPrice>;
  /** normalized senders_receivers.full_name -> party id(s). 2+ entries = ambiguous. */
  partyIdsByName: Map<string, string[]>;
  /** `${partyId}:${groupId}` -> active VIP price */
  partyPrices: Map<string, GroupPrice>;
}

export interface ResolveResult {
  status: ResolveStatus;
  groupId?: string;
  partyId?: string;
  unit?: PricingUnit;
  unitPriceCents?: bigint;
  source?: PriceSource;
  senderAmbiguous: boolean;
  receiverAmbiguous: boolean;
}

function identifyParty(nameNorm: string, ctx: ResolveContext): { partyId?: string; ambiguous: boolean } {
  if (!nameNorm) return { ambiguous: false };
  const matches = ctx.partyIdsByName.get(nameNorm);
  if (!matches || matches.length === 0) return { ambiguous: false };
  if (matches.length > 1) return { ambiguous: true };
  return { partyId: matches[0], ambiguous: false };
}

function vipPriceFor(partyId: string | undefined, groupId: string, ctx: ResolveContext): GroupPrice | undefined {
  if (!partyId) return undefined;
  return ctx.partyPrices.get(`${partyId}:${groupId}`);
}

export function resolvePrice(input: ResolveInput, ctx: ResolveContext): ResolveResult {
  const groupId = ctx.typeToGroup.get(input.parcelTypeNorm);
  if (!groupId) {
    return { status: 'no_group', senderAmbiguous: false, receiverAmbiguous: false };
  }

  const sender = identifyParty(input.senderNorm, ctx);
  const receiver = identifyParty(input.receiverNorm, ctx);

  const senderVip = vipPriceFor(sender.partyId, groupId, ctx);
  const receiverVip = vipPriceFor(receiver.partyId, groupId, ctx);

  const base = { groupId, senderAmbiguous: sender.ambiguous, receiverAmbiguous: receiver.ambiguous };

  if (senderVip && receiverVip) {
    // Both sides VIP for this group — including the same person resolved on
    // both sides. Never guess; the employee enters the price manually.
    return { status: 'conflict', ...base };
  }

  if (senderVip && sender.partyId) {
    return { status: 'priced', ...base, partyId: sender.partyId, unit: senderVip.unit, unitPriceCents: senderVip.unitPriceCents, source: 'party' };
  }
  if (receiverVip && receiver.partyId) {
    return { status: 'priced', ...base, partyId: receiver.partyId, unit: receiverVip.unit, unitPriceCents: receiverVip.unitPriceCents, source: 'party' };
  }

  const general = ctx.generalByGroup.get(groupId);
  if (general) {
    return { status: 'priced', ...base, unit: general.unit, unitPriceCents: general.unitPriceCents, source: 'general' };
  }

  return { status: 'no_price', ...base };
}

/**
 * Parses a non-negative amount with at most 2 decimal places (string or
 * number) into hundredths, exactly — no floating-point multiplication.
 * Throws on negative, NaN, or more than 2 decimals.
 */
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

export function decimalStringToCents(value: string | number): bigint {
  return decimalToHundredths(value);
}

export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const s = `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

/**
 * line_total = ROUND(quantity * unit_price, 2), computed with integer
 * (BigInt) arithmetic only — never floats — so the server and the UI
 * preview always agree, and the result matches PostgreSQL's
 * ROUND(numeric, 2) (round-half-up for non-negative inputs).
 *
 * Returns null when the quantity required by `unit` is not available
 * (parcel_count for 'parcel', weight_kg for 'kg') or when unitPriceCents is
 * undefined — the row simply has no computed total, exactly like today.
 */
export function computeLineTotal(
  unit: PricingUnit,
  parcelCount: number | null | undefined,
  weightKg: string | number | null | undefined,
  unitPriceCents: bigint | undefined,
): bigint | null {
  if (unitPriceCents == null) return null;

  let quantityHundredths: bigint;
  if (unit === 'parcel') {
    if (parcelCount == null) return null;
    if (!Number.isInteger(parcelCount) || parcelCount < 0) {
      throw new Error(`invalid parcel_count: ${parcelCount}`);
    }
    quantityHundredths = BigInt(parcelCount) * 100n;
  } else {
    if (weightKg == null || weightKg === '') return null;
    quantityHundredths = decimalToHundredths(weightKg);
  }

  const product = quantityHundredths * unitPriceCents;
  return (product + 50n) / 100n;
}
