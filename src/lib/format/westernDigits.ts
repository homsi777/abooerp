/** عرض أرقام وتواريخ بأرقام لاتينية 0-9 (وليس ٠-٩) — مطلوب في واجهة ERP العربية. */

export const WESTERN_LOCALE = 'en-US';

export function formatWesternNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions,
): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(WESTERN_LOCALE, options ?? { maximumFractionDigits: 2 });
}

export function formatWesternDateTime(value: unknown): string {
  if (value == null || value === '') return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(WESTERN_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatWesternDate(value: unknown): string {
  if (value == null || value === '') return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(WESTERN_LOCALE);
}
