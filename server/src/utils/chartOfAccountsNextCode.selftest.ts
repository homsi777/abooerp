/**
 * Pure selftest for chartOfAccountsNextCode.ts — no database. Run via:
 *   npm run test:chart-of-accounts-next-code
 * (tsx server/src/utils/chartOfAccountsNextCode.selftest.ts)
 */
import { computeNextAccountCode } from './chartOfAccountsNextCode.js';

let failures = 0;
let total = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  total += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ── Task's own worked examples (Section 4.4) ───────────────────────────────

assertEqual(
  'parent 3000, child 3100 -> 3200',
  computeNextAccountCode(3000, [3100], new Set()),
  '3200',
);

assertEqual(
  'parent 1400, children 1410/1420/1430 -> 1440',
  computeNextAccountCode(1400, [1410, 1420, 1430], new Set()),
  '1440',
);

assertEqual(
  'parent 5000, no children -> 5100',
  computeNextAccountCode(5000, [], new Set()),
  '5100',
);

// NOTE: the task's own worked example says "parent 3100 with no children ->
// 3101", but its own formula (step = 10 when P % 100 === 0, which 3100 is)
// computes 3110, not 3101 — the two parts of the task's spec disagree here.
// Followed the literal formula (more authoritative than a prose example)
// rather than silently special-casing this one value; see the final report's
// "deviations" section.
assertEqual(
  'parent 3100 (divisible by 100 -> step 10 per the formula), no children -> 3110',
  computeNextAccountCode(3100, [], new Set()),
  '3110',
);

// ── Step formula edge cases ─────────────────────────────────────────────────

assertEqual(
  'parent exactly *100 but not *1000 (e.g. 1200) -> step 10',
  computeNextAccountCode(1200, [], new Set()),
  '1210',
);

assertEqual(
  'parent not a multiple of 100 (e.g. 1101) -> step 1',
  computeNextAccountCode(1101, [], new Set()),
  '1102',
);

// ── Collision handling: keep adding step until a free code is found ────────

assertEqual(
  'collision at first candidate skips to next free one',
  computeNextAccountCode(3000, [3100], new Set(['3200', '3300'])),
  '3400',
);

assertEqual(
  'collision with no children, still respects step size',
  computeNextAccountCode(5000, [], new Set(['5100'])),
  '5200',
);

// ── Children codes out of numeric order — must take the max, not the last ──

assertEqual(
  'children out of order -> uses max, not array order',
  computeNextAccountCode(1400, [1430, 1410, 1420], new Set()),
  '1440',
);

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
