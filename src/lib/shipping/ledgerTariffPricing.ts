import type { Branch, City, GoodsType, Tariff } from '../../types';

export type LedgerTariffRow = {
  origin: string;
  destination: string;
  parcelType: string;
  weightKg: string;
  collectAmount: string;
  prepaidAmount: string;
  collectManual?: boolean;
};

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function parseUsd(value: string) {
  const clean = value.trim().replace(/,/g, '');
  if (!clean) return 0;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWeightKg(value: string) {
  const clean = value.trim().replace(/,/g, '');
  if (!clean) return undefined;
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveCityId(label: string, cities: City[], branches: Branch[]): number | undefined {
  const n = normalizeName(label);
  if (!n) return undefined;
  const direct = cities.find((c) => normalizeName(c.name) === n);
  if (direct) return direct.id;
  const br = branches.find((b) => normalizeName(b.name) === n);
  if (br) {
    const hint = cities.find(
      (c) =>
        normalizeName(br.name).includes(normalizeName(c.name)) ||
        normalizeName(c.name).includes(normalizeName(br.name)),
    );
    return hint?.id;
  }
  return undefined;
}

export function resolveGoodsTypeId(parcelType: string, goodsTypes: GoodsType[]): number | undefined {
  const n = normalizeName(parcelType);
  if (!n) return undefined;
  return goodsTypes.find((g) => normalizeName(g.name) === n)?.id;
}

/** تعريف الأسعار: مسار (من → إلى) + نوع الطرد + وزن — بدون عدد الطرود. */
export function pickRouteTariff(
  tariffs: Tariff[],
  fromCityId: number,
  toCityId: number,
  asOf: string,
  goodsTypeId?: number,
): Tariff | undefined {
  const day = (asOf.split('T')[0] ?? asOf).trim();
  const candidates = tariffs.filter(
    (t) =>
      t.fromCityId === fromCityId &&
      t.toCityId === toCityId &&
      (!t.validFrom || t.validFrom <= day) &&
      (!t.validTo || t.validTo >= day),
  );
  if (!candidates.length) return undefined;
  const pickNewest = (pool: Tariff[]) => [...pool].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];

  if (goodsTypeId) {
    const byGoods = candidates.filter((t) => t.goodsTypeId === goodsTypeId);
    if (byGoods.length) return pickNewest(byGoods);
    const generic = candidates.filter((t) => !t.goodsTypeId);
    if (generic.length) return pickNewest(generic);
    return undefined;
  }

  const generic = candidates.filter((t) => !t.goodsTypeId);
  if (generic.length) return pickNewest(generic);
  return undefined;
}

function formatUsdAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** max(سعر/كغ × الوزن، الحد الأدنى للشحنة) */
export function computeRouteTariffAmount(
  row: Pick<LedgerTariffRow, 'origin' | 'destination' | 'parcelType' | 'weightKg'>,
  tariffs: Tariff[],
  cities: City[],
  branches: Branch[],
  goodsTypes: GoodsType[],
  asOf: string,
): string | null {
  const origin = normalizeName(row.origin);
  const dest = normalizeName(row.destination);
  const parcelType = normalizeName(row.parcelType);
  if (!origin || !dest || !parcelType) return null;
  const fromId = resolveCityId(origin, cities, branches);
  const toId = resolveCityId(dest, cities, branches);
  if (!fromId || !toId) return null;
  const goodsTypeId = resolveGoodsTypeId(parcelType, goodsTypes);
  if (!goodsTypeId) return null;
  const w = parseWeightKg(row.weightKg);
  if (w == null) return null;
  const t = pickRouteTariff(tariffs, fromId, toId, asOf, goodsTypeId);
  if (!t) return null;
  const weightComponent = t.pricePerKg > 0 ? t.pricePerKg * w : 0;
  const minPart = t.minimumCharge > 0 ? t.minimumCharge : 0;
  const amount = Math.max(weightComponent, minPart);
  if (amount <= 0) return null;
  return formatUsdAmount(amount);
}

export function shippingPriceUsd(row: Pick<LedgerTariffRow, 'collectAmount' | 'prepaidAmount'>) {
  return parseUsd(row.collectAmount) + parseUsd(row.prepaidAmount);
}

export function ledgerRowTotalUsd(row: {
  collectAmount: string;
  prepaidAmount: string;
  receiverCollect: string;
  transferServiceFee: string;
}) {
  return Math.max(
    parseUsd(row.collectAmount) + parseUsd(row.receiverCollect) + parseUsd(row.transferServiceFee),
    0,
  );
}

export function mergeLedgerRowWithAutoTariff<T extends LedgerTariffRow>(
  row: T,
  tariffs: Tariff[],
  cities: City[],
  branches: Branch[],
  goodsTypes: GoodsType[],
  asOf: string,
): T {
  if (row.collectManual && String(row.collectAmount ?? '').trim() !== '') return row;
  if (parseUsd(row.prepaidAmount) > 0) return row;
  const amount = computeRouteTariffAmount(row, tariffs, cities, branches, goodsTypes, asOf);
  if (amount == null) return row;
  return { ...row, collectAmount: amount, collectManual: false };
}
