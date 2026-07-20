function undoStatusLabel(row: {
  can_undo?: boolean;
  undo_status?: string | null;
  cancelled_at?: string | null;
}): string {
  if (row.cancelled_at || row.undo_status === 'undone') return 'ملغى';
  if (row.can_undo || row.undo_status === 'undoable') return 'قابل للإلغاء';
  return 'غير قابل للإلغاء';
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(undoStatusLabel({ can_undo: true, undo_status: 'undoable' }) === 'قابل للإلغاء', 'undoable label');
assert(
  undoStatusLabel({ can_undo: false, undo_status: 'undone', cancelled_at: '2026-07-19T10:00:00Z' }) === 'ملغى',
  'undone label',
);
assert(undoStatusLabel({ can_undo: false, undo_status: null }) === 'غير قابل للإلغاء', 'legacy label');

console.log('dailyLedgerDispatchUndo.selftest: OK');
