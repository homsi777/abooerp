/**
 * اختبارات وحدة بسيطة لمساعدات دفتر الشحن — تشغيل: npm run test:daily-ledger-helpers
 */
import { buildDailyLedgerQueryParams } from './dailyLedgerQueryParams';
import { isRemoteDailyLedgerRowPrintable } from './dailyLedgerPrintable';
import { computeTotalsFromRemoteRows } from './dailyLedgerTotals';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sampleRow(partial: Partial<RemoteDailyLedgerRow> = {}): RemoteDailyLedgerRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    row_no: 1,
    receipt_no: '100',
    destination: 'دمشق',
    parcel_type: 'طرود',
    parcel_count: 2,
    weight_kg: '10',
    sender_name: 'أ',
    receiver_name: 'ب',
    collect_amount_usd: '5',
    prepaid_amount_usd: '3',
    hawala_amount_usd: '1',
    fees_amount_usd: '0.5',
    transfer_service_fee_usd: '0.25',
    notes: null,
    posted_shipment_id: null,
    posted_at: null,
    loaded_manifest_id: null,
    loaded_at: null,
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    branch_id: 'b1',
    ledger_date: '2026-06-09',
    line_label: 'فرع حلب',
    origin_label: 'حلب',
    trip_no: null,
    vehicle_label: null,
    driver_label: 'سائق',
    session_id: 's1',
    ...partial,
  };
}

function testQueryScope() {
  const single = buildDailyLedgerQueryParams({
    branchId: 'branch-1',
    ledgerDate: '2026-06-09',
    lineLabel: 'فرع حلب',
    includeLoaded: true,
  });
  assert(single.get('ledgerDate') === '2026-06-09', 'ledgerDate');
  assert(single.get('lineLabel') === 'فرع حلب', 'lineLabel');
  assert(single.get('includeLoaded') === 'true', 'includeLoaded');

  const range = buildDailyLedgerQueryParams({
    branchId: 'branch-1',
    ledgerDate: '2026-06-09',
    lineLabel: 'فرع حلب',
    includeLoaded: false,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-09',
  });
  assert(range.get('dateFrom') === '2026-06-01', 'dateFrom');
  assert(range.get('dateTo') === '2026-06-09', 'dateTo');
  assert(range.get('lineLabel') === 'فرع حلب', 'lineLabel in range');

  const allLines = buildDailyLedgerQueryParams({
    branchId: 'branch-1',
    ledgerDate: '2026-06-09',
    lineLabel: 'فرع حلب',
    includeLoaded: true,
    allLines: true,
  });
  assert(!allLines.get('lineLabel'), 'allLines omits lineLabel');
}

function testPrintableFilter() {
  assert(isRemoteDailyLedgerRowPrintable(sampleRow()), 'row with data is printable');
  assert(
    !isRemoteDailyLedgerRowPrintable(
      sampleRow({
        receipt_no: '',
        destination: '',
        sender_name: '',
        receiver_name: '',
        parcel_type: '',
        parcel_count: null,
        weight_kg: null,
        collect_amount_usd: '0',
        prepaid_amount_usd: '0',
        hawala_amount_usd: '0',
        fees_amount_usd: '0',
        transfer_service_fee_usd: '0',
      }),
    ),
    'empty row is not printable',
  );
}

function testFinancialTotals() {
  const totals = computeTotalsFromRemoteRows([sampleRow()]);
  assert(totals.rowCount === 1, 'rowCount');
  assert(totals.collectionUsd === 5.5, `collectionUsd expected 5.5 got ${totals.collectionUsd}`);
  assert(totals.prepaidUsd === 3, 'prepaidUsd');
  assert(totals.hawalaUsd === 1, 'hawalaUsd');
  assert(totals.transferServiceFeeUsd === 0.25, 'transferServiceFeeUsd');
  assert(totals.screenMoneyTotalUsd === 6.75, `screenMoneyTotalUsd got ${totals.screenMoneyTotalUsd}`);
  assert(totals.grandTotalUsd === 9.75, `grandTotalUsd got ${totals.grandTotalUsd}`);
}

function main() {
  testQueryScope();
  testPrintableFilter();
  testFinancialTotals();
  console.log('dailyLedgerHelpers.selftest: OK (3 suites)');
}

main();
