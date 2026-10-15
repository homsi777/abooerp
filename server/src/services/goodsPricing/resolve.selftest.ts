/**
 * Pure selftest for goodsPricing/resolve.ts — no database. Run via:
 *   npm run test:goods-pricing-resolve
 * (tsx server/src/services/goodsPricing/resolve.selftest.ts)
 */
import {
  resolvePrice,
  computeLineTotal,
  centsToDecimalString,
  decimalStringToCents,
  type ResolveContext,
} from './resolve.js';

let failures = 0;
let total = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  total += 1;
  const a = typeof actual === 'bigint' ? actual.toString() : actual;
  const e = typeof expected === 'bigint' ? expected.toString() : expected;
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function assertThrows(label: string, fn: () => void) {
  total += 1;
  try {
    fn();
    failures += 1;
    console.error(`FAIL ${label}: expected throw, did not throw`);
  } catch {
    console.log(`ok   ${label}`);
  }
}

// ── Fixture data, matching the task's illustrative example ────────────────
// G1 "ألبسة" (members: "كيس البسة", "كيس ألبسة"), general 3.00 / parcel.
// G2 "قطع تبديل" (members: "كرتونة قطع تبديل", "ك قطع تبديل", "كرتون قطع تبديل"), general 0.40 / kg.
// G3 "أحذية" (member: "كرتونة احذية"), general 2.00 / parcel.
// P1 "VIP Receiver" has G1 = 2.50 / parcel.
// P2 "VIP Sender" has G3 = 1.50 / parcel.
// P3 and P4 share the SAME normalized name "duplicate name"; P3 has a VIP price on G1.
const G1 = 'g1';
const G2 = 'g2';
const G3 = 'g3';
const P1 = 'p1';
const P2 = 'p2';
const P3 = 'p3';

function baseCtx(): ResolveContext {
  return {
    typeToGroup: new Map([
      ['كيس البسة', G1],
      ['كيس ألبسة', G1],
      ['كرتونة قطع تبديل', G2],
      ['ك قطع تبديل', G2],
      ['كرتون قطع تبديل', G2],
      ['كرتونة احذية', G3],
    ]),
    generalByGroup: new Map([
      [G1, { unit: 'parcel', unitPriceCents: 300n }],
      [G2, { unit: 'kg', unitPriceCents: 40n }],
      [G3, { unit: 'parcel', unitPriceCents: 200n }],
    ]),
    partyIdsByName: new Map([
      ['vip receiver', [P1]],
      ['vip sender', [P2]],
      ['duplicate name', [P3, 'p4']],
    ]),
    partyPrices: new Map([
      [`${P1}:${G1}`, { unit: 'parcel', unitPriceCents: 250n }],
      [`${P2}:${G3}`, { unit: 'parcel', unitPriceCents: 150n }],
      [`${P3}:${G1}`, { unit: 'parcel', unitPriceCents: 999n }],
    ]),
  };
}

// 1. General only
{
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'unknown a', receiverNorm: 'unknown b' }, baseCtx());
  assertEqual('1 status', r.status, 'priced');
  assertEqual('1 source', r.source, 'general');
  assertEqual('1 unitPriceCents', r.unitPriceCents, 300n);
  assertEqual('1 total', computeLineTotal('parcel', 10, null, r.unitPriceCents), 3000n);
}

// 2. Variants resolve to the same group/price
{
  const ctx = baseCtx();
  const r1 = resolvePrice({ parcelTypeNorm: 'ك قطع تبديل', senderNorm: 'x', receiverNorm: 'y' }, ctx);
  const r2 = resolvePrice({ parcelTypeNorm: 'كرتون قطع تبديل', senderNorm: 'x', receiverNorm: 'y' }, ctx);
  assertEqual('2 same group', r1.groupId, r2.groupId);
  assertEqual('2 same price', r1.unitPriceCents, r2.unitPriceCents);
}

// 3. VIP receiver + unknown sender
{
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'unknown', receiverNorm: 'vip receiver' }, baseCtx());
  assertEqual('3 status', r.status, 'priced');
  assertEqual('3 source', r.source, 'party');
  assertEqual('3 partyId', r.partyId, P1);
  assertEqual('3 unitPriceCents', r.unitPriceCents, 250n);
  assertEqual('3 total', computeLineTotal('parcel', 10, null, r.unitPriceCents), 2500n);
}

// 4. VIP sender (reverse case) + unknown receiver
{
  const r = resolvePrice({ parcelTypeNorm: 'كرتونة احذية', senderNorm: 'vip sender', receiverNorm: 'unknown' }, baseCtx());
  assertEqual('4 status', r.status, 'priced');
  assertEqual('4 source', r.source, 'party');
  assertEqual('4 partyId', r.partyId, P2);
  assertEqual('4 total', computeLineTotal('parcel', 4, null, r.unitPriceCents), 600n);
}

// 5. Both sides VIP for the same group -> conflict; manual entry used instead
{
  const ctx = baseCtx();
  // make the receiver ALSO a VIP for G1 to force a genuine two-sided conflict
  ctx.partyIdsByName.set('also vip', ['p5']);
  ctx.partyPrices.set('p5:g1', { unit: 'parcel', unitPriceCents: 777n });
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'vip receiver', receiverNorm: 'also vip' }, ctx);
  assertEqual('5 status', r.status, 'conflict');
  assertEqual('5 no unitPriceCents', r.unitPriceCents, undefined);
  const manualCents = decimalStringToCents('2.00');
  assertEqual('5 manual total', computeLineTotal('parcel', 3, null, manualCents), 600n);
}

