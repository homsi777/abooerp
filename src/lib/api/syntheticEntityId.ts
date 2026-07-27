const stringIdToNumber = new Map<string, number>();
const numberIdToString = new Map<number, string>();
let nextSyntheticId = 100000;

function toSyntheticId(id: string): number {
  const existing = stringIdToNumber.get(id);
  if (existing) return existing;
  nextSyntheticId += 1;
  stringIdToNumber.set(id, nextSyntheticId);
  numberIdToString.set(nextSyntheticId, id);
  return nextSyntheticId;
}

function toBackendId(id: number): string | undefined {
  return numberIdToString.get(id);
}

export function getBackendIdFromSynthetic(id: number): string | undefined {
  return toBackendId(id);
}

/** Stable synthetic numeric id for a backend UUID (used when prefilling agent row from session). */
export function syntheticEntityId(backendUuid: string): number {
  return toSyntheticId(backendUuid);
}
