import { normalizeDestinationKey } from './agentDestination.js';
export function agentDestinationHints(scope) {
    const raw = [scope.agentArea, scope.agentCity, scope.agentGovernorate]
        .filter((v) => Boolean(v && String(v).trim()))
        .map((v) => normalizeDestinationKey(v))
        .filter(Boolean);
    return [...new Set(raw)];
}
export function destinationMatchesAgentHints(destination, hints) {
    if (!hints.length)
        return false;
    const key = normalizeDestinationKey(destination);
    if (!key)
        return false;
    return hints.some((hint) => key === hint || key.includes(hint) || hint.includes(key));
}
export function filterRowsForAgent(rows, hints) {
    if (!hints.length)
        return [];
    return rows.filter((row) => destinationMatchesAgentHints(row.destination, hints));
}
function addDaysIso(isoDate, deltaDays) {
    const base = isoDate.slice(0, 10);
    const d = new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}
export function computeAgentTransitStatus(ledgerDate, printedAt, todayIso = new Date().toISOString().slice(0, 10)) {
    const ledger = ledgerDate.slice(0, 10);
    const today = todayIso.slice(0, 10);
    const printedMs = Date.parse(printedAt);
    const daysSincePrint = Number.isFinite(printedMs) ? (Date.now() - printedMs) / 86_400_000 : 999;
    if (ledger >= addDaysIso(today, -2) && daysSincePrint <= 5) {
        return { transitStatus: 'en_route', transitStatusLabel: 'في الطريق إليك' };
    }
    if (ledger >= addDaysIso(today, -7) && daysSincePrint <= 14) {
        return { transitStatus: 'dispatched', transitStatusLabel: 'خرجت من الفرع الرئيسي' };
    }
    return { transitStatus: 'historical', transitStatusLabel: 'سجل سابق' };
}
export function appendAgentPrintDocumentScope(conditions, values, hints) {
    if (!hints.length) {
        conditions.push('1 = 0');
        return;
    }
    values.push(hints);
    const hintsParam = `$${values.length}`;
    conditions.push(`(
    lower(trim(coalesce(d.destination_label, ''))) = any(${hintsParam}::text[])
    or lower(trim(coalesce(d.search_query, ''))) = any(${hintsParam}::text[])
    or exists (
      select 1
      from jsonb_array_elements(d.rows_snapshot) snap(row)
      where lower(trim(coalesce(snap.row->>'destination', ''))) = any(${hintsParam}::text[])
        or exists (
          select 1
          from unnest(${hintsParam}::text[]) hint(value)
          where lower(trim(coalesce(snap.row->>'destination', ''))) like '%' || hint.value || '%'
            or hint.value like '%' || lower(trim(coalesce(snap.row->>'destination', ''))) || '%'
        )
    )
    or exists (
      select 1
      from unnest(${hintsParam}::text[]) hint(value)
      where lower(trim(coalesce(d.destination_label, ''))) like '%' || hint.value || '%'
        or lower(trim(coalesce(d.search_query, ''))) like '%' || hint.value || '%'
    )
  )`);
}
