import { normalizeDestinationKey } from './agentDestination.js';
import { normalizeQuickCode } from './agentQuickCodes.js';
import { governorateLookupKey } from './agentValidation.js';
/** When several active agents share the same governorate, prefer a single numeric quick code. */
export function pickPreferredAgentForGovernorate(agents) {
    if (!agents.length)
        return null;
    if (agents.length === 1)
        return agents[0];
    const numeric = agents.filter((agent) => /^\d+$/.test(String(agent.code ?? '').trim()));
    if (numeric.length === 1)
        return numeric[0];
    if (numeric.length > 1) {
        return [...numeric].sort((a, b) => {
            const na = Number(normalizeQuickCode(a.code));
            const nb = Number(normalizeQuickCode(b.code));
            if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb)
                return na - nb;
            return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
        })[0] ?? null;
    }
    return [...agents].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0] ?? null;
}
export function dedupeAgentsForDestination(agents, destination) {
    if (agents.length <= 1)
        return agents;
    const destKey = governorateLookupKey(destination) || normalizeDestinationKey(destination);
    const byGovernorate = agents.filter((agent) => governorateLookupKey(agent.governorate) === destKey);
    if (!byGovernorate.length)
        return agents;
    if (byGovernorate.length === 1)
        return byGovernorate;
    const preferred = pickPreferredAgentForGovernorate(byGovernorate);
    return preferred ? [preferred] : byGovernorate;
}
export function formatAgentCodes(agents) {
    return agents.map((agent) => agent.code).join('، ');
}
