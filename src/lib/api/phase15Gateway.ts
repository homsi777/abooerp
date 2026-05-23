import type { Branch, City, Customer, Delivery, Driver, GoodsType, Manifest, Shipment, Tariff, Vehicle } from '../../types';
import { httpClient } from './httpClient';
import {
  normalizeShipmentStatus,
  shipmentStatusLabelAr,
} from '../shipments/shipmentStatus';

type BackendRefRecord = {
  id: string;
  code: string;
  name?: string;
  full_name?: string;
  phone?: string;
  city?: string;
  address?: string;
  type?: 'sender' | 'receiver' | 'both';
  status?: 'active' | 'inactive';
  model?: string;
  capacity_kg?: number;
  plate_number?: string;
  license_number?: string;
  created_at?: string;
  updated_at?: string;
};

type BackendShipmentRecord = {
  id: string;
  shipment_no: string;
  reference_no?: string;
  sender_id?: string;
  receiver_id?: string;
  branch_id?: string;
  agent_id?: string;
  origin_city?: string;
  destination_city: string;
  description?: string;
  pieces_count?: number;
  loaded_pieces_count?: number;
  weight_kg?: number;
  status: string;
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  exchange_rate_to_usd: number;
  base_amount_usd: number;
  created_at: string;
  updated_at?: string;
  // Fee breakdown columns (migration 058)
  freight_charge?: number;
  transfer_fee?: number;
  additional_charges?: number;
  prepaid_amount?: number;
  discount_amount?: number;
  transfer_service_fee?: number;
};

type BackendShipmentHistoryRow = {
  id: string;
  shipment_id: string;
  status: string;
  previous_status?: string | null;
  next_status?: string | null;
  note?: string | null;
  changed_by?: string | null;
  changed_at: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

type BackendManifestRecord = {
  id: string;
  manifest_no: string;
  branch_id: string;
  vehicle_id?: string;
  driver_id?: string;
  status: 'created' | 'dispatched' | 'closed' | 'cancelled';
  created_at: string;
  shipments?: BackendShipmentRecord[];
};

type BackendDeliveryRecord = {
  id: string;
  delivery_no: string;
  shipment_id: string;
  status: 'pending' | 'delivered' | 'failed' | 'returned';
  recipient_name?: string;
  received_at?: string;
  notes?: string;
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  exchange_rate_to_usd: number;
  base_amount_usd: number;
};

type BackendCityRecord = {
  id: string;
  code: string;
  name: string;
  region?: string;
  has_branch?: boolean;
};

type BackendGoodsTypeRecord = {
  id: string;
  code: string;
  name: string;
  description?: string;
};

type BackendAgentRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
  branch_id?: string | null;
  is_active?: boolean;
};

type BackendTariffRecord = {
  id: string;
  code: string;
  from_city_id: string;
  to_city_id: string;
  goods_type_id: string;
  price_per_kg: number;
  minimum_charge: number;
  valid_from: string;
  valid_to?: string;
};

const stringIdToNumber = new Map<string, number>();
const numberIdToString = new Map<number, string>();
let nextSyntheticId = 100000;

const customerLookup = new Map<number, Customer>();
const driverLookup = new Map<number, Driver>();
const vehicleLookup = new Map<number, Vehicle>();
const branchLookup = new Map<number, Branch>();
const cityLookup = new Map<number, City>();
const goodsTypeLookup = new Map<number, GoodsType>();
const shipmentLookup = new Map<number, Shipment>();

function toSyntheticId(id: string): number {
  const existing = stringIdToNumber.get(id);
  if (existing) return existing;
  nextSyntheticId += 1;
  stringIdToNumber.set(id, nextSyntheticId);
  numberIdToString.set(nextSyntheticId, id);
  return nextSyntheticId;
}

function toBackendId(id: number): string | undefined {
  return numberIdToString.get(id);
}

export function getBackendIdFromSynthetic(id: number): string | undefined {
  return toBackendId(id);
}

/** Stable synthetic numeric id for a backend UUID (used when prefilling agent row from session). */
export function syntheticEntityId(backendUuid: string): number {
  return toSyntheticId(backendUuid);
}

function mapShipmentStatusToFrontend(status: BackendShipmentRecord['status']): Shipment['status'] {
  const normalized = normalizeShipmentStatus(status);
  if (normalized === 'UNKNOWN') return 'UNKNOWN';
  return normalized;
}

function mapShipmentStatusToBackend(status: Shipment['status']): BackendShipmentRecord['status'] {
  const normalized = normalizeShipmentStatus(status);
  if (normalized !== 'UNKNOWN') return normalized;
  if (status === 'delivered') return 'DELIVERED';
  if (status === 'cancelled' || status === 'returned') return 'CANCELLED';
  if (status === 'loaded') return 'HANDED_TO_DRIVER';
  if (status === 'in_transit' || status === 'arrived' || status === 'ready_delivery') return 'IN_TRANSIT';
  return 'REGISTERED';
}

function mapManifestStatusToFrontend(status: BackendManifestRecord['status']): Manifest['status'] {
  if (status === 'dispatched') return 'in_transit';
  if (status === 'closed') return 'arrived';
  if (status === 'cancelled') return 'draft';
  return 'draft';
}

