import { normalizeDestinationKey } from './agentDestination.js';

export type AgentFieldInput = {
  code?: string;
  name?: string;
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
  is_active?: boolean;
};

export function normalizeAgentCode(code: string): string {
  return code.trim();
}

export function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** وجهة الدفتر = المحافظة بعد إزالة «وكيل » وتنظيف المسافات. */
export function normalizeAgentGovernorate(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.replace(/^وكيل\s+/u, '').trim() || null;
}

export function normalizeOptionalLocation(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  return trimmed || null;
}

export function prepareAgentFields(input: AgentFieldInput): Required<Pick<AgentFieldInput, 'code' | 'name'>> & AgentFieldInput {
  return {
    code: normalizeAgentCode(String(input.code ?? '')),
    name: normalizeAgentName(String(input.name ?? '')),
    governorate: normalizeAgentGovernorate(input.governorate),
    city: normalizeOptionalLocation(input.city),
    area: normalizeOptionalLocation(input.area),
    is_active: input.is_active,
  };
}

export function governorateLookupKey(governorate: string | null | undefined): string {
  return normalizeDestinationKey(normalizeAgentGovernorate(governorate) ?? '');
}
