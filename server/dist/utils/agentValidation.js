import { normalizeDestinationKey } from './agentDestination.js';
export function normalizeAgentCode(code) {
    return code.trim();
}
export function normalizeAgentName(name) {
    return name.trim().replace(/\s+/g, ' ');
}
/** وجهة الدفتر = المحافظة بعد إزالة «وكيل » وتنظيف المسافات. */
export function normalizeAgentGovernorate(value) {
    const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!trimmed)
        return null;
    return trimmed.replace(/^وكيل\s+/u, '').trim() || null;
}
export function normalizeOptionalLocation(value) {
    const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
    return trimmed || null;
}
export function prepareAgentFields(input) {
    return {
        code: normalizeAgentCode(String(input.code ?? '')),
        name: normalizeAgentName(String(input.name ?? '')),
        governorate: normalizeAgentGovernorate(input.governorate),
        city: normalizeOptionalLocation(input.city),
        area: normalizeOptionalLocation(input.area),
        is_active: input.is_active,
    };
}
export function governorateLookupKey(governorate) {
    return normalizeDestinationKey(normalizeAgentGovernorate(governorate) ?? '');
}
