/** صف دفتر الشحن كما يُرجع من GET /daily-ledger/rows */
export type RemoteDailyLedgerRow = {
  id: string;
  row_no: number;
  receipt_no: string | null;
  destination: string;
  parcel_type: string;
  parcel_count: number | null;
  weight_kg: string | null;
  sender_name: string;
  receiver_name: string;
  collect_amount_usd: string;
  prepaid_amount_usd: string;
  hawala_amount_usd: string;
  fees_amount_usd: string;
  transfer_service_fee_usd: string;
  notes: string | null;
  posted_shipment_id: string | null;
  posted_at: string | null;
  loaded_manifest_id: string | null;
  loaded_at: string | null;
  created_at: string;
  updated_at: string;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  session_id?: string | null;
  session_printed_at?: string | null;
  session_reprint_required?: boolean | null;
  session_reprint_reason?: string | null;
  dispatch_id?: string | null;
  dispatch_no?: number | null;
};

export type DailyLedgerEditingScope = {
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
};

export type DailyLedgerQueryScope = DailyLedgerEditingScope & {
  includeLoaded: boolean;
  /** نطاق تاريخ — إن وُجد يُستخدم بدل ledgerDate */
  dateFrom?: string;
  dateTo?: string;
  /** عند true لا يُرسل lineLabel — للطباعة الصريحة لكل الخطوط فقط */
  allLines?: boolean;
  /** للمدير: جلب أسطر كل فروع الشركة لنفس التاريخ */
  allBranches?: boolean;
};
