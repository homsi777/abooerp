export interface Branch {
  id: number;
  code: string;
  name: string;
  nameEn: string;
  address: string;
  phone: string;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  customerType: 'sender' | 'receiver' | 'both';
  balance: number;
  creditLimit: number;
  notes: string;
  createdAt: string;
}

export interface City {
  id: number;
  code: string;
  name: string;
  region: string;
  hasBranch: boolean;
}

export interface GoodsType {
  id: number;
  code: string;
  name: string;
  description: string;
}

export interface Driver {
  id: number;
  code: string;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  address: string;
  isActive: boolean;
}

export interface Vehicle {
  id: number;
  plateNumber: string;
  type: string;
  model: string;
  capacity: number;
  isActive: boolean;
  notes: string;
}

export interface Shipment {
  id: number;
  shipmentNo: string;
  date: string;
  branchId: number;
  branchName: string;
  agentId?: number;
  agentName?: string;
  originName?: string;
  status: ShipmentStatus;
  senderId: number;
  senderName: string;
  senderPhone: string;
  receiverId: number;
  receiverName: string;
  receiverPhone: string;
  destinationId: number;
  destinationName: string;
  goodsTypeId: number;
  goodsTypeName: string;
  quantity: number;
  loadedQuantity?: number;
  weight: number;
  volume: number;
  freightCharge: number;
  transferFee: number;
  additionalCharges: number;
  transferServiceFee?: number;
  prepaidAmount?: number;
  discount: number;
  total: number;
  currency?: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd?: number;
  totalUsd?: number;
  paymentMethod: 'cash' | 'credit' | 'prepaid';
  deliveryType: 'door' | 'branch';
  vehicleId?: number;
  driverId?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ShipmentStatus =
  | 'DRAFT'
  | 'REGISTERED'
  | 'CONFIRMED'
  | 'READY_FOR_PICKUP'
  | 'HANDED_TO_DRIVER'
  | 'HANDED_TO_AGENT'
  | 'AGENT_RECEIVED'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_DESTINATION'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURN_REQUESTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'FINANCIALLY_CLOSED'
  | 'created'
  | 'draft'
  | 'confirmed'
  | 'loaded'
  | 'manifested'
  | 'in_transit'
  | 'arrived'
  | 'ready_delivery'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'UNKNOWN';
export interface Manifest {
  id: number;
  manifestNo: string;
  date: string;
  vehicleId: number;
  vehiclePlate: string;
  driverId: number;
  driverName: string;
  route: string;
  shipments: number[];
  totalWeight: number;
  totalShipments: number;
  notes: string;
  status: 'draft' | 'loaded' | 'in_transit' | 'arrived' | 'unloaded';
}

export interface Delivery {
  id: number;
  shipmentId: number;
  shipmentNo: string;
  recipientName: string;
  recipientPhone: string;
  deliveredAt?: string;
  receivedAmount: number;
  currency?: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd?: number;
  receivedAmountUsd?: number;
  deliveryStatus: 'pending' | 'delivered' | 'failed' | 'refused';
  failureReason?: string;
  notes: string;
}

export interface ReceiptVoucher {
  id: number;
  voucherNo: string;
  date: string;
  customerId: number;
  customerName: string;
  customerBackendId?: string | null;
  agentBackendId?: string | null;
  amount: number;
  currency?: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd?: number;
  amountUsd?: number;
  paymentMethod: 'cash' | 'cheque' | 'transfer';
  bankName?: string;
  chequeNo?: string;
  description: string;
  createdBy: string;
  cashboxId?: string;
  cashboxName?: string;
}

export interface PaymentVoucher {
  id: number;
  voucherNo: string;
  date: string;
  vendorId: number;
  vendorName: string;
  customerBackendId?: string | null;
  agentBackendId?: string | null;
  amount: number;
  currency?: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd?: number;
  amountUsd?: number;
  paymentMethod: 'cash' | 'cheque' | 'transfer';
  bankName?: string;
  chequeNo?: string;
  description: string;
  createdBy: string;
  cashboxId?: string;
  cashboxName?: string;
}

export interface JournalEntry {
  id: number;
  entryNo: string;
  date: string;
  description: string;
  debits: JournalLine[];
  credits: JournalLine[];
  posted: boolean;
  createdBy: string;
}

export interface JournalLine {
  accountId: number;
  accountName: string;
  debit: number;
  credit: number;
}

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'manager' | 'operator';
  branchId: number;
  isActive: boolean;
}

