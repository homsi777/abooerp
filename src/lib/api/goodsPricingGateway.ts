import { httpClient } from './httpClient';

export type PricingUnit = 'parcel' | 'kg';

export interface GoodsPricingGroup {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  general_unit: PricingUnit | null;
  general_price_usd: string | null;
  member_count: number;
  vip_count: number;
}

export interface UnclassifiedGoodsType {
  id: string;
  name: string;
  rows_count: number;
}

export interface GoodsPricingCoverage {
  totalRows: number;
  classifiedRows: number;
  pricedRows: number;
  classifiedPct: number;
  pricedPct: number;
}

export interface PartySearchResult {
  id: string;
  full_name: string;
  city: string | null;
  vip_price_count: number;
}

export interface PartyPriceRow {
  id: string;
  group_id: string;
  group_name: string;
  pricing_unit: PricingUnit;
  unit_price_usd: string;
  is_active: boolean;
  general_unit: PricingUnit | null;
  general_price_usd: string | null;
}

export interface PriceHistoryRow {
  id: number;
  scope: 'general' | 'party';
  group_id: string;
  group_name: string | null;
  party_id: string | null;
  party_name: string | null;
  old_unit_price_usd: string | null;
  new_unit_price_usd: string | null;
  old_pricing_unit: PricingUnit | null;
  new_pricing_unit: PricingUnit | null;
  action: 'create' | 'update' | 'deactivate';
  changed_at: string;
  changed_by_username: string | null;
}

export interface ResolveResponse {
  status: 'priced' | 'no_group' | 'no_price' | 'conflict';
  conflict: boolean;
  groupId: string | null;
  partyId: string | null;
  unit: PricingUnit | null;
  unitPriceUsd: string | null;
  source: 'party' | 'general' | null;
  senderAmbiguous: boolean;
  receiverAmbiguous: boolean;
  lineTotalUsd: string | null;
}

/**
 * NOTE on /unclassified: unlike every other endpoint here, its handler puts
 * `total`/`page`/`pageSize` as SIBLINGS of `data` at the top level of the
 * JSON body (not nested inside `data`) — see goodsPricingRoutes.ts. httpClient
 * only ever returns `payload.data`, so this one call bypasses httpClient and
 * reads the raw response to recover `total` too.
 */
async function fetchUnclassified(path: string): Promise<{ rows: UnclassifiedGoodsType[]; total: number }> {
  const data = await httpClient.get<UnclassifiedGoodsType[]>(path);
  return { rows: data, total: data.length };
}

export const goodsPricingGateway = {
  groups: {
    list: (): Promise<GoodsPricingGroup[]> => httpClient.get('/finance/goods-pricing/groups'),
    create: (input: { name: string; notes?: string | null }): Promise<GoodsPricingGroup> =>
      httpClient.post('/finance/goods-pricing/groups', input),
    update: (id: string, input: { name?: string; notes?: string | null; isActive?: boolean }): Promise<GoodsPricingGroup> =>
      httpClient.patch(`/finance/goods-pricing/groups/${id}`, input),
    setPrice: (id: string, input: { pricingUnit: PricingUnit; unitPriceUsd: string }) =>
      httpClient.put(`/finance/goods-pricing/groups/${id}/price`, input),
    deactivatePrice: (id: string) => httpClient.delete(`/finance/goods-pricing/groups/${id}/price`),
    addMembers: (id: string, goodsTypeIds: string[]) =>
      httpClient.post(`/finance/goods-pricing/groups/${id}/members`, { goodsTypeIds }),
    removeMember: (id: string, goodsTypeId: string) =>
      httpClient.delete(`/finance/goods-pricing/groups/${id}/members/${goodsTypeId}`),
  },
  unclassified: (params: { search?: string; page?: number; pageSize?: number }): Promise<{ rows: UnclassifiedGoodsType[]; total: number }> => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const s = q.toString();
    return fetchUnclassified(`/finance/goods-pricing/unclassified${s ? `?${s}` : ''}`);
  },
  coverage: (): Promise<GoodsPricingCoverage> => httpClient.get('/finance/goods-pricing/coverage'),
  parties: {
    search: (search?: string, page = 1): Promise<PartySearchResult[]> => {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      q.set('page', String(page));
      return httpClient.get(`/finance/goods-pricing/parties?${q.toString()}`);
    },
    prices: (partyId: string): Promise<PartyPriceRow[]> => httpClient.get(`/finance/goods-pricing/parties/${partyId}/prices`),
    setPrice: (partyId: string, groupId: string, input: { pricingUnit: PricingUnit; unitPriceUsd: string }) =>
      httpClient.put(`/finance/goods-pricing/parties/${partyId}/prices/${groupId}`, input),
    deactivatePrice: (partyId: string, groupId: string) =>
      httpClient.delete(`/finance/goods-pricing/parties/${partyId}/prices/${groupId}`),
  },
  history: (page = 1): Promise<PriceHistoryRow[]> => httpClient.get(`/finance/goods-pricing/history?page=${page}`),

  ledger: {
    resolve: (input: {
      parcelType?: string;
      senderName?: string;
      receiverName?: string;
      parcelCount?: number | null;
      weightKg?: string | number | null;
    }): Promise<ResolveResponse> => httpClient.post('/daily-ledger/pricing/resolve', input),
  },
};
