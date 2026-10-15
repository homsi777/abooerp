import { httpClient } from './httpClient';

export interface GoodsShippingPriceRow {
  id: string;
  goods_name: string;
  origin: string | null;
  destination: string;
  weight_kg: string | null;
  parcel_count: number | null;
  unit_price_usd: string;
  customer_name: string | null;
  created_at: string;
}

export const goodsShippingPricesGateway = {
  list: (limit = 200): Promise<GoodsShippingPriceRow[]> =>
    httpClient.get(`/finance/goods-shipping-prices?limit=${limit}`),
  create: (input: {
    goodsName: string;
    origin: string;
    destination: string;
    weightKg?: number | null;
    parcelCount?: number | null;
    unitPriceUsd: number;
    customerName?: string | null;
  }): Promise<GoodsShippingPriceRow> => httpClient.post('/finance/goods-shipping-prices', input),
  remove: (id: string) => httpClient.delete(`/finance/goods-shipping-prices/${id}`),
};