export interface Tariff {
  id: number;
  fromCityId: number;
  fromCityName: string;
  toCityId: number;
  toCityName: string;
  goodsTypeId: number;
  goodsTypeName: string;
  pricePerKg: number;
  minimumCharge: number;
  validFrom: string;
  validTo?: string;
}

export type ShipmentStatusLabel = Record<ShipmentStatus, string>;

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: 'مسودة',
  REGISTERED: 'مسجلة',
  CONFIRMED: 'مؤكدة',
  READY_FOR_PICKUP: 'جاهزة للاستلام',
  HANDED_TO_DRIVER: 'سُلّمت للسائق',
  HANDED_TO_AGENT: 'سُلّمت للوكيل',
  AGENT_RECEIVED: 'استلمها الوكيل',
  IN_TRANSIT: 'في الطريق',
  ARRIVED_AT_DESTINATION: 'وصلت للوجهة',
  OUT_FOR_DELIVERY: 'خارجة للتسليم',
  DELIVERED: 'تم التسليم',
  RETURN_REQUESTED: 'طلب إرجاع',
  RETURNED: 'مرتجعة',
  CANCELLED: 'ملغاة',
  FINANCIALLY_CLOSED: 'مغلقة ماليا',
  draft: 'مسودة',
  confirmed: 'مؤكدة',
  loaded: 'سُلّمت للسائق',
  manifested: 'سُلّمت للسائق',
  in_transit: 'في الطريق',
  arrived: 'وصلت للوجهة',
  ready_delivery: 'خارجة للتسليم',
  delivered: 'تم التسليم',
  returned: 'مرتجعة',
  cancelled: 'ملغاة',
  created: 'مسجلة',
  UNKNOWN: 'حالة غير معروفة',
};

export const SHIPMENT_STATUS_COLORS: Record<ShipmentStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  REGISTERED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  READY_FOR_PICKUP: 'bg-cyan-100 text-cyan-700',
  HANDED_TO_DRIVER: 'bg-violet-100 text-violet-700',
  HANDED_TO_AGENT: 'bg-fuchsia-100 text-fuchsia-700',
  AGENT_RECEIVED: 'bg-purple-100 text-purple-700',
  IN_TRANSIT: 'bg-amber-100 text-amber-700',
  ARRIVED_AT_DESTINATION: 'bg-emerald-100 text-emerald-700',
  OUT_FOR_DELIVERY: 'bg-sky-100 text-sky-700',
  DELIVERED: 'bg-green-100 text-green-700',
  RETURN_REQUESTED: 'bg-orange-100 text-orange-700',
  RETURNED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-red-100 text-red-700',
  FINANCIALLY_CLOSED: 'bg-neutral-900 text-white',
  draft: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-indigo-100 text-indigo-700',
  loaded: 'bg-violet-100 text-violet-700',
  manifested: 'bg-violet-100 text-violet-700',
  in_transit: 'bg-amber-100 text-amber-700',
  arrived: 'bg-emerald-100 text-emerald-700',
  ready_delivery: 'bg-sky-100 text-sky-700',
  delivered: 'bg-green-100 text-green-700',
  returned: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-red-100 text-red-700',
  created: 'bg-blue-100 text-blue-700',
  UNKNOWN: 'bg-gray-100 text-gray-700',
};
