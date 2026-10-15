import { useEffect, useRef, useState } from 'react';
import { goodsPricingGateway, type PricingUnit, type ResolveResponse } from '../../lib/api/goodsPricingGateway';
import { computeLineTotal } from '../../lib/shipping/goodsPricingTotal';

const DEBOUNCE_MS = 400;

/** module-level memo cache: survives across row re-renders/scrolling (virtualized list) */
const resolveCache = new Map<string, ResolveResponse>();
function cacheKey(parcelType: string, sender: string, receiver: string): string {
  return `${parcelType.trim().toLowerCase()}|${sender.trim().toLowerCase()}|${receiver.trim().toLowerCase()}`;
}

export interface GoodsPriceCellResult {
  unitPriceUsd: string | null;
  pricingUnit: PricingUnit | null;
  lineTotalUsd: string | null;
  source: 'party' | 'general' | null;
  conflict: boolean;
}

/**
 * Isolated unit-price + line-total cell for one ledger row. All goods-pricing
 * logic (debounce, memoized lookup, manual-override flag) lives here — the
 * ledger table itself only renders this component and reacts to its
 * onResolved callback. Never blocks the row: on any lookup failure the price
 * field just stays empty/editable.
 */
export default function GoodsPriceCell({
  parcelType,
  senderName,
  receiverName,
  parcelCount,
  weightKg,
  unitPriceUsd,
  pricingUnit,
  priceSource,
  priceManual,
  disabled,
  onManualChange,
  onResolved,
}: {
  parcelType: string;
  senderName: string;
  receiverName: string;
  parcelCount: string;
  weightKg: string;
  unitPriceUsd: string;
  pricingUnit: PricingUnit | null | undefined;
  priceSource: 'party' | 'general' | 'manual' | null | undefined;
  priceManual: boolean | undefined;
  disabled?: boolean;
  onManualChange: (value: string) => void;
  onResolved: (result: GoodsPriceCellResult) => void;
}) {
  const [conflict, setConflict] = useState(false);
  const lastKeyRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (priceManual) return; // employee already took over — never auto-overwrite.
    const key = cacheKey(parcelType, senderName, receiverName);
    if (!parcelType.trim() && !senderName.trim() && !receiverName.trim()) return;
    if (key === lastKeyRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastKeyRef.current = key;
      const cached = resolveCache.get(key);
      if (cached) {
        applyResolved(cached);
        return;
      }
      goodsPricingGateway.ledger
        .resolve({ parcelType, senderName, receiverName })
        .then((result) => {
          resolveCache.set(key, result);
          applyResolved(result);
        })
        .catch(() => {
          // Lookup failed — row stays fully usable, price field stays as-is.
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelType, senderName, receiverName, priceManual]);

  // Recompute total locally and instantly when quantity changes (no network call).
  useEffect(() => {
    if (!unitPriceUsd || !pricingUnit) return;
    const total = computeLineTotal(pricingUnit, parcelCount ? Number(parcelCount) : null, weightKg || null, unitPriceUsd);
    onResolved({ unitPriceUsd, pricingUnit, lineTotalUsd: total, source: priceSource === 'manual' ? null : (priceSource ?? null), conflict: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelCount, weightKg]);

  function applyResolved(result: ResolveResponse) {
    setConflict(result.conflict);
    if (result.status !== 'priced') {
      onResolved({ unitPriceUsd: null, pricingUnit: null, lineTotalUsd: null, source: null, conflict: result.conflict });
      return;
    }
    onResolved({
      unitPriceUsd: result.unitPriceUsd,
      pricingUnit: result.unit,
      lineTotalUsd: result.lineTotalUsd,
      source: result.source,
      conflict: false,
    });
  }

  const showVipTag = priceSource === 'party';
  const showManualTag = priceManual && priceSource === 'manual';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center' }}>
      <input
        type="text"
        inputMode="decimal"
        value={unitPriceUsd}
        disabled={disabled}
        placeholder={conflict ? 'يدوي؟' : '—'}
        title={conflict ? 'سعر VIP للمرسل والمستلم معاً، أدخل السعر يدوياً' : undefined}
        onChange={(e) => onManualChange(e.target.value)}
        style={{ width: '64px', textAlign: 'center', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '3px', padding: '2px' }}
      />
      {showVipTag && <span style={{ fontSize: '9.5px', color: '#0f766e', fontWeight: 700 }}>سعر VIP</span>}
      {showManualTag && <span style={{ fontSize: '9.5px', color: '#92400e', fontWeight: 700 }}>معدّل يدوياً</span>}
      {conflict && !unitPriceUsd && <span style={{ fontSize: '9px', color: '#b91c1c' }}>أدخل السعر يدوياً</span>}
    </div>
  );
}
