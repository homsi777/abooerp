import { GoodsPricingRepository } from '../../repositories/goodsPricingRepository.js';
import { normalizeName } from '../dailyLedgerShipmentPostingService.js';
import { decimalStringToCents, type ResolveContext } from './resolve.js';

const TTL_MS = 30_000;

let cached: ResolveContext | null = null;
let cachedAt = 0;
let inflight: Promise<ResolveContext> | null = null;

/**
 * Builds the in-memory maps `resolvePrice` needs, matching EXACTLY the
 * matching semantics of ensureGoodsType/ensureSenderReceiver: normalizeName
 * (trim + collapse whitespace, no case change) then lower() for comparison.
 * Read-only — never creates goods_types or senders_receivers rows (unlike
 * ensureGoodsType/ensureSenderReceiver, which do).
 */
async function buildContext(repo: GoodsPricingRepository): Promise<ResolveContext> {
  const [typeRows, generalRows, partyPriceRows, partyNameRows] = await Promise.all([
    repo.loadTypeToGroupRows(),
    repo.loadGeneralPriceRows(),
    repo.loadPartyPriceRows(),
    repo.loadPartyNameRows(),
  ]);

  const typeToGroup = new Map<string, string>();
  for (const row of typeRows) {
    typeToGroup.set(normalizeName(row.name).toLowerCase(), row.group_id);
  }

  const generalByGroup = new Map<string, { unit: 'parcel' | 'kg'; unitPriceCents: bigint }>();
  for (const row of generalRows) {
    generalByGroup.set(row.group_id, { unit: row.pricing_unit, unitPriceCents: decimalStringToCents(row.unit_price_usd) });
  }

  const partyPrices = new Map<string, { unit: 'parcel' | 'kg'; unitPriceCents: bigint }>();
  for (const row of partyPriceRows) {
    partyPrices.set(`${row.party_id}:${row.group_id}`, {
      unit: row.pricing_unit,
      unitPriceCents: decimalStringToCents(row.unit_price_usd),
    });
  }

  const partyIdsByName = new Map<string, string[]>();
  for (const row of partyNameRows) {
    const key = normalizeName(row.full_name).toLowerCase();
    if (!key) continue;
    const existing = partyIdsByName.get(key);
    if (existing) existing.push(row.id);
    else partyIdsByName.set(key, [row.id]);
  }

  return { typeToGroup, generalByGroup, partyIdsByName, partyPrices };
}

export async function getResolveContext(repo: GoodsPricingRepository): Promise<ResolveContext> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = buildContext(repo)
    .then((ctx) => {
      cached = ctx;
      cachedAt = Date.now();
      inflight = null;
      return ctx;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });
  return inflight;
}

/** Call after any write to groups/memberships/general or VIP prices. */
export function invalidateResolveContext(): void {
  cached = null;
  cachedAt = 0;
}

/** For normalizing lookup keys the same way the cache does, outside it. */
export function normalizeKey(value: string | null | undefined): string {
  return normalizeName(value).toLowerCase();
}
