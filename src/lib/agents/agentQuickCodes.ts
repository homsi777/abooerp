export type AgentQuickCodeEntry = {
  code: string;
  governorate: string;
  name?: string;
};

export type AgentQuickCodeSource = {
  code: string;
  name?: string;
  governorate?: string | null;
  is_active?: boolean;
};

/** قيم افتراضية مقترحة عند إنشاء وكيل جديد فقط — ليست مصدر الحقيقة للعرض. */
export const AGENT_QUICK_CODE_TEMPLATES: AgentQuickCodeEntry[] = [
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

/** @deprecated استخدم AGENT_QUICK_CODE_TEMPLATES أو buildQuickCodesFromAgents */
export const AGENT_QUICK_CODES = AGENT_QUICK_CODE_TEMPLATES;

export function normalizeGovernorate(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^وكيل\s+/u, '')
    .trim();
}

export function governorateLookupKey(value: string | null | undefined): string {
  return normalizeGovernorate(value).toLowerCase();
}

export function normalizeQuickCode(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/^0+/, '') || '0';
}

function sortQuickCodeEntries(entries: AgentQuickCodeEntry[]): AgentQuickCodeEntry[] {
  return [...entries].sort((a, b) => {
    const na = /^\d+$/.test(a.code) ? Number(a.code) : Number.NaN;
    const nb = /^\d+$/.test(b.code) ? Number(b.code) : Number.NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if (!Number.isNaN(na)) return -1;
    if (!Number.isNaN(nb)) return 1;
    return a.governorate.localeCompare(b.governorate, 'ar');
  });
}

/** يبني جدول الاختصارات من الوكلاء الفعليين — يتحدّث عند تعديل الكود في قسم الوكلاء. */
export function buildQuickCodesFromAgents(
  agents: AgentQuickCodeSource[],
  options?: { activeOnly?: boolean },
): AgentQuickCodeEntry[] {
  const activeOnly = options?.activeOnly !== false;
  const entries = agents
    .filter((agent) => agent.governorate?.trim() && (!activeOnly || agent.is_active !== false))
    .map((agent) => ({
      code: String(agent.code ?? '').trim(),
      governorate: normalizeGovernorate(agent.governorate),
      name: agent.name?.trim() || undefined,
    }))
    .filter((entry) => entry.code && entry.governorate);
  return sortQuickCodeEntries(entries);
}

export function findTemplateByGovernorate(governorate: string): AgentQuickCodeEntry | undefined {
  const key = governorateLookupKey(governorate);
  return AGENT_QUICK_CODE_TEMPLATES.find((entry) => governorateLookupKey(entry.governorate) === key);
}

/** @deprecated استخدم findTemplateByGovernorate */
export function findQuickCodeByGovernorate(governorate: string): AgentQuickCodeEntry | undefined {
  return findTemplateByGovernorate(governorate);
}

export function findQuickCodeByCode(code: string): AgentQuickCodeEntry | undefined {
  const normalized = normalizeQuickCode(code);
  return AGENT_QUICK_CODE_TEMPLATES.find((entry) => entry.code === normalized);
}

export function findAgentByQuickCode(
  agents: AgentQuickCodeSource[],
  code: string,
  options?: { activeOnly?: boolean },
): AgentQuickCodeSource | undefined {
  const activeOnly = options?.activeOnly !== false;
  const normalized = normalizeQuickCode(code);
  return agents.find(
    (agent) =>
      (!activeOnly || agent.is_active !== false) &&
      normalizeQuickCode(agent.code) === normalized &&
      Boolean(agent.governorate?.trim()),
  );
}

export function resolveGovernorateFromQuickCode(
  input: string,
  agents: AgentQuickCodeSource[] = [],
): string | null {
  const fromAgent = findAgentByQuickCode(agents, input);
  if (fromAgent?.governorate) return normalizeGovernorate(fromAgent.governorate);
  return findQuickCodeByCode(input)?.governorate ?? null;
}

export function suggestedQuickCodeForGovernorate(
  governorate: string,
  agents: AgentQuickCodeSource[] = [],
): string | null {
  const key = governorateLookupKey(governorate);
  const existing = agents.find(
    (agent) => agent.is_active !== false && governorateLookupKey(agent.governorate) === key,
  );
  if (existing?.code?.trim()) return existing.code.trim();
  return findTemplateByGovernorate(governorate)?.code ?? null;
}

export function canonicalQuickCodeForGovernorate(
  governorate: string,
  agents: AgentQuickCodeSource[] = [],
): string | null {
  const key = governorateLookupKey(governorate);
  const active = agents.filter(
    (agent) => agent.is_active !== false && governorateLookupKey(agent.governorate) === key,
  );
  if (active.length === 1) return active[0].code.trim();
  return suggestedQuickCodeForGovernorate(governorate, agents);
}

export function listDuplicateActiveGovernorates(
  agents: Array<{ id: string; code: string; name: string; governorate?: string | null; is_active: boolean }>,
): Array<{ governorate: string; agents: Array<{ id: string; code: string; name: string }> }> {
  const byGov = new Map<string, Array<{ id: string; code: string; name: string }>>();
  for (const agent of agents) {
    if (!agent.is_active) continue;
    const key = governorateLookupKey(agent.governorate);
    if (!key) continue;
    const list = byGov.get(key) ?? [];
    list.push({ id: agent.id, code: agent.code, name: agent.name });
    byGov.set(key, list);
  }
  return [...byGov.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const sample = agents.find((agent) => agent.id === list[0]?.id);
      return {
        governorate: normalizeGovernorate(sample?.governorate) || key,
        agents: list,
      };
    });
}
