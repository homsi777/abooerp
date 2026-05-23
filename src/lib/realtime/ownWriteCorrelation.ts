/** Ring buffer of correlation IDs from our own successful writes — to ignore matching SSE echoes. */
const RING_MAX = 48;
const ring: string[] = [];

export function rememberOwnCorrelationFromFetchResponse(response: Response): void {
  const id = response.headers.get('x-correlation-id')?.trim();
  if (!id) return;
  ring.push(id);
  while (ring.length > RING_MAX) ring.shift();
}

export function isOwnCorrelationId(id: string | null | undefined): boolean {
  if (!id) return false;
  return ring.includes(id);
}
