/** Pure selftest, no DB/network. Run via: npm run test:goods-pricing-total */
import { computeLineTotal } from './goodsPricingTotal.js';

let failures = 0;
let total = 0;
function check(label: string, actual: unknown, expected: unknown) {
  total += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

check('parcel basic', computeLineTotal('parcel', 10, null, '3.00'), '30.00');
check('kg basic', computeLineTotal('kg', null, '20.50', '0.40'), '8.20');
check('rounding half-up', computeLineTotal('kg', null, '2.50', '0.05'), '0.13');
check('large qty', computeLineTotal('parcel', 1192, null, '3.00'), '3576.00');
check('qty 0', computeLineTotal('parcel', 0, null, '3.00'), '0.00');
check('null parcelCount -> null', computeLineTotal('parcel', null, null, '3.00'), null);
check('null weight -> null', computeLineTotal('kg', null, null, '0.40'), null);
check('no price -> null', computeLineTotal('parcel', 10, null, null), null);
check('matches server example 3.33x1.25', computeLineTotal('kg', null, '3.33', '1.25'), '4.16');

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) {
  throw new Error(`${failures} FAILURE(S)`);
}