function mapManifestStatusToBackend(status: Manifest['status']): BackendManifestRecord['status'] {
  if (status === 'in_transit') return 'dispatched';
  if (status === 'arrived' || status === 'unloaded') return 'closed';
  return 'created';
}

function mapDeliveryStatusToFrontend(status: BackendDeliveryRecord['status']): Delivery['deliveryStatus'] {
  if (status === 'returned') return 'refused';
  return status;
}

function mapDeliveryStatusToBackend(status: Delivery['deliveryStatus']): BackendDeliveryRecord['status'] {
  if (status === 'refused') return 'returned';
  return status;
}

function mapCustomer(record: BackendRefRecord): Customer {
  const mapped: Customer = {
    id: toSyntheticId(record.id),
    code: record.code,
    name: record.name ?? record.full_name ?? '',
    phone: record.phone ?? '',
    address: record.address ?? '',
    customerType: record.type ?? 'both',
    balance: 0,
    creditLimit: 0,
    notes: '',
    createdAt: record.created_at ? record.created_at.split('T')[0] : '',
  };
  customerLookup.set(mapped.id, mapped);
  return mapped;
}

function mapDriver(record: BackendRefRecord): Driver {
  const mapped: Driver = {
    id: toSyntheticId(record.id),
    code: record.code,
    name: record.full_name ?? record.name ?? '',
    phone: record.phone ?? '',
    licenseNumber: record.license_number ?? '',
    licenseExpiry: '',
    address: record.address ?? '',
    isActive: record.status !== 'inactive',
  };
  driverLookup.set(mapped.id, mapped);
  return mapped;
}

function mapVehicle(record: BackendRefRecord): Vehicle {
  const mapped: Vehicle = {
    id: toSyntheticId(record.id),
    plateNumber: record.plate_number ?? '',
    type: 'شاحنة',
    model: record.model ?? '',
    capacity: Number(record.capacity_kg ?? 0),
    isActive: record.status !== 'inactive',
    notes: '',
  };
  vehicleLookup.set(mapped.id, mapped);
  return mapped;
}

function mapBranch(record: BackendRefRecord): Branch {
  const mapped: Branch = {
    id: toSyntheticId(record.id),
    code: record.code,
    name: record.name ?? '',
    nameEn: '',
    address: record.address ?? '',
    phone: record.phone ?? '',
  };
  branchLookup.set(mapped.id, mapped);
  return mapped;
}

function mapCity(record: BackendCityRecord): City {
  const mapped: City = {
    id: toSyntheticId(record.id),
    code: record.code,
    name: record.name,
    region: record.region || '',
    hasBranch: Boolean(record.has_branch),
  };
  cityLookup.set(mapped.id, mapped);
  return mapped;
}

function mapGoodsType(record: BackendGoodsTypeRecord): GoodsType {
  const mapped: GoodsType = {
    id: toSyntheticId(record.id),
    code: record.code,
    name: record.name,
    description: record.description || '',
  };
  goodsTypeLookup.set(mapped.id, mapped);
  return mapped;
}

function mapTariff(record: BackendTariffRecord): Tariff {
  const fromCityId = toSyntheticId(record.from_city_id);
  const toCityId = toSyntheticId(record.to_city_id);
  const goodsTypeId = toSyntheticId(record.goods_type_id);

  return {
    id: toSyntheticId(record.id),
    fromCityId,
    fromCityName: cityLookup.get(fromCityId)?.name || '',
    toCityId,
    toCityName: cityLookup.get(toCityId)?.name || '',
    goodsTypeId,
    goodsTypeName: goodsTypeLookup.get(goodsTypeId)?.name || '',
    pricePerKg: Number(record.price_per_kg),
    minimumCharge: Number(record.minimum_charge),
    validFrom: record.valid_from?.split('T')[0] || record.valid_from,
    validTo: record.valid_to?.split('T')[0],
  };
}

function mapShipment(record: BackendShipmentRecord): Shipment {
  const senderId = record.sender_id ? toSyntheticId(record.sender_id) : 0;
  const receiverId = record.receiver_id ? toSyntheticId(record.receiver_id) : 0;
  const branchId = record.branch_id ? toSyntheticId(record.branch_id) : 0;
  const agentId = record.agent_id ? toSyntheticId(record.agent_id) : 0;

  const mapped: Shipment = {
    id: toSyntheticId(record.id),
    shipmentNo: record.shipment_no,
    date: record.created_at.split('T')[0],
    branchId,
    branchName: branchLookup.get(branchId)?.name ?? '',
    agentId: agentId || undefined,
    originName: record.origin_city ?? '',
    status: mapShipmentStatusToFrontend(record.status),
    senderId,
    senderName: customerLookup.get(senderId)?.name ?? '-',
    senderPhone: customerLookup.get(senderId)?.phone ?? '',
    receiverId,
    receiverName: customerLookup.get(receiverId)?.name ?? '-',
    receiverPhone: customerLookup.get(receiverId)?.phone ?? '',
    destinationId: 0,
    destinationName: record.destination_city,
    goodsTypeId: 0,
    goodsTypeName: '',
    quantity: Number(record.pieces_count ?? 1),
    loadedQuantity: Number(record.loaded_pieces_count ?? 0),
    weight: Number(record.weight_kg ?? 0),
    volume: 0,
    freightCharge: Number(record.freight_charge ?? record.original_amount ?? 0),
    transferFee: Number(record.transfer_fee ?? 0),
    additionalCharges: Number(record.additional_charges ?? 0),
    transferServiceFee: Number(record.transfer_service_fee ?? 0),
    prepaidAmount: Number(record.prepaid_amount ?? 0),
    discount: Number(record.discount_amount ?? 0),
    total: Number(record.original_amount ?? 0),
    currency: record.original_currency,
    exchangeRateToUsd: Number(record.exchange_rate_to_usd),
    totalUsd: Number(record.base_amount_usd),
    paymentMethod: 'cash',
    deliveryType: 'branch',
    notes: record.description ?? '',
    createdAt: record.created_at,
    updatedAt: record.updated_at ?? record.created_at,
  };
  shipmentLookup.set(mapped.id, mapped);
  return mapped;
}

