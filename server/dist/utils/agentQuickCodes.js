export const AGENT_QUICK_CODES = [
    { code: '1', governorate: 'دمشق' },
    { code: '2', governorate: 'ريف دمشق' },
    { code: '3', governorate: 'حلب' },
    { code: '4', governorate: 'حمص' },
    { code: '5', governorate: 'حماة' },
    { code: '6', governorate: 'اللاذقية' },
    { code: '7', governorate: 'طرطوس' },
    { code: '8', governorate: 'إدلب' },
    { code: '9', governorate: 'الرقة' },
    { code: '10', governorate: 'الحسكة' },
    { code: '11', governorate: 'القامشلي' },
    { code: '12', governorate: 'دير الزور' },
    { code: '13', governorate: 'السويداء' },
    { code: '14', governorate: 'درعا' },
    { code: '15', governorate: 'القنيطرة' },
    { code: '16', governorate: 'منبج' },
];
export function normalizeGovernorate(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^وكيل\s+/u, '')
        .trim();
}
export function governorateLookupKey(value) {
    return normalizeGovernorate(value).toLowerCase();
}
export function normalizeQuickCode(value) {
    const trimmed = String(value ?? '').trim();
    if (!/^\d+$/.test(trimmed))
        return trimmed;
    return trimmed.replace(/^0+/, '') || '0';
}
export function findQuickCodeByGovernorate(governorate) {
    const key = governorateLookupKey(governorate);
    return AGENT_QUICK_CODES.find((entry) => governorateLookupKey(entry.governorate) === key);
}
export function canonicalQuickCodeForGovernorate(governorate) {
    return findQuickCodeByGovernorate(governorate)?.code ?? null;
}
