import {
  canViewAllDailyLedgerEntries,
  dailyLedgerOwnerUserId,
  DAILY_LEDGER_VIEW_ALL_PERMISSION,
  isDailyLedgerScopedOperator,
} from './dailyLedgerAccess.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const managerCases: Array<[string, string, string[]]> = [
  ['admin', 'admin', []],
  ['manager', 'employee', []],
  ['general_manager', 'employee', [DAILY_LEDGER_VIEW_ALL_PERMISSION]],
];

for (const [role, userType, permissions] of managerCases) {
  assert(
    canViewAllDailyLedgerEntries(role, userType, permissions),
    `expected view-all for ${role}/${userType}`,
  );
  assert(
    dailyLedgerOwnerUserId(role, userType, 'user-1', permissions) === undefined,
    `expected no owner filter for ${role}`,
  );
}

assert(
  !canViewAllDailyLedgerEntries('data_entry', 'employee', []),
  'data_entry must not view all',
);
assert(
  dailyLedgerOwnerUserId('data_entry', 'employee', 'user-42', []) === 'user-42',
  'data_entry must filter to own user id',
);
assert(
  dailyLedgerOwnerUserId('data_entry', 'employee', 'user-42', [DAILY_LEDGER_VIEW_ALL_PERMISSION]) === 'user-42',
  'data_entry stays isolated even with view-all permission',
);

assert(isDailyLedgerScopedOperator('data_entry'), 'data_entry is scoped operator');
assert(isDailyLedgerScopedOperator('shipment_auditor'), 'shipment_auditor is scoped operator');
assert(
  !canViewAllDailyLedgerEntries('shipment_auditor', 'employee', []),
  'shipment_auditor must not view all',
);
assert(
  dailyLedgerOwnerUserId('shipment_auditor', 'employee', 'user-99', []) === 'user-99',
  'shipment_auditor must filter to own user id',
);

console.log('dailyLedgerAccess.selftest: OK');
