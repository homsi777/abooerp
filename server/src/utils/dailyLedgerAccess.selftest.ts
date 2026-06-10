import {
  canViewAllDailyLedgerEntries,
  dailyLedgerOwnerUserId,
  DAILY_LEDGER_VIEW_ALL_PERMISSION,
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

console.log('dailyLedgerAccess.selftest: OK');
