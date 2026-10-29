import { httpClient } from './httpClient';

export type ParcelStatus = 'intake' | 'warehouse' | 'arrived' | 'delivered';

export interface ParcelScanEvent {
  from_status: ParcelStatus;
  to_status: ParcelStatus;
  delivered_to_name: string | null;
  created_at: string;
  scanned_by_name: string | null;
  branch_name: string | null;
}

export interface ParcelRow {
  id: string;
  tablet_receipt_no: number | null;
  receipt_no: string | null;
  parcel_status: ParcelStatus;
  statusLabel: string;
  delivered_to_name: string | null;
  destination: string | null;
  parcel_type: string | null;
  parcel_count: number | null;
  weight_kg: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  collect_amount_usd: string | null;
  prepaid_amount_usd: string | null;
  hawala_amount_usd: string | null;
  fees_amount_usd: string | null;
  notes: string | null;
  created_at: string;
  ledger_date: string;
  branch_id: string | null;
  branch_name: string | null;
  history?: ParcelScanEvent[];
}

/** 'open' hides delivered parcels — they stay searchable on demand, since
 *  the proof of who collected the goods has to survive a later dispute. */
export type ParcelListStatus = ParcelStatus | 'all' | 'open';

export const PARCEL_STATUS_LABEL: Record<ParcelStatus, string> = {
  intake: 'مستلمة من المرسل',
  warehouse: 'في المستودع',
  arrived: 'وصلت إلى الوجهة',
  delivered: 'سُلّمت للمستلم',
};

/** What the next scan will do, phrased as the action the employee takes. */
export const PARCEL_NEXT_ACTION: Record<ParcelStatus, string | null> = {
  intake: 'تسجيل دخول المستودع',
  warehouse: 'تسجيل الوصول إلى الوجهة',
  arrived: 'تسليم الطرد للمستلم',
  delivered: null,
};

export const parcelTrackingGateway = {
  list: (params: { status?: ParcelListStatus; search?: string; branchId?: string; limit?: number } = {}): Promise<ParcelRow[]> => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.branchId) query.set('branchId', params.branchId);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return httpClient.get(`/parcels${suffix ? `?${suffix}` : ''}`);
  },

  /** Resolves a scanned code without changing anything. */
  lookup: (code: number): Promise<ParcelRow> => httpClient.get(`/parcels/lookup?code=${code}`),

  /** Advances to the next status — the server decides which one, so an
   *  out-of-order or repeated scan is rejected rather than obeyed. */
  scan: (input: { code: number; deliveredToName?: string; notes?: string }): Promise<ParcelRow> =>
    httpClient.post('/parcels/scan', input),
};
