import type { CurrencyCode } from '../../lib/currency/currency';

export interface Voucher {
  id: number;
  kind: 'receipt' | 'payment';
  voucherNo: string;
  voucherType: string;
  date: string;
  relatedParty: string;
  customerId?: string | null;
  agentId?: string | null;
  relatedEntityType?: string | null;
  amount: number;
  currency: CurrencyCode;
  amountUsd: number;
  cashBox: string;
  cashboxId?: string;
  description: string;
  refNo: string;
  status: string;
}

export const voucherStatusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function voucherStatusLabelAr(s: string): string {
  if (s === 'draft') return 'مسودة';
  if (s === 'confirmed') return 'مؤكد';
  if (s === 'cancelled') return 'ملغى';
  return s;
}
