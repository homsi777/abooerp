/**
 * اختبارات فلترة دفتر الشحن — تشغيل: npm run test:daily-ledger-row-filter
 */
import {
  filterRemoteRowsBySearch,
  prepareLedgerOutputRows,
  sortRemoteRowsChronological,
} from './dailyLedgerRowFilter';
import { computeTotalsFromRemoteRows } from './dailyLedgerTotals';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sampleRow(partial: Partial<RemoteDailyLedgerRow> = {}): RemoteDailyLedgerRow {
  return {
    id: partial.id ?? '00000000-0000-0000-0000-000000000001',
    row_no: partial.row_no ?? 1,
    receipt_no: '100',
    destination: 'دمشق',
    parcel_type: 'طرود',
    parcel_count: 1,
    weight_kg: '5',
    sender_name: 'أ',
    receiver_name: 'ب',
    collect_amount_usd: '10',
    prepaid_amount_usd: '0',
    hawala_amount_usd: '0',
    fees_amount_usd: '0',
    transfer_service_fee_usd: '0',
    notes: null,
    posted_shipment_id: null,
    posted_at: null,
    loaded_manifest_id: null,
    loaded_at: null,
    created_at: '2026-06-09T10:00:00Z',
    updated_at: '2026-06-09T10:00:00Z',
    branch_id: 'b1',
    ledger_date: '2026-06-09',
    line_label: 'حلب',
    origin_label: 'حلب',
    trip_no: null,
    vehicle_label: null,
    driver_label: 'سائق أ',
    session_id: 's1',
    ...partial,
  };
}

const agents = [
  { id: 1, code: '12', name: 'الحسكة', governorate: 'الحسكة', city: 'الحسكة' },
  { id: 2, code: '5', name: 'دمشق', governorate: 'دمشق', city: 'دمشق' },
];

function testSearchByAgentName() {
  const rows = [
    sampleRow({ id: '1', destination: 'الحسكة', collect_amount_usd: '20' }),
    sampleRow({ id: '2', destination: 'حلب', collect_amount_usd: '30' }),
    sampleRow({ id: '3', destination: 'دمشق', collect_amount_usd: '40' }),
  ];
  const filtered = filterRemoteRowsBySearch(rows, 'الحسكة', agents);
  assert(filtered.length === 1, 'agent search should match one row');
  assert(filtered[0].destination === 'الحسكة', 'matched destination');
}

function testSearchTotals() {
  const rows = [
    sampleRow({ id: '1', destination: 'الحسكة', collect_amount_usd: '20' }),
    sampleRow({ id: '2', destination: 'حلب', collect_amount_usd: '30' }),
  ];
  const filtered = filterRemoteRowsBySearch(rows, 'الحسكة', agents);
  const totals = computeTotalsFromRemoteRows(filtered);
  assert(totals.collectionUsd === 20, 'filtered totals');
  assert(totals.rowCount === 1, 'filtered row count');
}

function testChronologicalSort() {
  const rows = [
    sampleRow({ id: '1', row_no: 3, driver_label: 'ب', created_at: '2026-06-09T12:00:00Z' }),
    sampleRow({ id: '2', row_no: 1, driver_label: 'أ', created_at: '2026-06-09T08:00:00Z' }),
    sampleRow({ id: '3', row_no: 2, driver_label: 'ب', created_at: '2026-06-09T10:00:00Z' }),
  ];
  const sorted = sortRemoteRowsChronological(rows);
  assert(sorted[0].row_no === 1, 'first by time');
  assert(sorted[1].row_no === 2, 'second by time');
  assert(sorted[2].row_no === 3, 'third by time');
}

function testPreparePrintDateScopeWithSearch() {
  const rows = [
    sampleRow({ id: '1', destination: 'الحسكة' }),
    sampleRow({ id: '2', destination: 'حلب' }),
  ];
  const prepared = prepareLedgerOutputRows(rows, {
    printScope: 'date',
    searchQuery: 'الحسكة',
    agents,
  });
  assert(prepared.length === 1, 'print prep filters by search');
  assert(prepared[0].destination === 'الحسكة', 'print prep destination');
}

function testPreparePrintDateScopeAllRows() {
  const rows = [
    sampleRow({ id: '1', driver_label: 'أ', row_no: 1 }),
    sampleRow({ id: '2', driver_label: 'ب', row_no: 2, created_at: '2026-06-09T11:00:00Z' }),
  ];
  const prepared = prepareLedgerOutputRows(rows, { printScope: 'date', agents });
  assert(prepared.length === 2, 'date scope keeps all rows');
}

function testPreparePrintDriverScopeWithSearch() {
  const rows = [
    sampleRow({ id: '1', destination: 'منبج', driver_id: 'd1', driver_label: 'سائق أ' }),
    sampleRow({ id: '2', destination: 'منبج', driver_id: 'd2', driver_label: 'سائق ب', row_no: 2 }),
    sampleRow({ id: '3', destination: 'حلب', driver_id: 'd1', driver_label: 'سائق أ', row_no: 3 }),
  ];
  const prepared = prepareLedgerOutputRows(rows, {
    printScope: 'driver',
    searchQuery: 'منبج',
    driverBackendId: 'd1',
    driverName: 'سائق أ',
    agents,
  });
  assert(prepared.length === 1, 'driver scope + search should filter by both');
  assert(prepared[0].driver_id === 'd1', 'matched driver');
  assert(prepared[0].destination === 'منبج', 'matched destination');
}

function run() {
  testSearchByAgentName();
  testSearchTotals();
  testChronologicalSort();
  testPreparePrintDateScopeWithSearch();
  testPreparePrintDateScopeAllRows();
  testPreparePrintDriverScopeWithSearch();
  console.log('dailyLedgerRowFilter.selftest: OK');
}

run();