async function ensureReferenceLookups() {
  await Promise.all([
    phase15Gateway.branches.getAll(),
    phase15Gateway.sendersReceivers.getAll(),
    phase15Gateway.vehicles.getAll(),
    phase15Gateway.drivers.getAll(),
    phase15Gateway.cities.getAll(),
    phase15Gateway.goodsTypes.getAll(),
  ]);
}

function resolveExchangeRate(data: Partial<Shipment> | Partial<Delivery>): number {
  const amount =
    'total' in data
      ? Number(data.total ?? 0)
      : 'receivedAmount' in data
        ? Number(data.receivedAmount ?? 0)
        : 0;
  const amountUsd =
    'totalUsd' in data
      ? Number((data as Partial<Shipment>).totalUsd ?? 0)
      : 'receivedAmountUsd' in data
        ? Number(data.receivedAmountUsd ?? 0)
        : 0;
  if (data.currency === 'USD') return 1;
  if (typeof data.exchangeRateToUsd === 'number' && data.exchangeRateToUsd > 0) {
    return data.exchangeRateToUsd;
  }
  if (amount > 0 && amountUsd > 0) {
    return Number((amountUsd / amount).toFixed(8));
  }
  return 1;
}

export const phase15Gateway = {
  branches: {
    getAll: async (): Promise<Branch[]> => {
      const rows = await httpClient.get<BackendRefRecord[]>('/auth/branches');
      return rows.map(mapBranch);
    },
  },
  cities: {
    getAll: async (): Promise<City[]> => {
      const rows = await httpClient.get<BackendCityRecord[]>('/cities');
      return rows.map(mapCity);
    },
    create: async (data: Partial<City>): Promise<City> => {
      const created = await httpClient.post<BackendCityRecord>('/cities', {
        code: data.code || `CITY-${Date.now()}`,
        name: data.name || '',
        region: data.region || '',
        has_branch: Boolean(data.hasBranch),
        is_active: true,
      });
      return mapCity(created);
    },
    update: async (id: number, data: Partial<City>): Promise<City> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing city mapping for backend update.');
      }
      const updated = await httpClient.put<BackendCityRecord>(`/cities/${backendId}`, {
        code: data.code,
        name: data.name,
        region: data.region,
        has_branch: typeof data.hasBranch === 'boolean' ? data.hasBranch : undefined,
      });
      return mapCity(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing city mapping for backend delete.');
      }
      await httpClient.delete<void>(`/cities/${backendId}`);
    },
  },
  goodsTypes: {
    getAll: async (): Promise<GoodsType[]> => {
      const rows = await httpClient.get<BackendGoodsTypeRecord[]>('/goods-types');
      return rows.map(mapGoodsType);
    },
    create: async (data: Partial<GoodsType>): Promise<GoodsType> => {
      const created = await httpClient.post<BackendGoodsTypeRecord>('/goods-types', {
        code: data.code || `GT-${Date.now()}`,
        name: data.name || '',
        description: data.description || '',
        is_active: true,
      });
      return mapGoodsType(created);
    },
    update: async (id: number, data: Partial<GoodsType>): Promise<GoodsType> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing goods type mapping for backend update.');
      }
      const updated = await httpClient.put<BackendGoodsTypeRecord>(`/goods-types/${backendId}`, {
        code: data.code,
        name: data.name,
        description: data.description,
      });
      return mapGoodsType(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing goods type mapping for backend delete.');
      }
      await httpClient.delete<void>(`/goods-types/${backendId}`);
    },
  },
  agents: {
    lookupByDestination: async (destination: string, branchId?: number): Promise<Array<{
      id: number;
      code: string;
      name: string;
      phone?: string | null;
      governorate?: string | null;
      city?: string | null;
      area?: string | null;
      branchId?: number;
      isActive: boolean;
    }>> => {
      const params = new URLSearchParams({ destination });
      const branchBackendId = branchId ? toBackendId(branchId) : undefined;
      if (branchBackendId) params.set('branchId', branchBackendId);
      const rows = await httpClient.get<BackendAgentRecord[]>(`/agents/lookup-by-destination?${params.toString()}`);
      return rows.map((row) => ({
        id: toSyntheticId(row.id),
        code: row.code,
        name: row.name,
        phone: row.phone,
        governorate: row.governorate,
        city: row.city,
        area: row.area,
        branchId: row.branch_id ? toSyntheticId(row.branch_id) : undefined,
        isActive: row.is_active !== false,
      }));
    },
  },
  tariffs: {
    getAll: async (): Promise<Tariff[]> => {
      await Promise.all([phase15Gateway.cities.getAll(), phase15Gateway.goodsTypes.getAll()]);
      const rows = await httpClient.get<BackendTariffRecord[]>('/tariffs');
      return rows.map(mapTariff);
    },
    create: async (data: Partial<Tariff>): Promise<Tariff> => {
      await Promise.all([phase15Gateway.cities.getAll(), phase15Gateway.goodsTypes.getAll()]);
      const fromCityBackendId = data.fromCityId ? toBackendId(data.fromCityId) : undefined;
      const toCityBackendId = data.toCityId ? toBackendId(data.toCityId) : undefined;
      const goodsTypeBackendId = data.goodsTypeId ? toBackendId(data.goodsTypeId) : undefined;
      if (!fromCityBackendId || !toCityBackendId || !goodsTypeBackendId) {
        throw new Error('Missing city/goods type mapping for tariff create.');
      }
      const created = await httpClient.post<BackendTariffRecord>('/tariffs', {
        code: `TRF-${Date.now()}`,
        from_city_id: fromCityBackendId,
        to_city_id: toCityBackendId,
        goods_type_id: goodsTypeBackendId,
        price_per_kg: data.pricePerKg || 0,
        minimum_charge: data.minimumCharge || 0,
        valid_from: data.validFrom || new Date().toISOString().split('T')[0],
        valid_to: data.validTo || undefined,
        is_active: true,
      });
      return mapTariff(created);
    },
    update: async (id: number, data: Partial<Tariff>): Promise<Tariff> => {
      await Promise.all([phase15Gateway.cities.getAll(), phase15Gateway.goodsTypes.getAll()]);
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing tariff mapping for backend update.');
      }
      const updated = await httpClient.put<BackendTariffRecord>(`/tariffs/${backendId}`, {
        from_city_id: data.fromCityId ? toBackendId(data.fromCityId) : undefined,
        to_city_id: data.toCityId ? toBackendId(data.toCityId) : undefined,
        goods_type_id: data.goodsTypeId ? toBackendId(data.goodsTypeId) : undefined,
        price_per_kg: data.pricePerKg,
        minimum_charge: data.minimumCharge,
        valid_from: data.validFrom,
        valid_to: data.validTo,
      });
      return mapTariff(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing tariff mapping for backend delete.');
      }
      await httpClient.delete<void>(`/tariffs/${backendId}`);
    },
  },
  customers: {
    getAll: async (): Promise<Customer[]> => {
      const rows = await httpClient.get<BackendRefRecord[]>('/customers');
      return rows.map(mapCustomer);
    },
    create: async (data: Partial<Customer>): Promise<Customer> => {
      const created = await httpClient.post<BackendRefRecord>('/customers', {
        code: data.code || `CUS-${Date.now()}`,
        name: data.name || '',
        phone: data.phone || '',
        city: '',
        address: data.address || '',
        status: 'active',
      });
      return mapCustomer(created);
    },
    update: async (id: number, data: Partial<Customer>): Promise<Customer> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing customer mapping for backend update.');
      const updated = await httpClient.put<BackendRefRecord>(`/customers/${backendId}`, {
        code: data.code,
        name: data.name,
        phone: data.phone,
        address: data.address,
      });
      return mapCustomer(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing customer mapping for backend delete.');
      await httpClient.delete<void>(`/customers/${backendId}`);
    },
  },
  sendersReceivers: {
    getAll: async (): Promise<Customer[]> => {
      const rows = await httpClient.get<BackendRefRecord[]>('/senders-receivers');
      return rows.map(mapCustomer);
    },
    create: async (data: Partial<Customer>): Promise<Customer> => {
      const created = await httpClient.post<BackendRefRecord>('/senders-receivers', {
        code: data.code || `SR-${Date.now()}`,
        full_name: data.name || '',
        phone: data.phone || '',
        city: '',
        address: data.address || '',
        type: data.customerType || 'both',
        status: 'active',
      });
      return mapCustomer(created);
    },
    update: async (id: number, data: Partial<Customer>): Promise<Customer> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing sender/receiver mapping for backend update.');
      const updated = await httpClient.put<BackendRefRecord>(`/senders-receivers/${backendId}`, {
        code: data.code,
        full_name: data.name,
        phone: data.phone,
        address: data.address,
        type: data.customerType,
      });
      return mapCustomer(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing sender/receiver mapping for backend delete.');
      await httpClient.delete<void>(`/senders-receivers/${backendId}`);
    },
  },
  drivers: {
    getAll: async (): Promise<Driver[]> => {
      const rows = await httpClient.get<BackendRefRecord[]>('/drivers');
      return rows.map(mapDriver);
    },
    create: async (data: Partial<Driver>): Promise<Driver> => {
      const created = await httpClient.post<BackendRefRecord>('/drivers', {
        code: data.code || `DRV-${Date.now()}`,
        full_name: data.name || '',
        phone: data.phone || '',
        license_number: data.licenseNumber || '',
        address: data.address || '',
        status: data.isActive === false ? 'inactive' : 'active',
      });
      return mapDriver(created);
    },
    update: async (id: number, data: Partial<Driver>): Promise<Driver> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing driver mapping for backend update.');
      const updated = await httpClient.put<BackendRefRecord>(`/drivers/${backendId}`, {
        code: data.code,
        full_name: data.name,
        phone: data.phone,
        license_number: data.licenseNumber,
        address: data.address,
        status: data.isActive === false ? 'inactive' : 'active',
      });
      return mapDriver(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing driver mapping for backend delete.');
      await httpClient.delete<void>(`/drivers/${backendId}`);
    },
  },
  vehicles: {
    getAll: async (): Promise<Vehicle[]> => {
      const rows = await httpClient.get<BackendRefRecord[]>('/vehicles');
      return rows.map(mapVehicle);
    },
    create: async (data: Partial<Vehicle>): Promise<Vehicle> => {
      const created = await httpClient.post<BackendRefRecord>('/vehicles', {
        code: `VEH-${Date.now()}`,
        plate_number: data.plateNumber || '',
        model: data.model || '',
        capacity_kg: data.capacity || 0,
        status: data.isActive === false ? 'inactive' : 'active',
      });
      return mapVehicle(created);
    },
    update: async (id: number, data: Partial<Vehicle>): Promise<Vehicle> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing vehicle mapping for backend update.');
      const updated = await httpClient.put<BackendRefRecord>(`/vehicles/${backendId}`, {
        plate_number: data.plateNumber,
        model: data.model,
        capacity_kg: data.capacity,
        status: data.isActive === false ? 'inactive' : 'active',
      });
      return mapVehicle(updated);
    },
    delete: async (id: number): Promise<void> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing vehicle mapping for backend delete.');
      await httpClient.delete<void>(`/vehicles/${backendId}`);
    },
  },
  shipments: {
    getAll: async (): Promise<Shipment[]> => {
      await ensureReferenceLookups();
      const rows = await httpClient.get<BackendShipmentRecord[]>('/shipments');
      return rows.map(mapShipment);
    },
    getById: async (id: number): Promise<Shipment | undefined> => {
      await ensureReferenceLookups();
      const backendId = toBackendId(id);
      if (!backendId) return undefined;
      const row = await httpClient.get<BackendShipmentRecord>(`/shipments/${backendId}`);
      return mapShipment(row);
    },
    create: async (data: Partial<Shipment>): Promise<Shipment> => {
      await ensureReferenceLookups();

      const senderBackendId = data.senderId ? toBackendId(data.senderId) : undefined;
      const receiverBackendId = data.receiverId ? toBackendId(data.receiverId) : undefined;
      const branchBackendId = data.branchId ? toBackendId(data.branchId) : undefined;
      const agentBackendId = data.agentId ? toBackendId(data.agentId) : undefined;

      if (!senderBackendId || !receiverBackendId || !branchBackendId) {
        throw new Error('Missing sender/receiver/branch mapping for backend shipment create.');
      }

      const rate = resolveExchangeRate(data);
      const backendStatus = mapShipmentStatusToBackend(data.status || 'DRAFT');
      const originalAmount = data.total || 0;

      // Always send financial payload for CONFIRMED shipments so posting is triggered.
      // Use AGENT when agentId is present; otherwise COMPANY_CASH (no party debit).
      const financial =
        backendStatus === 'CONFIRMED'
          ? {
              paymentMode: 'UNPAID' as const,
              ...(agentBackendId
                ? { financialResponsibilityType: 'AGENT' as const, financialResponsibilityId: agentBackendId }
                : { financialResponsibilityType: 'COMPANY_CASH' as const }),
              ...(originalAmount <= 0 ? { allowZeroAmountNote: 'شحنة مؤكدة بدون أجرة' } : {}),
            }
          : undefined;

      const created = await httpClient.post<BackendShipmentRecord>('/shipments', {
        shipmentNo: data.shipmentNo || `SHP-${Date.now()}`,
        referenceNo: data.shipmentNo || undefined,
        senderId: senderBackendId,
        receiverId: receiverBackendId,
        branchId: branchBackendId,
        agentId: agentBackendId,
        originCity: data.originName || data.branchName || '',
        destinationCity: data.destinationName || '',
        description: data.notes || data.goodsTypeName || '',
        piecesCount: data.quantity || 1,
        weightKg: typeof data.weight === 'number' && data.weight > 0 ? data.weight : undefined,
        status: backendStatus,
        originalAmount,
        originalCurrency: data.currency || 'USD',
        exchangeRateToUsd: rate,
        // Fee breakdown for COD statement
        freightCharge: data.freightCharge ?? originalAmount,
        transferFee: data.transferFee ?? 0,
        additionalCharges: data.additionalCharges ?? 0,
        prepaidAmount: data.prepaidAmount ?? 0,
        discountAmount: data.discount ?? 0,
        transferServiceFee: data.transferServiceFee ?? 0,
        ...(financial ? { financial } : {}),
      });
      return mapShipment(created);
    },
    update: async (id: number, data: Partial<Shipment>): Promise<Shipment> => {
      await ensureReferenceLookups();
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing shipment mapping for backend update.');

      const senderBackendId = data.senderId ? toBackendId(data.senderId) : undefined;
      const receiverBackendId = data.receiverId ? toBackendId(data.receiverId) : undefined;
      const branchBackendId = data.branchId ? toBackendId(data.branchId) : undefined;
      const agentBackendId = data.agentId ? toBackendId(data.agentId) : undefined;
      const rate = resolveExchangeRate(data);

      const updated = await httpClient.put<BackendShipmentRecord>(`/shipments/${backendId}`, {
        shipmentNo: data.shipmentNo,
        senderId: senderBackendId,
        receiverId: receiverBackendId,
        branchId: branchBackendId,
        agentId: agentBackendId,
        originCity: data.originName ?? data.branchName,
        destinationCity: data.destinationName,
        description: data.notes ?? data.goodsTypeName,
        piecesCount: data.quantity,
        weightKg: data.weight,
        status: data.status ? mapShipmentStatusToBackend(data.status) : undefined,
        originalAmount: data.total,
        originalCurrency: data.currency,
        exchangeRateToUsd: rate,
        freightCharge: data.freightCharge,
        transferFee: data.transferFee,
        additionalCharges: data.additionalCharges,
        prepaidAmount: data.prepaidAmount,
        discountAmount: data.discount,
        transferServiceFee: data.transferServiceFee,
      });
      return mapShipment(updated);
    },
    statusHistory: async (id: number) => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing shipment mapping for status history.');
      }
      const rows = await httpClient.get<BackendShipmentHistoryRow[]>(`/shipments/${backendId}/status-history`);
      return rows.map((row) => ({
        id: row.id,
        status: normalizeShipmentStatus(row.next_status || row.status),
        statusLabel: shipmentStatusLabelAr(row.next_status || row.status),
        previousStatus: normalizeShipmentStatus(row.previous_status || ''),
        note: row.note || '',
        changedBy: row.changed_by || '',
        changedAt: row.changed_at,
        source: row.source || '',
        metadata: row.metadata || {},
      }));
    },
    confirmShipment: async (
      id: number,
      payload?: {
        note?: string;
        metadata?: Record<string, unknown>;
        financial?: {
          paymentMode: 'UNPAID' | 'PAID_NOW' | 'PARTIAL';
          paidAmount?: number;
          cashboxId?: string;
          paymentMethod?: 'cash' | 'transfer' | 'other';
          payerPartyKind?: 'SENDER' | 'RECEIVER' | 'CUSTOMER';
          allowZeroAmountNote?: string;
        };
      },
    ) => {
      return phase15Gateway.shipments._postAction(id, 'confirm', payload);
    },
    getFinancialCard: async (id: number) => {
      const backendId = toBackendId(id);
      if (!backendId) return null;
      return httpClient.get<{
        shipmentNo: string;
        financialStatus: string;
        paymentStatus: string | null;
        totalCharge: number;
        paidAmount: number;
        remainingAmount: number;
        currency: string;
        payerNameSnapshot: string | null;
        payerPartyKind: string | null;
        financialResponsibilityType: string | null;
        financialResponsibilityId: string | null;
        defaultCashboxId: string | null;
        movements: unknown[];
        receiptVouchers: unknown[];
      }>(`/shipments/${backendId}/financial-card`);
    },
    repostFinancials: async (id: number) => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing shipment mapping for repost financials.');
      return httpClient.post<{ alreadyPosted: boolean; message: string }>(`/shipments/${backendId}/repost-financials`, {});
    },
    markShipmentReady: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'mark-ready', payload);
    },
    handoverShipmentToDriver: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'handover-driver', payload);
    },
    handoverShipmentToAgent: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'handover-agent', payload);
    },
    confirmAgentReceived: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'agent-received', payload);
    },
    markShipmentInTransit: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'mark-in-transit', payload);
    },
    markShipmentArrived: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'arrived', payload);
    },
    markShipmentOutForDelivery: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'out-for-delivery', payload);
    },
    deliverShipment: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'deliver', payload);
    },
    requestShipmentReturn: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'request-return', payload);
    },
    markShipmentReturned: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'mark-returned', payload);
    },
    cancelShipment: async (id: number, payload?: { note?: string; metadata?: Record<string, unknown> }) => {
      return phase15Gateway.shipments._postAction(id, 'cancel', payload);
    },
    _postAction: async (
      id: number,
      action:
        | 'confirm'
        | 'mark-ready'
        | 'handover-driver'
        | 'handover-agent'
        | 'agent-received'
        | 'mark-in-transit'
        | 'arrived'
        | 'out-for-delivery'
        | 'deliver'
        | 'request-return'
        | 'mark-returned'
        | 'cancel',
      payload?: { note?: string; metadata?: Record<string, unknown> },
    ): Promise<Shipment> => {
      const backendId = toBackendId(id);
      if (!backendId) {
        throw new Error('Missing shipment mapping for lifecycle action.');
      }
      const updated = await httpClient.post<BackendShipmentRecord>(`/shipments/${backendId}/${action}`, payload || {});
      return mapShipment(updated);
    },
  },
  manifests: {
    getAll: async (): Promise<Manifest[]> => {
      await ensureReferenceLookups();
      await phase15Gateway.shipments.getAll();

      const rows = await httpClient.get<BackendManifestRecord[]>('/manifests');
      const mapped: Manifest[] = [];
      for (const row of rows) {
        const details = await httpClient.get<BackendManifestRecord>(`/manifests/${row.id}`);
        const shipmentIds = (details.shipments || []).map((s) => mapShipment(s).id);
        const selectedShipments = shipmentIds.map((sid) => shipmentLookup.get(sid)).filter(Boolean) as Shipment[];
        mapped.push({
          id: toSyntheticId(row.id),
          manifestNo: row.manifest_no,
          date: row.created_at.split('T')[0],
          vehicleId: row.vehicle_id ? toSyntheticId(row.vehicle_id) : 0,
          vehiclePlate: row.vehicle_id ? (vehicleLookup.get(toSyntheticId(row.vehicle_id))?.plateNumber ?? '') : '',
          driverId: row.driver_id ? toSyntheticId(row.driver_id) : 0,
          driverName: row.driver_id ? (driverLookup.get(toSyntheticId(row.driver_id))?.name ?? '') : '',
          route: '',
          shipments: shipmentIds,
          totalWeight: selectedShipments.reduce((sum, s) => sum + (s.weight || 0), 0),
          totalShipments: shipmentIds.length,
          notes: '',
          status: mapManifestStatusToFrontend(row.status),
        });
      }
      return mapped;
    },
    create: async (data: Partial<Manifest>): Promise<Manifest> => {
      await ensureReferenceLookups();

      let branchBackendId: string | undefined;
      const linkedShipmentId = data.shipments?.find(Boolean);
      if (linkedShipmentId) {
        const sh = shipmentLookup.get(linkedShipmentId);
        if (sh?.branchId) {
          branchBackendId = toBackendId(sh.branchId);
        }
      }
      if (!branchBackendId) {
        const branches = await phase15Gateway.branches.getAll();
        if (branches[0]?.id) {
          branchBackendId = toBackendId(branches[0].id);
        }
      }
      if (!branchBackendId) {
        throw new Error('No branch available for manifest create.');
      }

      const created = await httpClient.post<BackendManifestRecord>('/manifests', {
        manifestNo: data.manifestNo || `MAN-${Date.now()}`,
        branchId: branchBackendId,
        vehicleId: data.vehicleId ? toBackendId(data.vehicleId) : undefined,
        driverId: data.driverId ? toBackendId(data.driverId) : undefined,
        status: mapManifestStatusToBackend(data.status || 'draft'),
        shipmentIds: (data.shipments || []).map((sid) => toBackendId(sid)).filter(Boolean),
      });

      const details = await httpClient.get<BackendManifestRecord>(`/manifests/${created.id}`);
      const shipments = (details.shipments || []).map((s) => mapShipment(s).id);
      const selectedShipments = shipments.map((sid) => shipmentLookup.get(sid)).filter(Boolean) as Shipment[];
      return {
        id: toSyntheticId(created.id),
        manifestNo: created.manifest_no,
        date: created.created_at.split('T')[0],
        vehicleId: created.vehicle_id ? toSyntheticId(created.vehicle_id) : 0,
        vehiclePlate: created.vehicle_id ? (vehicleLookup.get(toSyntheticId(created.vehicle_id))?.plateNumber ?? '') : '',
        driverId: created.driver_id ? toSyntheticId(created.driver_id) : 0,
        driverName: created.driver_id ? (driverLookup.get(toSyntheticId(created.driver_id))?.name ?? '') : '',
        route: data.route || '',
        shipments,
        totalWeight: selectedShipments.reduce((sum, s) => sum + (s.weight || 0), 0),
        totalShipments: shipments.length,
        notes: data.notes || '',
        status: mapManifestStatusToFrontend(created.status),
      };
    },
    update: async (id: number, data: Partial<Manifest>): Promise<Manifest> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing manifest mapping for backend update.');

      const updated = await httpClient.put<BackendManifestRecord>(`/manifests/${backendId}`, {
        vehicleId: data.vehicleId ? toBackendId(data.vehicleId) : undefined,
        driverId: data.driverId ? toBackendId(data.driverId) : undefined,
        status: data.status ? mapManifestStatusToBackend(data.status) : undefined,
        shipmentIds: data.shipments ? data.shipments.map((sid) => toBackendId(sid)).filter(Boolean) : undefined,
      });
      const details = await httpClient.get<BackendManifestRecord>(`/manifests/${updated.id}`);
      const shipments = (details.shipments || []).map((s) => mapShipment(s).id);
      const selectedShipments = shipments.map((sid) => shipmentLookup.get(sid)).filter(Boolean) as Shipment[];
      return {
        id: toSyntheticId(updated.id),
        manifestNo: updated.manifest_no,
        date: updated.created_at.split('T')[0],
        vehicleId: updated.vehicle_id ? toSyntheticId(updated.vehicle_id) : 0,
        vehiclePlate: updated.vehicle_id ? (vehicleLookup.get(toSyntheticId(updated.vehicle_id))?.plateNumber ?? '') : '',
        driverId: updated.driver_id ? toSyntheticId(updated.driver_id) : 0,
        driverName: updated.driver_id ? (driverLookup.get(toSyntheticId(updated.driver_id))?.name ?? '') : '',
        route: data.route || '',
        shipments,
        totalWeight: selectedShipments.reduce((sum, s) => sum + (s.weight || 0), 0),
        totalShipments: shipments.length,
        notes: data.notes || '',
        status: mapManifestStatusToFrontend(updated.status),
      };
    },
  },
  deliveries: {
    getAll: async (): Promise<Delivery[]> => {
      await phase15Gateway.shipments.getAll();
      const rows = await httpClient.get<BackendDeliveryRecord[]>('/deliveries');
      return rows.map((row) => {
        const shipmentId = toSyntheticId(row.shipment_id);
        const shipment = shipmentLookup.get(shipmentId);
        return {
          id: toSyntheticId(row.id),
          shipmentId,
          shipmentNo: shipment?.shipmentNo || '',
          recipientName: row.recipient_name || shipment?.receiverName || '',
          recipientPhone: shipment?.receiverPhone || '',
          deliveredAt: row.received_at,
          receivedAmount: Number(row.original_amount),
          currency: row.original_currency,
          exchangeRateToUsd: Number(row.exchange_rate_to_usd),
          receivedAmountUsd: Number(row.base_amount_usd),
          deliveryStatus: mapDeliveryStatusToFrontend(row.status),
          notes: row.notes || '',
        };
      });
    },
    create: async (data: Partial<Delivery>): Promise<Delivery> => {
      const shipmentBackendId = data.shipmentId ? toBackendId(data.shipmentId) : undefined;
      if (!shipmentBackendId) {
        throw new Error('Shipment mapping is required before creating delivery.');
      }
      const shipment = data.shipmentId ? shipmentLookup.get(data.shipmentId) : undefined;
      const rate = resolveExchangeRate(data);
      const created = await httpClient.post<BackendDeliveryRecord>('/deliveries', {
        deliveryNo: `DEL-${Date.now()}`,
        shipmentId: shipmentBackendId,
        branchId: shipment?.branchId ? toBackendId(shipment.branchId) : undefined,
        status: mapDeliveryStatusToBackend(data.deliveryStatus || 'pending'),
        recipientName: data.recipientName || '',
        receivedAt: data.deliveredAt || undefined,
        notes: [data.notes, data.failureReason].filter(Boolean).join(' | '),
        originalAmount: data.receivedAmount || 0,
        originalCurrency: data.currency || 'USD',
        exchangeRateToUsd: rate,
      });
      const shipmentId = toSyntheticId(created.shipment_id);
      const createdShipment = shipmentLookup.get(shipmentId);
      return {
        id: toSyntheticId(created.id),
        shipmentId,
        shipmentNo: createdShipment?.shipmentNo || '',
        recipientName: created.recipient_name || '',
        recipientPhone: createdShipment?.receiverPhone || '',
        deliveredAt: created.received_at,
        receivedAmount: Number(created.original_amount),
        currency: created.original_currency,
        exchangeRateToUsd: Number(created.exchange_rate_to_usd),
        receivedAmountUsd: Number(created.base_amount_usd),
        deliveryStatus: mapDeliveryStatusToFrontend(created.status),
        notes: created.notes || '',
      };
    },
    update: async (id: number, data: Partial<Delivery>): Promise<Delivery> => {
      const backendId = toBackendId(id);
      if (!backendId) throw new Error('Missing delivery mapping for backend update.');
      const rate = resolveExchangeRate(data);
      const updated = await httpClient.put<BackendDeliveryRecord>(`/deliveries/${backendId}`, {
        status: data.deliveryStatus ? mapDeliveryStatusToBackend(data.deliveryStatus) : undefined,
        recipientName: data.recipientName,
        receivedAt: data.deliveredAt,
        notes: [data.notes, data.failureReason].filter(Boolean).join(' | '),
        originalAmount: data.receivedAmount,
        originalCurrency: data.currency,
        exchangeRateToUsd: rate,
      });
      const shipmentId = toSyntheticId(updated.shipment_id);
      const shipment = shipmentLookup.get(shipmentId);
      return {
        id: toSyntheticId(updated.id),
        shipmentId,
        shipmentNo: shipment?.shipmentNo || '',
        recipientName: updated.recipient_name || '',
        recipientPhone: shipment?.receiverPhone || '',
        deliveredAt: updated.received_at,
        receivedAmount: Number(updated.original_amount),
        currency: updated.original_currency,
        exchangeRateToUsd: Number(updated.exchange_rate_to_usd),
        receivedAmountUsd: Number(updated.base_amount_usd),
        deliveryStatus: mapDeliveryStatusToFrontend(updated.status),
        notes: updated.notes || '',
      };
    },
  },
};
