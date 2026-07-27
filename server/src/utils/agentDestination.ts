export function normalizeDestinationKey(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalized numeric key for codes like "013" and "13". */
export function numericCodeKey(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed.replace(/^0+/, '') || '0';
}

export function resolveAgentDestinationLabel(agent: {
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
  name?: string | null;
}): string {
  const governorate = String(agent.governorate ?? '').trim().replace(/\s+/g, ' ');
  if (governorate) return governorate;
  const location = [agent.city, agent.area]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' / ');
  if (location) return location;
  return String(agent.name ?? '').trim().replace(/\s+/g, ' ');
}
