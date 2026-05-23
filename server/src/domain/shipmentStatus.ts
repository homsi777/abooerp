export const CANONICAL_SHIPMENT_STATUSES = [
  'DRAFT',
  'REGISTERED',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'HANDED_TO_DRIVER',
  'HANDED_TO_AGENT',
  'AGENT_RECEIVED',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
  'CANCELLED',
  'FINANCIALLY_CLOSED',
] as const;

export type CanonicalShipmentStatus = (typeof CANONICAL_SHIPMENT_STATUSES)[number];

export type LegacyShipmentStatus =
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
  | 'cancelled';

const LEGACY_TO_CANONICAL: Record<LegacyShipmentStatus, CanonicalShipmentStatus> = {
  created: 'REGISTERED',
  draft: 'DRAFT',
  confirmed: 'CONFIRMED',
  loaded: 'HANDED_TO_DRIVER',
  manifested: 'HANDED_TO_DRIVER',
  in_transit: 'IN_TRANSIT',
  arrived: 'ARRIVED_AT_DESTINATION',
  ready_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  returned: 'RETURNED',
  cancelled: 'CANCELLED',
};

export const SHIPMENT_TRANSITIONS: Record<CanonicalShipmentStatus, CanonicalShipmentStatus[]> = {
  DRAFT: ['REGISTERED', 'CANCELLED'],
  REGISTERED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'],
  READY_FOR_PICKUP: ['HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'],
  HANDED_TO_DRIVER: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  HANDED_TO_AGENT: ['AGENT_RECEIVED', 'RETURN_REQUESTED'],
  AGENT_RECEIVED: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'],
  ARRIVED_AT_DESTINATION: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURN_REQUESTED'],
  DELIVERED: ['FINANCIALLY_CLOSED', 'RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED'],
  RETURNED: ['FINANCIALLY_CLOSED'],
  CANCELLED: [],
  FINANCIALLY_CLOSED: [],
};

export const TERMINAL_SHIPMENT_STATUSES: ReadonlySet<CanonicalShipmentStatus> = new Set([
  'CANCELLED',
  'FINANCIALLY_CLOSED',
]);

function isCanonicalStatus(value: string): value is CanonicalShipmentStatus {
  return (CANONICAL_SHIPMENT_STATUSES as readonly string[]).includes(value);
}

function isLegacyStatus(value: string): value is LegacyShipmentStatus {
  return Object.prototype.hasOwnProperty.call(LEGACY_TO_CANONICAL, value);
}

export function normalizeShipmentStatus(value: string | null | undefined): CanonicalShipmentStatus | 'UNKNOWN' {
  if (!value) return 'UNKNOWN';
  const trimmed = String(value).trim();
  if (!trimmed) return 'UNKNOWN';
  if (isCanonicalStatus(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (isCanonicalStatus(upper)) return upper;
  const lower = trimmed.toLowerCase();
  if (isLegacyStatus(lower)) return LEGACY_TO_CANONICAL[lower];
  return 'UNKNOWN';
}

export function canTransitionShipmentStatus(
  current: CanonicalShipmentStatus,
  next: CanonicalShipmentStatus,
) {
  if (current === next) return true;
  return SHIPMENT_TRANSITIONS[current].includes(next);
}