// 6. Sender and receiver are the SAME VIP party with a price -> conflict
{
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'duplicate name', receiverNorm: 'duplicate name' }, baseCtx());
  // "duplicate name" is itself ambiguous (P3/P4), so it never resolves to a
  // single party here — this covers the *other* required case (#10) that a
  // shared name never applies a VIP. The genuine "same single party twice"
  // case is exercised in test 5b below with an unambiguous name.
  assertEqual('6 ambiguous both sides', r.senderAmbiguous && r.receiverAmbiguous, true);
  assertEqual('6 status falls back to general', r.status, 'priced');
  assertEqual('6 source general', r.source, 'general');
}
{
  // 5b: a single, unambiguous party typed as both sender and receiver
  const ctx = baseCtx();
  ctx.partyIdsByName.set('solo vip', ['p6']);
  ctx.partyPrices.set('p6:g1', { unit: 'parcel', unitPriceCents: 500n });
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'solo vip', receiverNorm: 'solo vip' }, ctx);
  assertEqual('5b same-party-both-sides -> conflict', r.status, 'conflict');
}

// 7. VIP person with a price only on G1, row of group G3 -> falls back to general G3
{
  const r = resolvePrice({ parcelTypeNorm: 'كرتونة احذية', senderNorm: 'unknown', receiverNorm: 'vip receiver' }, baseCtx());
  assertEqual('7 status', r.status, 'priced');
  assertEqual('7 source', r.source, 'general');
  assertEqual('7 unitPriceCents', r.unitPriceCents, 200n);
}

// 8. Unmapped parcel_type -> no_group; manual entry
{
  const r = resolvePrice({ parcelTypeNorm: 'شيء غير معروف تماما', senderNorm: 'a', receiverNorm: 'b' }, baseCtx());
  assertEqual('8 status', r.status, 'no_group');
  const manualCents = decimalStringToCents('2.00');
  assertEqual('8 manual total', computeLineTotal('parcel', 3, null, manualCents), 600n);
}

// 9. Group exists but has no general price and no VIP -> no_price
{
  const ctx = baseCtx();
  ctx.typeToGroup.set('صنف بلا سعر', 'g-empty');
  const r = resolvePrice({ parcelTypeNorm: 'صنف بلا سعر', senderNorm: 'a', receiverNorm: 'b' }, ctx);
  assertEqual('9 status', r.status, 'no_price');
}

// 10. Ambiguous name -> no VIP, falls back to general, ambiguous flag true
{
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'duplicate name', receiverNorm: 'unknown' }, baseCtx());
  assertEqual('10 status', r.status, 'priced');
  assertEqual('10 source', r.source, 'general');
  assertEqual('10 senderAmbiguous', r.senderAmbiguous, true);
}

// 11. Normalization: extra spaces / case — resolver trusts pre-normalized
// input (normalizeName is applied by the caller); verify case-sensitivity
// contract explicitly: this map is keyed by whatever the caller passed in
// AFTER calling the shared normalizeName, which does NOT lowercase — so the
// caller must lowercase before using this ctx, exactly like the SQL loaders
// do. This test documents that contract rather than re-testing normalizeName
// itself (already covered by dailyLedgerShipmentPostingService's own code).
{
  const ctx = baseCtx();
  const r = resolvePrice({ parcelTypeNorm: 'كيس البسة', senderNorm: 'VIP RECEIVER'.toLowerCase(), receiverNorm: 'unknown' }, ctx);
  assertEqual('11 lowercase match', r.source, 'party');
}

// 12. Units: kg math, and NULL quantity -> NULL total
{
  assertEqual('12 kg total', computeLineTotal('kg', null, '20.50', 40n), 820n);
  assertEqual('12 null weight -> null', computeLineTotal('kg', null, null, 40n), null);
  assertEqual('12 null parcel_count -> null', computeLineTotal('parcel', null, null, 300n), null);
}

// 13. Rounding (half-up, matches PostgreSQL ROUND) + large quantities
{
  assertEqual('13a 2.50kg x 0.05', computeLineTotal('kg', null, '2.50', 5n), 13n);
  assertEqual('13b 3.33kg x 1.25', computeLineTotal('kg', null, '3.33', 125n), 416n);
  assertEqual('13c 1192 x 3.00', computeLineTotal('parcel', 1192, null, 300n), 357600n);
  assertEqual('13d 11070.00kg x 0.40', computeLineTotal('kg', null, '11070.00', 40n), 442800n);
  assertEqual('13e quantity 0', computeLineTotal('parcel', 0, null, 300n), 0n);
}

// 14. Input validation: negative / NaN / >2 decimals / non-numeric rejected
{
  assertThrows('14a negative', () => decimalStringToCents('-1.00'));
  assertThrows('14b NaN', () => decimalStringToCents('abc'));
  assertThrows('14c 3 decimals', () => decimalStringToCents('1.234'));
  assertThrows('14d non-numeric weight', () => computeLineTotal('kg', null, 'abc', 40n));
}

// centsToDecimalString / decimalStringToCents round-trip
{
  assertEqual('round-trip 1', centsToDecimalString(decimalStringToCents('40.00')), '40.00');
  assertEqual('round-trip 2', centsToDecimalString(decimalStringToCents('0.05')), '0.05');
  assertEqual('round-trip 3', centsToDecimalString(0n), '0.00');
}

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
