import {
  findAgentByQuickCode,
  governorateLookupKey as quickCodeGovernorateKey,
} from '../agents/agentQuickCodes';

export type AgentDestinationCandidate = {
  id: number | string;
  code: string;
  name: string;
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
  created_at?: string;
  is_active?: boolean;
};

function normalizeDestinationKey(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function governorateLookupKey(governorate: string | null | undefined): string {
  return quickCodeGovernorateKey(governorate);
}

/** When several active agents share the same governorate, prefer a single numeric quick code. */
export function pickPreferredAgentForGovernorate<T extends AgentDestinationCandidate>(
  agents: T[],
): T | null {
  if (!agents.length) return null;
  if (agents.length === 1) return agents[0];

  const numeric = agents.filter((agent) => /^\d+$/.test(String(agent.code ?? '').trim()));
  if (numeric.length === 1) return numeric[0];
  if (numeric.length > 1) {
    return [...numeric].sort((a, b) => {
      const na = Number(String(a.code).replace(/^0+/, '') || '0');
      const nb = Number(String(b.code).replace(/^0+/, '') || '0');
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    })[0] ?? null;
  }
  return [...agents].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0] ?? null;
}

export function dedupeAgentsForDestination<T extends AgentDestinationCandidate>(
  agents: T[],
  destination: string,
): T[] {
  if (agents.length <= 1) return agents;

  const destKey = governorateLookupKey(destination) || normalizeDestinationKey(destination);
  const byGovernorate = agents.filter((agent) => governorateLookupKey(agent.governorate) === destKey);
  if (!byGovernorate.length) return agents;
  if (byGovernorate.length === 1) return byGovernorate;

  const preferred = pickPreferredAgentForGovernorate(byGovernorate);
  return preferred ? [preferred] : byGovernorate;
}

export function resolveGovernorateFromAgentCode<T extends AgentDestinationCandidate>(
  code: string,
  agents: T[],
): string | null {
  const match = findAgentByQuickCode(agents, code);
  if (!match?.governorate) return null;
  return String(match.governorate).trim().replace(/^وكيل\s+/u, '').trim() || null;
}
