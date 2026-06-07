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
];
const LEGACY_TO_CANONICAL = {
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
export const SHIPMENT_TRANSITIONS = {
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
export const TERMINAL_SHIPMENT_STATUSES = new Set([
    'CANCELLED',
    'FINANCIALLY_CLOSED',
]);
function isCanonicalStatus(value) {
    return CANONICAL_SHIPMENT_STATUSES.includes(value);
}
function isLegacyStatus(value) {
    return Object.prototype.hasOwnProperty.call(LEGACY_TO_CANONICAL, value);
}
export function normalizeShipmentStatus(value) {
    if (!value)
        return 'UNKNOWN';
    const trimmed = String(value).trim();
    if (!trimmed)
        return 'UNKNOWN';
    if (isCanonicalStatus(trimmed))
        return trimmed;
    const upper = trimmed.toUpperCase();
    if (isCanonicalStatus(upper))
        return upper;
    const lower = trimmed.toLowerCase();
    if (isLegacyStatus(lower))
        return LEGACY_TO_CANONICAL[lower];
    return 'UNKNOWN';
}
export function canTransitionShipmentStatus(current, next) {
    if (current === next)
        return true;
    return SHIPMENT_TRANSITIONS[current].includes(next);
}
