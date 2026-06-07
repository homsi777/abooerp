import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, Plus, Printer, Save, ScrollText, Search, Trash2, Truck } from 'lucide-react';
import {
  buildMahmoudPreprintedReceiptHtml,
  mapRemoteLedgerRowToMahmoudReceipt,
} from '../lib/shipping/mahmoudPreprintedReceiptPrint';
import { useToast } from '../components/Toast';
import { getBackendIdFromSynthetic, phase15Gateway, syntheticEntityId } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import { isElectronRuntime } from '../lib/runtime/runtimeMode';
import { useAuth } from '../context/AuthProvider';
import SmartPartyInput from '../components/SmartPartyInput';
import AutocompleteInput from '../components/AutocompleteInput';
import {
  dedupeAgentsForDestination,
  pickPreferredAgentForGovernorate,
} from '../lib/shipping/agentDestinationResolve';
import {
  applySaveProgressItemPatch,
  buildSaveProgressItems,
  createInitialSaveProgress,
  failedRowsFromProgressItems,
  loadFailedSaveRows,
  persistFailedSaveRows,
  quickLedgerLog,
  rowProgressLabel,
  type FailedSaveRowMap,
  type SaveProgressItem,
  type SaveProgressState,
} from '../lib/shipping/quickLedgerLog';
import QuickLedgerSaveProgressDialog from '../components/shipping/QuickLedgerSaveProgressDialog';
import QuickLedgerAgentHelpDialog from '../components/shipping/QuickLedgerAgentHelpDialog';
import {
  buildQuickCodesFromAgents,
  resolveGovernorateFromQuickCode,
} from '../lib/agents/agentQuickCodes';
import {
  ledgerRowTotalUsd,
  mergeLedgerRowWithAutoTariff,
  parseUsd,
  parseWeightKg,
  resolveCityId,
} from '../lib/shipping/ledgerTariffPricing';
import type { Branch, City, Customer, Driver, GoodsType, Shipment, Tariff, Vehicle } from '../types';

type LedgerRow = {
  id: number;
  serverRowNo?: number;
  sessionDriverId?: number;
  dbId?: string;
  updatedAt?: string;
  postedShipmentId?: string | null;
  loadedAt?: string | null;
  receiptNo: string;
  origin: string;
  destination: string;
  parcelType: string;
  parcelCount: string;
  weightKg: string;
  sender: string;
  receiver: string;
  collectAmount: string;
  prepaidAmount: string;
  receiverCollect: string;
  transferServiceFee: string;
  /** عند true لا يُستبدل تحصيل $ تلقائياً من تعريف الأسعار */
  collectManual?: boolean;
  agentId?: number;
  agentName?: string;
  notes: string;
};

const LEDGER_FETCH_CHUNK_SIZE = 500;
const LEDGER_ENTRY_SLOTS = 1;
const LEDGER_ROWS_ADD_INCREMENT = 1;
const ROW_SAVE_DEBOUNCE_MS = 280;

function sortRemoteLedgerRows(data: RemoteDailyLedgerRow[]) {
  return [...data].sort((a, b) => {
    const driverCmp = String(a.driver_label ?? '').localeCompare(String(b.driver_label ?? ''), 'ar');
    if (driverCmp !== 0) return driverCmp;
    return a.row_no - b.row_no;
  });
}

type RemoteDailyLedgerRow = {
  id: string;
  row_no: number;
  receipt_no: string | null;
  destination: string;
  parcel_type: string;
  parcel_count: number | null;
  weight_kg: string | null;
  sender_name: string;
  receiver_name: string;
  collect_amount_usd: string;
  prepaid_amount_usd: string;
  hawala_amount_usd: string;
  fees_amount_usd: string;
  transfer_service_fee_usd: string;
  notes: string | null;
  posted_shipment_id: string | null;
  posted_at: string | null;
  loaded_manifest_id: string | null;
  loaded_at: string | null;
  created_at: string;
  updated_at: string;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
};

type SuggestedAgent = { id: number; code: string; name: string; governorate?: string; city?: string; area?: string };

const fallbackDestinations = ['دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب'];

function createEmptyRow(id: number): LedgerRow {
  return {
    id,
    dbId: undefined,
    updatedAt: undefined,
    postedShipmentId: null,
    loadedAt: null,
    receiptNo: '',
    origin: '',
    destination: '',
    parcelType: '',
    parcelCount: '',
    weightKg: '',
    sender: '',
    receiver: '',
    collectAmount: '',
    prepaidAmount: '',
    receiverCollect: '',
    transferServiceFee: '',
    collectManual: false,
    agentId: undefined,
    agentName: '',
    notes: '',
  };
}

function shipmentAmountsFromLedgerRow(row: LedgerRow) {
  const collect = parseUsd(row.collectAmount);
  const prepaid = parseUsd(row.prepaidAmount);
  const hawalaAmount = parseUsd(row.receiverCollect);
  const transferServiceFee = parseUsd(row.transferServiceFee);
  return {
    /** أجور الشحن للشركة — عند الدفع المسبق فقط */
    freightCharge: prepaid > 0 ? prepaid : 0,
    /** تحصيل من المستلم على عهدة الوكيل — عند COD */
    transferFee: collect > 0 ? collect : 0,
    prepaidAmount: prepaid,
    hawalaAmount,
    transferServiceFee,
    total: collect + prepaid + hawalaAmount + transferServiceFee,
  };
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

/** تنسيق الوزن: كغ + طن (1000 كغ = 1 طن) */
function formatWeightKgTons(kg: number): string {
  const safeKg = Number.isFinite(kg) ? kg : 0;
  const tons = safeKg / 1000;
  const kgLabel = safeKg.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const tonsLabel = tons.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return `${kgLabel} كغ / ${tonsLabel} طن`;
}

function normalizeReceiptNo(value: string) {
  return normalizeName(value).toLowerCase();
}

function findLocalDuplicateReceipt(rows: LedgerRow[], receiptNo: string, excludeRowId: number) {
  const key = normalizeReceiptNo(receiptNo);
  if (!key) return undefined;
  return rows.find(
    (row) => row.id !== excludeRowId && normalizeReceiptNo(row.receiptNo) === key,
  );
}

function findReceiptConflictForRow(row: LedgerRow, allRows: LedgerRow[]): LedgerRow | null {
  return findLocalDuplicateReceipt(allRows, row.receiptNo, row.id) ?? null;
}

function describeReceiptConflict(
  rows: LedgerRow[],
  row: LedgerRow,
  other: LedgerRow,
): string {
  const receipt = normalizeName(row.receiptNo);
  const otherLabel = other.serverRowNo ?? other.id;
  if (other.postedShipmentId) {
    return `رقم الإيصال «${receipt}» محفوظ مسبقاً (سطر ${otherLabel}) — احذف أو عدّل السطر المكرر`;
  }
  return `رقم الإيصال «${receipt}» مكرر مع سطر ${otherLabel} في نفس الدفتر`;
}

function findDuplicateWithinBatch(rowsToPost: LedgerRow[]): { row: LedgerRow; other: LedgerRow } | null {
  const seen = new Map<string, LedgerRow>();
  for (const row of rowsToPost) {
    const key = normalizeReceiptNo(row.receiptNo);
    if (!key) continue;
    const prior = seen.get(key);
    if (prior) return { row, other: prior };
    seen.set(key, row);
  }
  return null;
}

function findReceiptConflictWithPosted(
  rowsToPost: LedgerRow[],
  allRows: LedgerRow[],
): { row: LedgerRow; other: LedgerRow } | null {
  for (const row of rowsToPost) {
    const key = normalizeReceiptNo(row.receiptNo);
    if (!key) continue;
    const postedConflict = allRows.find(
      (other) =>
        other.id !== row.id &&
        other.postedShipmentId &&
        normalizeReceiptNo(other.receiptNo) === key,
    );
    if (postedConflict) return { row, other: postedConflict };
  }
  return null;
}

function findReceiptConflictWithUnposted(
  rowsToPost: LedgerRow[],
  allRows: LedgerRow[],
): { row: LedgerRow; other: LedgerRow } | null {
  for (const row of rowsToPost) {
    const key = normalizeReceiptNo(row.receiptNo);
    if (!key) continue;
    const other = allRows.find(
      (candidate) =>
        candidate.id !== row.id &&
        !candidate.postedShipmentId &&
        !rowsToPost.some((batchRow) => batchRow.id === candidate.id) &&
        normalizeReceiptNo(candidate.receiptNo) === key,
    );
    if (other) return { row, other };
  }
  return null;
}

function isRowStarted(row: LedgerRow) {
  return Boolean(
    row.dbId ||
      row.receiptNo.trim() ||
      row.destination.trim() ||
      row.parcelType.trim() ||
      row.parcelCount.trim() ||
      row.weightKg.trim() ||
      row.sender.trim() ||
      row.receiver.trim() ||
      row.collectAmount.trim() ||
      row.prepaidAmount.trim() ||
      row.receiverCollect.trim() ||
      row.transferServiceFee.trim() ||
      row.notes.trim(),
  );
}

/** الحد الأدنى لحفظ سطر جديد — الوزن والكمية والمبالغ اختيارية */
function isRowSavable(row: LedgerRow) {
  return Boolean(
    row.receiptNo.trim() &&
      row.destination.trim() &&
      row.sender.trim() &&
      row.receiver.trim(),
  );
}

function shouldPersistRow(row: LedgerRow) {
  if (row.loadedAt) return false;
  if (row.dbId) return isRowStarted(row);
  return isRowSavable(row);
}

/** جاهز لترحيل الشحنة — لا يشترط وزناً ولا كمية ولا مبلغاً */
function isRowComplete(row: LedgerRow) {
  return isRowSavable(row);
}

function isRowDeletable(row: LedgerRow) {
  if (row.loadedAt) return false;
  return Boolean(row.dbId || isRowStarted(row));
}

function rowAmountUsd(row: LedgerRow) {
  return ledgerRowTotalUsd(row);
}

function tripFleetPayload(trip: {
  driver: string;
  vehicle: string;
  driverId: number;
  vehicleId: number;
}) {
  return {
    driverLabel: trip.driver || null,
    vehicleLabel: trip.vehicle || null,
    driverId: trip.driverId ? getBackendIdFromSynthetic(trip.driverId) ?? null : null,
    vehicleId: trip.vehicleId ? getBackendIdFromSynthetic(trip.vehicleId) ?? null : null,
  };
}

function resolveFleetForLedgerRow(
  row: LedgerRow,
  trip: { driver: string; vehicle: string; driverId: number; vehicleId: number },
  driverList: Driver[],
  vehicleList: Vehicle[],
) {
  const driverId = row.sessionDriverId ?? trip.driverId;
  const driver = driverList.find((d) => d.id === driverId);
  const vehicle =
    vehicleList.find((v) => v.driverId === driverId) ??
    (trip.vehicleId ? vehicleList.find((v) => v.id === trip.vehicleId) : undefined);
  return {
    driverLabel: driver?.name ?? trip.driver ?? null,
    vehicleLabel: vehicle
      ? `${vehicle.plateNumber}${vehicle.model ? ` — ${vehicle.model}` : ''}`
      : trip.vehicle ?? null,
    driverId: driverId ? getBackendIdFromSynthetic(driverId) ?? null : null,
    vehicleId: vehicle?.id
      ? getBackendIdFromSynthetic(vehicle.id) ?? null
      : trip.vehicleId
        ? getBackendIdFromSynthetic(trip.vehicleId) ?? null
        : null,
  };
}

function nextServerRowNoForDriver(rows: LedgerRow[], driverId: number) {
  if (!driverId) return undefined;
  const nums = rows
    .filter((r) => r.sessionDriverId === driverId && r.serverRowNo)
    .map((r) => r.serverRowNo as number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function isRemoteRowPrintable(remote: RemoteDailyLedgerRow) {
  return Boolean(
    remote.receipt_no?.trim() ||
      remote.destination?.trim() ||
      remote.sender_name?.trim() ||
      remote.receiver_name?.trim() ||
      remote.parcel_type?.trim() ||
      (remote.parcel_count != null && Number(remote.parcel_count) > 0) ||
      (remote.weight_kg != null && Number(remote.weight_kg) > 0) ||
      parseUsd(String(remote.collect_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.prepaid_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.hawala_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.transfer_service_fee_usd ?? '')) > 0 ||
      parseUsd(String(remote.fees_amount_usd ?? '')) > 0,
  );
}

function remoteRowMatchesDriver(
  remote: RemoteDailyLedgerRow,
  filters: { driverBackendId?: string; driverName?: string },
) {
  const driverLabel = normalizeName(remote.driver_label ?? '');
  return Boolean(
    (filters.driverBackendId && remote.driver_id === filters.driverBackendId) ||
      (filters.driverName &&
        (driverLabel === normalizeName(filters.driverName) ||
          driverLabel.includes(normalizeName(filters.driverName)) ||
          normalizeName(filters.driverName).includes(driverLabel))),
  );
}

function ledgerRowSearchFields(row: LedgerRow): string[] {
  return [
    row.receiptNo,
    row.origin,
    row.destination,
    row.parcelType,
    row.sender,
    row.receiver,
    row.notes,
    row.agentName ?? '',
    String(row.agentId ?? ''),
  ];
}

function remoteRowSearchFields(row: RemoteDailyLedgerRow): string[] {
  return [
    row.receipt_no ?? '',
    row.origin_label ?? '',
    row.line_label ?? '',
    row.destination ?? '',
    row.parcel_type ?? '',
    row.sender_name ?? '',
    row.receiver_name ?? '',
    row.notes ?? '',
    row.driver_label ?? '',
    row.vehicle_label ?? '',
  ];
}

/** نفس منطق «بحث سريع داخل الدفتر» — يُستخدم للعرض والطباعة */
function matchesQuickLedgerSearch(
  searchQuery: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  const q = normalizeName(searchQuery).toLowerCase();
  if (!q) return true;
  return fields.some((field) => String(field ?? '').toLowerCase().includes(q));
}

const LEDGER_FETCH_PAGE_SIZE = 2000;

async function fetchAllDailyLedgerRows(
  baseParams: URLSearchParams,
  onlyWithData = false,
): Promise<RemoteDailyLedgerRow[]> {
  const params = new URLSearchParams(baseParams);
  if (onlyWithData) params.set('onlyWithData', 'true');
  const all: RemoteDailyLedgerRow[] = [];
  let offset = 0;
  while (offset <= 50000) {
    const pageParams = new URLSearchParams(params);
    pageParams.set('limit', String(LEDGER_FETCH_PAGE_SIZE));
    pageParams.set('offset', String(offset));
    const batch = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${pageParams.toString()}`);
    all.push(...batch);
    if (batch.length < LEDGER_FETCH_PAGE_SIZE) break;
    offset += LEDGER_FETCH_PAGE_SIZE;
  }
  return all;
}

function printHtmlInBrowser(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow;
  const frameDoc = iframe.contentDocument ?? frameWindow?.document;
  if (!frameDoc || !frameWindow) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تهيئة نافذة الطباعة');
  }
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(() => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }, 1000);
}

type QuickLedgerPrintRow = {
  receiptNo: string;
  destination: string;
  parcelType: string;
  parcelCount: string;
  weightKg: string;
  sender: string;
  receiver: string;
  collectAmount: string;
  prepaidAmount: string;
  hawalaAmount: string;
  transferServiceFee: string;
};

function localRowToPrint(row: LedgerRow): QuickLedgerPrintRow {
  return {
    receiptNo: row.receiptNo,
    destination: row.destination,
    parcelType: row.parcelType,
    parcelCount: row.parcelCount,
    weightKg: row.weightKg,
    sender: row.sender,
    receiver: row.receiver,
    collectAmount: row.collectAmount,
    prepaidAmount: row.prepaidAmount,
    hawalaAmount: row.receiverCollect,
    transferServiceFee: row.transferServiceFee,
  };
}

function remoteRowToPrint(row: RemoteDailyLedgerRow): QuickLedgerPrintRow {
  const collect =
    parseUsd(String(row.collect_amount_usd ?? '')) + parseUsd(String(row.fees_amount_usd ?? ''));
  return {
    receiptNo: row.receipt_no ?? '',
    destination: row.destination ?? '',
    parcelType: row.parcel_type ?? '',
    parcelCount: row.parcel_count == null ? '' : String(row.parcel_count),
    weightKg: row.weight_kg == null ? '' : String(row.weight_kg),
    sender: row.sender_name ?? '',
    receiver: row.receiver_name ?? '',
    collectAmount: collect > 0 ? String(collect) : String(row.collect_amount_usd ?? ''),
    prepaidAmount: String(row.prepaid_amount_usd ?? ''),
    hawalaAmount: String(row.hawala_amount_usd ?? ''),
    transferServiceFee: String(row.transfer_service_fee_usd ?? ''),
  };
}

function escapePrintHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildQuickLedgerPrintHtml(
  rows: QuickLedgerPrintRow[],
  meta: {
    title: string;
    dateLabel: string;
    driverName: string;
    vehicleLabel: string;
    lineLabel?: string;
    tripNo?: string;
  },
) {
  const bodyRows = rows
    .map(
      (row) => `<tr>
<td class="col-receipt">${escapePrintHtml(row.receiptNo)}</td>
<td class="col-dest">${escapePrintHtml(row.destination)}</td>
<td class="col-type">${escapePrintHtml(row.parcelType)}</td>
<td class="col-count">${escapePrintHtml(row.parcelCount)}</td>
<td class="col-weight">${escapePrintHtml(row.weightKg)}</td>
<td class="col-party">${escapePrintHtml(row.sender)}</td>
<td class="col-party">${escapePrintHtml(row.receiver)}</td>
<td class="col-money">${escapePrintHtml(row.collectAmount)}</td>
<td class="col-money">${escapePrintHtml(row.prepaidAmount)}</td>
<td class="col-money">${escapePrintHtml(row.hawalaAmount)}</td>
<td class="col-money">${escapePrintHtml(row.transferServiceFee)}</td>
</tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapePrintHtml(meta.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 8mm; }
    html, body { margin: 0; padding: 0; background: white; font-family: Tahoma, Arial, sans-serif; color: #10251f; }
    .meta { margin-bottom: 10px; font-size: 13px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
    .meta div { border: 1px solid #c5d0dc; padding: 4px 6px; background: #f8fafc; }
    .meta strong { font-weight: 800; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #7f93a7; padding: 3px 2px; vertical-align: middle; line-height: 1.15; }
    th { background: #dce8e5; font-weight: 800; text-align: center; min-height: 30px; word-break: break-word; }
    td { text-align: center; min-height: 22px; background: #fff; white-space: nowrap; overflow: hidden; }
    .col-receipt { width: 7%; }
    .col-dest { width: 9%; }
    .col-type { width: 12%; }
    .col-count { width: 5%; }
    .col-weight { width: 5%; }
    .col-party { width: 15%; text-align: right; }
    .col-money { width: 6.5%; direction: ltr; font-size: 12px; }
    th.col-money { font-size: 10px; line-height: 1.1; padding: 2px 1px; }
  </style>
</head>
<body>
  <div class="meta">
    <div><strong>الفترة:</strong> ${escapePrintHtml(meta.dateLabel)}</div>
    <div><strong>السائق:</strong> ${escapePrintHtml(meta.driverName)}</div>
    <div><strong>المركبة:</strong> ${escapePrintHtml(meta.vehicleLabel)}</div>
    <div><strong>عدد الأسطر:</strong> ${rows.length}</div>
    ${meta.lineLabel ? `<div><strong>الخط:</strong> ${escapePrintHtml(meta.lineLabel)}</div>` : ''}
    ${meta.tripNo ? `<div><strong>رقم الرحلة:</strong> ${escapePrintHtml(meta.tripNo)}</div>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th class="col-receipt">رقم الإيصال</th>
        <th class="col-dest">الجهة</th>
        <th class="col-type">نوع الطرود</th>
        <th class="col-count">عدد الطرود</th>
        <th class="col-weight">الوزن كغ</th>
        <th class="col-party">المرسل</th>
        <th class="col-party">المرسل إليه</th>
        <th class="col-money">تحصيل $</th>
        <th class="col-money">دفع مسبق $</th>
        <th class="col-money">حوالة</th>
        <th class="col-money">أجرة الحوالة</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;
}

function mergeRowWithAutoTariff(
  row: LedgerRow,
  tariffList: Tariff[],
  cityList: City[],
  branchList: Branch[],
  goodsTypeList: GoodsType[],
  asOf: string,
): LedgerRow {
  return mergeLedgerRowWithAutoTariff(row, tariffList, cityList, branchList, goodsTypeList, asOf);
}

function mergeUniqueKeepOrder(base: string[], extra: string[]) {
  const merged = [...new Set([...base, ...extra])].filter(Boolean);
  if (merged.length === extra.length && merged.every((value, index) => value === extra[index])) {
    return extra;
  }
  return merged;
}

/** إدخال سريع: إن كان الحقل أرقاماً فقط نطابق حقل `code` في الفرع/المدينة/الوكيل (مثلاً 12 → فرع كوده 12). */
function isDigitsOnlyQuickCode(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

function matchByEntityCode<T extends { code: string }>(items: T[], raw: string): T | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const direct = items.find((item) => String(item.code).trim() === t);
  if (direct) return direct;
  if (!isDigitsOnlyQuickCode(t)) return undefined;
  const nt = t.replace(/^0+/, '') || '0';
  return items.find((item) => {
    const c = String(item.code).trim();
    if (c === t) return true;
    if (/^\d+$/.test(c)) return (c.replace(/^0+/, '') || '0') === nt;
    return false;
  });
}

function resolveOriginByQuickCode(raw: string, branchList: Branch[]): string | null {
  if (!isDigitsOnlyQuickCode(raw)) return null;
  const b = matchByEntityCode(branchList, raw);
  return b ? b.name : null;
}

function resolveAgentDestinationLabel(agent: {
  governorate?: string;
  city?: string;
  area?: string;
  name: string;
}): string {
  const governorate = normalizeName(agent.governorate ?? '');
  if (governorate) return governorate;
  const location = [agent.city, agent.area].map((part) => normalizeName(part ?? '')).filter(Boolean).join(' / ');
  if (location) return location;
  return normalizeName(agent.name);
}

function resolveDestinationByQuickCode(raw: string, cityList: City[], branchList: Branch[]): string | null {
  if (!isDigitsOnlyQuickCode(raw)) return null;
  const city = matchByEntityCode(cityList, raw);
  if (city) return city.name;
  const branch = matchByEntityCode(branchList, raw);
  return branch ? branch.name : null;
}

type AgentProfilePayload = {
  agent: { id: string; name: string; code: string };
  branchLabel: string | null;
  username: string;
};

export default function ShipmentQuickLedger() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, activeBranchId, setActiveBranch, hasPermission } = useAuth();
  const [rows, setRows] = useState<LedgerRow[]>(() => [createEmptyRow(1)]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeRowId, setActiveRowId] = useState(1);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printDriverId, setPrintDriverId] = useState(0);
  const [printDateFrom, setPrintDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [printDateTo, setPrintDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [printLoading, setPrintLoading] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedDeleteRowIds, setSelectedDeleteRowIds] = useState<number[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingRows, setDeletingRows] = useState(false);
  const [transferMode, setTransferMode] = useState(false);
  const [selectedTransferRowIds, setSelectedTransferRowIds] = useState<number[]>([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [transferDriverId, setTransferDriverId] = useState(0);
  const [transferVehicleId, setTransferVehicleId] = useState(0);
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [transferValidation, setTransferValidation] = useState<{
    loading: boolean;
    summary?: {
      rowsCount: number;
      piecesCount: number;
      weightKg: number;
      weightTons: number;
      freightTotal: number;
      collectionTotal: number;
      prepaidTotal: number;
      destinations: string[];
    };
    warnings: string[];
    errors: string[];
  }>({ loading: false, warnings: [], errors: [] });
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgressState>(createInitialSaveProgress);
  const [failedSaveRows, setFailedSaveRows] = useState<FailedSaveRowMap>({});
  const [agentHelpOpen, setAgentHelpOpen] = useState(false);
  const [agentHelpLoading, setAgentHelpLoading] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState<string[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [agentSuggestions, setAgentSuggestions] = useState<Record<number, SuggestedAgent[]>>({});
  /** كل الوكلاء للشركة — يُحمَّل للمسؤولين لملء القائمة حتى لو بحث الوجهة لم يُطابق حقول الوكيل */
  const [catalogAgents, setCatalogAgents] = useState<SuggestedAgent[]>([]);
  const [includeLoaded, setIncludeLoaded] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSyncedCount, setRemoteSyncedCount] = useState(0);
  const loadGenerationRef = useRef(0);
  const saveTimersRef = useRef<Record<number, number>>({});
  const saveInFlightRef = useRef<Record<number, Promise<void>>>({});
  const saveRowToServerRef = useRef<(displayRowId: number) => Promise<void>>(async () => {});
  const [branchSearch, setBranchSearch] = useState('');
  const [trip, setTrip] = useState({
    line: '',
    tripNo: 'رحلة صباحية',
    date: new Date().toISOString().split('T')[0],
    vehicle: '',
    driver: '',
    driverId: 0,
    vehicleId: 0,
  });
  const [searchQuick, setSearchQuick] = useState('');

  const destinations = useMemo(
    () => (cities.length ? cities.map((city) => city.name) : fallbackDestinations),
    [cities],
  );
  const goodsTypeAutocompleteItems = useMemo(
    () => goodsTypes.map((g) => ({ id: g.id, name: g.name })),
    [goodsTypes],
  );
  const lineOptions = useMemo(
    () => {
      const branchOnly = branches
        .map((branch) => branch.name)
        .filter((name) => normalizeName(name).includes('فرع'));
      const current = trip.line && normalizeName(trip.line).includes('فرع') ? [trip.line] : [];
      return mergeUniqueKeepOrder(branchOnly, current);
    },
    [branches, trip.line],
  );
  useEffect(() => {
    setDestinationOptions((prev) => mergeUniqueKeepOrder(destinations, prev));
  }, [destinations]);

  useEffect(() => {
    if (!trip.line) return;
    if (!branches.length && !cities.length) return;
    applyTripOriginToRows(trip.line);
  }, [branches.length, cities.length, trip.line]);

  const visibleRows = useMemo(() => {
    const blankNewEntries = rows.filter((row) => !row.dbId && !row.loadedAt && !isRowStarted(row));
    const trailingBlank = blankNewEntries.length ? blankNewEntries[blankNewEntries.length - 1] : null;
    const displayable = rows.filter(
      (row) => isRowStarted(row) || (trailingBlank != null && row.id === trailingBlank.id),
    );
    if (!normalizeName(searchQuick)) return displayable;
    return displayable.filter((row) => matchesQuickLedgerSearch(searchQuick, ledgerRowSearchFields(row)));
  }, [rows, searchQuick]);

  const deletableVisibleRows = useMemo(
    () => visibleRows.filter(isRowDeletable),
    [visibleRows],
  );

  /** أسطر قابلة للنقل: محفوظة في الخادم وغير محمّلة على بيان */
  const transferableVisibleRows = useMemo(
    () => visibleRows.filter((row) => Boolean(row.dbId) && !row.loadedAt),
    [visibleRows],
  );

  const selectedTransferRows = useMemo(
    () => rows.filter((row) => selectedTransferRowIds.includes(row.id)),
    [rows, selectedTransferRowIds],
  );

  const transferSelectionSummary = useMemo(() => {
    let pieces = 0;
    let weightKg = 0;
    let collect = 0;
    let prepaid = 0;
    let freight = 0;
    const destinations = new Set<string>();
    for (const row of selectedTransferRows) {
      pieces += Number(row.parcelCount) || 0;
      weightKg += parseWeightKg(row.weightKg) ?? 0;
      const c = parseUsd(row.collectAmount);
      const p = parseUsd(row.prepaidAmount);
      collect += c;
      prepaid += p;
      freight += p > 0 ? p : 0;
      const dest = normalizeName(row.destination);
      if (dest) destinations.add(dest);
    }
    return {
      rows: selectedTransferRows.length,
      pieces,
      weightKg,
      collect,
      prepaid,
      freight,
      destinations: [...destinations],
    };
  }, [selectedTransferRows]);

  useEffect(() => {
    setFailedSaveRows(loadFailedSaveRows(trip.date, trip.line));
  }, [trip.date, trip.line]);

  const duplicateReceiptRowIds = useMemo(() => {
    const byKey = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      const key = normalizeReceiptNo(row.receiptNo);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    const dupIds = new Set<number>();
    for (const group of byKey.values()) {
      if (group.length <= 1) continue;
      const unposted = group.filter((row) => !row.postedShipmentId);
      if (unposted.length >= 2) {
        unposted.forEach((row) => dupIds.add(row.id));
      } else if (unposted.length === 1) {
        dupIds.add(unposted[0].id);
      }
    }
    return dupIds;
  }, [rows]);

  const issueRowIds = useMemo(() => {
    const ids = new Set<number>(duplicateReceiptRowIds);
    for (const rowId of Object.keys(failedSaveRows)) {
      ids.add(Number(rowId));
    }
    return ids;
  }, [duplicateReceiptRowIds, failedSaveRows]);

  const agentQuickCodeEntries = useMemo(
    () =>
      buildQuickCodesFromAgents(
        catalogAgents.map((agent) => ({
          code: agent.code,
          name: agent.name,
          governorate: agent.governorate,
          is_active: true,
        })),
      ),
    [catalogAgents],
  );

  const stats = useMemo(() => {
    const meaningful = rows.filter(isRowStarted);
    const completeRows = meaningful.filter((row) => isRowComplete(row) && !row.postedShipmentId);
    const totalWeightKg = meaningful.reduce((sum, row) => sum + (parseWeightKg(row.weightKg) ?? 0), 0);
    return {
      started: meaningful.length,
      complete: completeRows.length,
      missing: Math.max(0, meaningful.length - meaningful.filter(isRowComplete).length),
      saved: meaningful.filter((r) => Boolean(r.postedShipmentId)).length,
      totalCollect: meaningful.reduce((sum, row) => sum + rowAmountUsd(row), 0),
      totalWeightKg,
    };
  }, [rows]);

  const rowsRef = useRef(rows);
  const customersRef = useRef(customers);
  const goodsTypesRef = useRef(goodsTypes);
  const tripRef = useRef(trip);
  const activeBranchIdRef = useRef(activeBranchId);
  const driversRef = useRef(drivers);
  const vehiclesRef = useRef(vehicles);

  useEffect(() => {
    driversRef.current = drivers;
  }, [drivers]);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  useEffect(() => {
    goodsTypesRef.current = goodsTypes;
  }, [goodsTypes]);

  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);

  useEffect(() => {
    activeBranchIdRef.current = activeBranchId;
  }, [activeBranchId]);

  const branchChoices = useMemo(() => {
    if (!user) return branches;
    const isAdmin = user.userType === 'admin' || user.role === 'admin';
    if (isAdmin) return branches;
    if (user.role === 'data_entry') {
      const onlyBranchId = user.branchId ?? user.allowedBranchIds?.[0] ?? null;
      if (!onlyBranchId) return branches.slice(0, 1);
      const sid = syntheticEntityId(onlyBranchId);
      return branches.filter((b) => b.id === sid);
    }
    const allowed = new Set((user.allowedBranchIds || []).map((id) => syntheticEntityId(id)));
    if (allowed.size === 0 && user.branchId) allowed.add(syntheticEntityId(user.branchId));
    if (allowed.size === 0) return branches.slice(0, 1);
    return branches.filter((b) => allowed.has(b.id));
  }, [branches, user]);

  const isBranchLocked = useMemo(() => {
    if (!user) return false;
    const isAdmin = user.userType === 'admin' || user.role === 'admin';
    if (isAdmin) return false;
    if (user.role === 'data_entry') return true;
    return (user.allowedBranchIds || []).length <= 1;
  }, [user]);

  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  const canPickHistoricalDate = useMemo(() => {
    if (!user) return false;
    if (user.userType === 'admin' || user.role === 'admin') return true;
    if (['general_manager', 'branch_manager'].includes(user.role)) return true;
    return hasPermission('shipments.ledger.past_dates');
  }, [user, hasPermission]);

  const mapRemoteRowToLocal = (remote: RemoteDailyLedgerRow, displayId: number): LedgerRow => ({
    id: displayId,
    serverRowNo: remote.row_no,
    sessionDriverId: remote.driver_id ? syntheticEntityId(remote.driver_id) : undefined,
    dbId: remote.id,
    updatedAt: remote.updated_at,
    postedShipmentId: remote.posted_shipment_id,
    loadedAt: remote.loaded_at,
    receiptNo: remote.receipt_no ?? '',
    origin: remote.origin_label || resolveTripOrigin(remote.line_label),
    destination: remote.destination ?? '',
    parcelType: remote.parcel_type ?? '',
    parcelCount: remote.parcel_count == null ? '' : String(remote.parcel_count),
    weightKg: remote.weight_kg == null ? '' : String(remote.weight_kg),
    sender: remote.sender_name ?? '',
    receiver: remote.receiver_name ?? '',
    collectAmount: String(parseUsd(String(remote.collect_amount_usd ?? '')) + parseUsd(String(remote.fees_amount_usd ?? '')) || ''),
    prepaidAmount: String(remote.prepaid_amount_usd ?? ''),
    receiverCollect: String(remote.hawala_amount_usd ?? ''),
    transferServiceFee: String(remote.transfer_service_fee_usd ?? ''),
    collectManual:
      parseUsd(String(remote.collect_amount_usd ?? '')) > 0 || parseUsd(String(remote.fees_amount_usd ?? '')) > 0,
    agentId: undefined,
    agentName: '',
    notes: remote.notes ?? '',
  });

  const flushPendingRowSaves = async () => {
    Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current = {};
    const targets = rowsRef.current.filter(shouldPersistRow);
    for (const row of targets) {
      await saveRowToServerRef.current(row.id);
    }
  };

  const buildEntrySlotRows = (startId: number, origin: string, count = LEDGER_ENTRY_SLOTS) =>
    Array.from({ length: count }, (_, idx) =>
      mergeRowWithAutoTariff(
        { ...createEmptyRow(startId + idx), origin },
        tariffs,
        cities,
        branches,
        goodsTypes,
        tripRef.current.date,
      ),
    );

  const appendTrailingEntrySlot = (prev: LedgerRow[]) => {
    const hasBlank = prev.some((row) => !row.dbId && !row.loadedAt && !isRowStarted(row));
    if (hasBlank) return prev;
    const maxId = prev.reduce((max, row) => Math.max(max, row.id), 0);
    const origin = resolveTripOrigin(tripRef.current.line);
    return [...prev, ...buildEntrySlotRows(maxId + 1, origin, 1)];
  };

  const buildDisplayRowsFromRemote = (remoteRows: RemoteDailyLedgerRow[]) => {
    const currentTrip = tripRef.current;
    const origin = resolveTripOrigin(currentTrip.line);
    const withData = remoteRows.filter(isRemoteRowPrintable);
    const sorted = sortRemoteLedgerRows(withData);
    let displayId = 1;
    const consolidated = sorted.map((remote) => mapRemoteRowToLocal(remote, displayId++));
    return [...consolidated, ...buildEntrySlotRows(displayId, origin)];
  };

  const loadRemoteRows = async () => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    if (!branchId) return;
    if (!currentTrip.date || !currentTrip.line) return;

    const generation = ++loadGenerationRef.current;
    setRemoteLoading(true);
    setRemoteSyncedCount(0);

    try {
      await flushPendingRowSaves();
      if (generation !== loadGenerationRef.current) return;

      const origin = resolveTripOrigin(currentTrip.line);
      setRows(buildEntrySlotRows(1, origin));

      const baseParams = new URLSearchParams();
      baseParams.set('branchId', branchId);
      baseParams.set('ledgerDate', currentTrip.date);
      baseParams.set('lineLabel', currentTrip.line);
      baseParams.set('includeLoaded', includeLoaded ? 'true' : 'false');

      const byId = new Map<string, RemoteDailyLedgerRow>();
      let offset = 0;

      while (offset <= 50000) {
        if (generation !== loadGenerationRef.current) return;

        const params = new URLSearchParams(baseParams);
        params.set('limit', String(LEDGER_FETCH_CHUNK_SIZE));
        params.set('offset', String(offset));
        const batch = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);

        if (generation !== loadGenerationRef.current) return;
        if (!batch.length) break;

        for (const row of batch) {
          if (isRemoteRowPrintable(row)) {
            byId.set(row.id, row);
          }
        }
        setRemoteSyncedCount(byId.size);

        if (batch.length < LEDGER_FETCH_CHUNK_SIZE) break;
        offset += LEDGER_FETCH_CHUNK_SIZE;
      }

      if (generation !== loadGenerationRef.current) return;
      setRows(buildDisplayRowsFromRemote([...byId.values()]));
    } catch (error) {
      if (generation === loadGenerationRef.current) {
        showToast(error instanceof Error ? error.message : 'تعذر تحديث دفتر الشحن اليومي من الشبكة', 'error');
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setRemoteLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!loadingRefs) {
      void loadRemoteRows();
    }
  }, [activeBranchId, trip.date, trip.line, includeLoaded, loadingRefs]);

  useEffect(() => {
    let cancelled = false;
    const loadRefs = async () => {
      setLoadingRefs(true);
      try {
        const [branchesData, citiesData, goodsTypesData, customersData, driversData, vehiclesData] = await Promise.all([
          phase15Gateway.branches.getAll(),
          phase15Gateway.cities.getAll(),
          phase15Gateway.goodsTypes.getAll(),
          phase15Gateway.sendersReceivers.getAll(),
          phase15Gateway.drivers.getAll(),
          phase15Gateway.vehicles.getAll(),
        ]);
        if (cancelled) return;
        setBranches(branchesData);
        setCities(citiesData);
        setGoodsTypes(goodsTypesData);
        setCustomers(customersData);
        setDrivers(driversData.filter((d) => d.isActive));
        setVehicles(vehiclesData.filter((v) => v.isActive));
        let tariffsData: Tariff[] = [];
        try {
          tariffsData = await phase15Gateway.tariffs.getAll();
        } catch {
          /* قد لا تتوفر صلاحية مالية لبعض المستخدمين — الدفتر يعمل بدون تعريف أسعار */
        }
        if (cancelled) return;
        setTariffs(tariffsData);
        const preferredLine =
          branchesData.find((b) => normalizeName(b.name).includes('حلب'))?.name
          || branchesData[0]?.name
          || citiesData[0]?.name
          || 'فرع حلب';
        setTrip((prev) => {
          const normalized = normalizeName(prev.line);
          if (!normalized) return { ...prev, line: preferredLine };
          if (normalized.includes('فرع')) return prev;
          const mapped =
            branchesData.find((b) => normalizeName(b.name).includes('فرع') && normalizeName(b.name).includes(normalized))
              ?.name ?? '';
          return { ...prev, line: mapped || preferredLine };
        });

        if (user?.userType === 'agent' && user.agentId) {
          try {
            const prof = await httpClient.get<AgentProfilePayload>('/agent-portal/profile');
            const sid = syntheticEntityId(prof.agent.id);
            setRows((prev) =>
              prev.map((row) =>
                row.agentId ? row : { ...row, agentId: sid, agentName: prof.agent.name },
              ),
            );
          } catch {
            /* profile optional — lookup-by-destination still works */
          }
        } else if (user?.userType !== 'agent') {
          try {
            const list = await httpClient.get<
              Array<{ id: string; code: string; name: string; governorate?: string | null; is_active?: boolean }>
            >('/agents?includeInactive=false');
            const mapped = list
              .filter((a) => a.is_active !== false)
              .map((a) => ({
                id: syntheticEntityId(a.id),
                code: a.code,
                name: a.name,
                governorate: typeof a.governorate === 'string' ? a.governorate : undefined,
                city: typeof (a as { city?: string }).city === 'string' ? (a as { city?: string }).city : undefined,
                area: typeof (a as { area?: string }).area === 'string' ? (a as { area?: string }).area : undefined,
              }));
            setCatalogAgents(mapped);
          } catch (err) {
            console.warn('[ShipmentQuickLedger] /agents catalog failed', err);
          }
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'تعذر تحميل بيانات الإدخال السريع', 'error');
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    };
    void loadRefs();
    return () => {
      cancelled = true;
    };
  }, [showToast, user?.id, user?.userType, user?.agentId]);

  useEffect(() => {
    if (!user) return;
    if (!branches.length) return;
    if (activeBranchId) return;
    const isAdmin = user.userType === 'admin' || user.role === 'admin';
    if (isAdmin) {
      const aleppo =
        branches.find((b) => normalizeName(b.name) === 'حلب') ??
        branches.find((b) => normalizeName(b.name).includes('حلب'));
      const backendId = aleppo ? getBackendIdFromSynthetic(aleppo.id) : null;
      if (backendId) void setActiveBranch(backendId);
      return;
    }
    const fallback = user.branchId ?? user.allowedBranchIds?.[0] ?? null;
    if (fallback) void setActiveBranch(fallback);
  }, [activeBranchId, branches, setActiveBranch, user]);

  useEffect(() => {
    if (!activeBranchId) return;
    if (!branches.length) return;
    const sid = syntheticEntityId(activeBranchId);
    const found = branches.find((b) => b.id === sid);
    if (found) setBranchSearch(found.name);
  }, [activeBranchId, branches]);

  const clearFailedSaveRow = (rowId: number) => {
    setFailedSaveRows((prev) => {
      if (!prev[rowId]) return prev;
      const next = { ...prev };
      delete next[rowId];
      persistFailedSaveRows(tripRef.current.date, tripRef.current.line, next);
      return next;
    });
  };

  const mergeFailedSaveRows = (failures: FailedSaveRowMap) => {
    if (!Object.keys(failures).length) return;
    setFailedSaveRows((prev) => {
      const next = { ...prev, ...failures };
      persistFailedSaveRows(tripRef.current.date, tripRef.current.line, next);
      return next;
    });
  };

  const updateRow = (id: number, field: keyof LedgerRow, value: string, skipTariff = false) => {
    if (field === 'receiptNo') {
      const normalized = normalizeName(value);
      if (normalized) {
        const self = rowsRef.current.find((entry) => entry.id === id);
        if (self) {
          const dup = findReceiptConflictForRow({ ...self, receiptNo: normalized }, rowsRef.current);
          if (dup) {
            showToast(describeReceiptConflict(rowsRef.current, { ...self, receiptNo: normalized }, dup), 'error');
            return;
          }
        }
      }
    }

    setRows((prev) => {
      const before = prev.find((row) => row.id === id);
      const mapped = prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'parcelType') {
          const next = { ...row, parcelType: value, collectManual: false };
          return skipTariff ? next : mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
        }
        if (field === 'collectAmount') {
          return { ...row, collectAmount: value, collectManual: value.trim() !== '' };
        }
        if (field === 'prepaidAmount') {
          const prepaid = parseUsd(value);
          let next: LedgerRow = { ...row, prepaidAmount: value };
          if (prepaid > 0) {
            next = { ...next, collectAmount: '', collectManual: true };
          } else {
            next = { ...next, collectManual: false };
            next = skipTariff ? next : mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
          }
          return next;
        }
        let next: LedgerRow = { ...row, [field]: value };
        if (!skipTariff && (field === 'origin' || field === 'destination' || field === 'weightKg')) {
          next = { ...next, collectManual: false };
          next = mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
        }
        return next;
      });
      const after = mapped.find((row) => row.id === id);
      const becameSavable = after && isRowSavable(after) && (!before || !isRowSavable(before));
      return becameSavable ? appendTrailingEntrySlot(mapped) : mapped;
    });
    if (field === 'receiptNo' || field === 'destination' || field === 'sender' || field === 'receiver') {
      clearFailedSaveRow(id);
    }
    queueRowSave(id);
  };

  const syncPostedShipmentInBackground = (
    row: LedgerRow,
    saved: RemoteDailyLedgerRow,
    currentTrip: typeof trip,
  ) => {
    void (async () => {
      if (!saved.posted_shipment_id || saved.loaded_at) return;
      const shipmentSyntheticId = syntheticEntityId(saved.posted_shipment_id);
      const originBranch = resolveTripOrigin(currentTrip.line);
      const branchForRow = branchForOriginRow(originBranch);
      if (!branchForRow) return;
      try {
        const resolveCustomer = async (name: string, type: 'sender' | 'receiver') => {
          const list = customersRef.current;
          const normalized = normalizeName(name);
          const existing = list.find((customer) => normalizeName(customer.name) === normalized);
          if (existing) return { customer: existing, list };
          const created = await phase15Gateway.sendersReceivers.create({
            name: normalized,
            phone: '',
            customerType: type,
            address: '',
            balance: 0,
            creditLimit: 0,
            notes: '',
          });
          const nextList = [...list, created];
          setCustomers(nextList);
          return { customer: created, list: nextList };
        };

        const resolveGoodsType = async (name: string) => {
          const list = goodsTypesRef.current;
          const normalized = normalizeName(name);
          const existing = list.find((item) => normalizeName(item.name) === normalized);
          if (existing) return { goodsType: existing, list };
          const created = await phase15Gateway.goodsTypes.create({
            code: `GT-${Date.now()}`,
            name: normalized,
            description: '',
          });
          const nextList = [...list, created];
          setGoodsTypes(nextList);
          return { goodsType: created, list: nextList };
        };

        const senderResult = await resolveCustomer(row.sender, 'sender');
        const receiverResult = await resolveCustomer(row.receiver, 'receiver');
        const goodsResult = await resolveGoodsType(row.parcelType);

        const amounts = shipmentAmountsFromLedgerRow(row);
        await phase15Gateway.shipments.update(shipmentSyntheticId, {
          date: currentTrip.date,
          branchId: branchForRow.id,
          branchName: branchForRow.name,
          agentId: row.agentId,
          agentName: row.agentName,
          originName: normalizeName(originBranch),
          status: 'confirmed',
          senderId: senderResult.customer.id,
          senderName: senderResult.customer.name,
          receiverId: receiverResult.customer.id,
          receiverName: receiverResult.customer.name,
          destinationName: normalizeName(row.destination),
          goodsTypeId: goodsResult.goodsType.id,
          goodsTypeName: goodsResult.goodsType.name,
          quantity: Number(row.parcelCount) || 1,
          weight: parseWeightKg(row.weightKg),
          freightCharge: amounts.freightCharge,
          transferFee: amounts.transferFee,
          hawalaAmount: amounts.hawalaAmount,
          transferServiceFee: amounts.transferServiceFee,
          prepaidAmount: amounts.prepaidAmount,
          discount: 0,
          total: amounts.total,
          currency: 'USD',
          notes: [row.notes, currentTrip.tripNo ? `رقم الرحلة: ${currentTrip.tripNo}` : '', currentTrip.vehicle ? `المركبة: ${currentTrip.vehicle}` : '', currentTrip.driver ? `السائق: ${currentTrip.driver}` : '']
            .filter(Boolean)
            .join(' | '),
        });
      } catch {
        /* إذا تعذر تحديث الشحنة، يبقى سطر الدفتر محفوظاً */
      }
    })();
  };

  const saveRowToServer = async (displayRowId: number) => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    if (!branchId) return;
    if (!currentTrip.date || !currentTrip.line) return;
    const row = rowsRef.current.find((r) => r.id === displayRowId);
    if (!row) return;
    if (!shouldPersistRow(row)) return;
    const dup = findReceiptConflictForRow(row, rowsRef.current);
    if (dup) {
      const message = describeReceiptConflict(rowsRef.current, row, dup);
      quickLedgerLog.log('warn', 'autosave', message, logRowContext(row));
      showToast(message, 'error');
      return;
    }

    const prior = saveInFlightRef.current[displayRowId];
    if (prior) {
      try {
        await prior;
      } catch {
        /* السطر السابق فشل — نعيد المحاولة */
      }
    }

    const origin = resolveTripOrigin(currentTrip.line);

    const task = (async () => {
      const latestRow = rowsRef.current.find((r) => r.id === displayRowId);
      if (!latestRow || !shouldPersistRow(latestRow)) return;
      const dup = findReceiptConflictForRow(latestRow, rowsRef.current);
      if (dup) {
        const message = describeReceiptConflict(rowsRef.current, latestRow, dup);
        quickLedgerLog.log('warn', 'autosave', message, logRowContext(latestRow));
        showToast(message, 'error');
        return;
      }

      const latestFleet = resolveFleetForLedgerRow(latestRow, currentTrip, driversRef.current, vehiclesRef.current);
      const latestDriverId = latestRow.sessionDriverId ?? currentTrip.driverId;
      const latestRowNo =
        latestRow.serverRowNo ??
        nextServerRowNoForDriver(rowsRef.current, latestDriverId) ??
        latestRow.id;

      try {
        const saved = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
          branchId,
          ledgerDate: currentTrip.date,
          lineLabel: currentTrip.line,
          originLabel: origin,
          tripNo: currentTrip.tripNo || null,
          ...(latestRow.dbId ? { rowId: latestRow.dbId } : {}),
          ...latestFleet,
          rowNo: latestRowNo,
          receiptNo: latestRow.receiptNo || null,
          destination: latestRow.destination,
          parcelType: latestRow.parcelType,
          parcelCount: Number(latestRow.parcelCount) || null,
          weightKg: parseWeightKg(latestRow.weightKg) ?? null,
          senderName: latestRow.sender,
          receiverName: latestRow.receiver,
          collectAmountUsd: parseUsd(latestRow.collectAmount),
          prepaidAmountUsd: parseUsd(latestRow.prepaidAmount),
          hawalaAmountUsd: parseUsd(latestRow.receiverCollect),
          feesAmountUsd: 0,
          transferServiceFeeUsd: parseUsd(latestRow.transferServiceFee),
          notes: latestRow.notes || null,
        });
        setRows((prev) => {
          const mapped = prev.map((r) =>
            r.id === displayRowId
              ? {
                  ...r,
                  dbId: saved.id,
                  serverRowNo: saved.row_no,
                  sessionDriverId: saved.driver_id
                    ? syntheticEntityId(saved.driver_id)
                    : latestDriverId || r.sessionDriverId,
                  updatedAt: saved.updated_at,
                  postedShipmentId: saved.posted_shipment_id,
                  loadedAt: saved.loaded_at,
                }
              : r,
          );
          const savedRow = mapped.find((r) => r.id === displayRowId);
          if (savedRow?.dbId && isRowSavable(savedRow)) {
            return appendTrailingEntrySlot(mapped);
          }
          return mapped;
        });

        syncPostedShipmentInBackground(latestRow, saved, currentTrip);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ السطر';
        quickLedgerLog.log('error', 'autosave', message, logRowContext(latestRow));
        showToast(message, 'error');
        throw error;
      }
    })();

    saveInFlightRef.current[displayRowId] = task;
    try {
      await task;
    } finally {
      if (saveInFlightRef.current[displayRowId] === task) {
        delete saveInFlightRef.current[displayRowId];
      }
    }
  };
  saveRowToServerRef.current = saveRowToServer;

  const queueRowSave = (rowNo: number) => {
    const timer = saveTimersRef.current[rowNo];
    if (timer) window.clearTimeout(timer);
    saveTimersRef.current[rowNo] = window.setTimeout(() => {
      delete saveTimersRef.current[rowNo];
      void saveRowToServer(rowNo);
    }, ROW_SAVE_DEBOUNCE_MS);
  };

  const flushRowSave = (rowNo: number) => {
    const timer = saveTimersRef.current[rowNo];
    if (timer) {
      window.clearTimeout(timer);
      delete saveTimersRef.current[rowNo];
    }
    void saveRowToServer(rowNo);
  };

  const resolveTripOrigin = (lineValue: string) => {
    const raw = normalizeName(lineValue);
    if (!raw) return '';
    const firstPart = normalizeName(raw.split(/\s*[-–—]\s*/)[0] || raw);
    const branch = branches.find((item) => normalizeName(item.name) === firstPart);
    if (branch) return branch.name;
    const city = cities.find((item) => normalizeName(item.name) === firstPart);
    if (city) return city.name;
    return firstPart;
  };

  const applyTripOriginToRows = (lineValue: string) => {
    const origin = resolveTripOrigin(lineValue);
    if (!origin) return;
    setRows((prev) =>
      prev.map((row) => {
        if (row.dbId || row.postedShipmentId || row.loadedAt) return row;
        const next = { ...row, origin, collectManual: false };
        return mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
      }),
    );
  };

  const handleTripLineChange = (value: string) => {
    setTrip((prev) => ({ ...prev, line: value }));
    applyTripOriginToRows(value);
  };

  const branchForOriginRow = (originValue: string): Branch | undefined => {
    const o = normalizeName(originValue);
    if (!o) return branches[0];
    return branches.find((b) => normalizeName(b.name) === o) ?? branches[0];
  };

  const refreshCatalogAgents = async () => {
    if (user?.userType === 'agent') return;
    setAgentHelpLoading(true);
    try {
      const list = await httpClient.get<
        Array<{ id: string; code: string; name: string; governorate?: string | null; is_active?: boolean }>
      >('/agents?includeInactive=false');
      const mapped: SuggestedAgent[] = list
        .filter((a) => a.is_active !== false)
        .map((a) => ({
          id: syntheticEntityId(a.id),
          code: a.code,
          name: a.name,
          governorate: typeof a.governorate === 'string' ? a.governorate : undefined,
          city: typeof (a as { city?: string }).city === 'string' ? (a as { city?: string }).city : undefined,
          area: typeof (a as { area?: string }).area === 'string' ? (a as { area?: string }).area : undefined,
        }));
      setCatalogAgents(mapped);
    } catch (err) {
      console.warn('[ShipmentQuickLedger] refresh agents catalog failed', err);
    } finally {
      setAgentHelpLoading(false);
    }
  };

  const openAgentHelp = () => {
    setAgentHelpOpen(true);
    void refreshCatalogAgents();
  };

  const lookupAgentsForRow = async (rowId: number, destinationValue: string, originValue: string) => {
    const destination = normalizeName(destinationValue);
    if (!destination) return;
    try {
      const agents = await phase15Gateway.agents.lookupByDestination(destination);
      const mapped: SuggestedAgent[] = dedupeAgentsForDestination(
        agents.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          governorate:
            typeof (a as { governorate?: unknown }).governorate === 'string'
              ? (a as { governorate?: string }).governorate
              : undefined,
          city: typeof (a as { city?: unknown }).city === 'string' ? (a as { city?: string }).city : undefined,
          area: typeof (a as { area?: unknown }).area === 'string' ? (a as { area?: string }).area : undefined,
        })),
        destination,
      ).map((a) => ({
        id: a.id as number,
        code: a.code,
        name: a.name,
        governorate: a.governorate,
        city: a.city,
        area: a.area,
      }));
      setAgentSuggestions((prev) => ({ ...prev, [rowId]: mapped }));
      if (mapped.length === 1) {
        const destinationLabel = resolveAgentDestinationLabel(mapped[0]);
        setRows((prev) =>
          prev.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  agentId: mapped[0].id,
                  agentName: mapped[0].name,
                  destination: destinationLabel || row.destination,
                }
              : row,
          ),
        );
        if (destinationLabel) queueRowSave(rowId);
      }
    } catch {
      /* ignore */
    }
  };

  const addRows = () => {
    setRows((prev) => {
      const blankNewEntries = prev.filter((row) => !row.dbId && !row.loadedAt && !isRowStarted(row));
      if (blankNewEntries.length) {
        showToast('استخدم السطر الفارغ في الأسفل للإدخال الجديد', 'info');
        return prev;
      }
      const maxId = prev.reduce((max, row) => Math.max(max, row.id), 0);
      const origin = resolveTripOrigin(trip.line);
      return [...prev, ...buildEntrySlotRows(maxId + 1, origin, LEDGER_ROWS_ADD_INCREMENT)];
    });
  };

  /** إعادة حساب تحصيل $ من التعريف بعد تعديل الوزن أو الجهة (لا يُستبدل إن كان المستخدم عدّل التحصيل يدوياً). */
  const recalcTariffCollectForRowId = (rowId: number) => {
    let changed = false;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        changed = true;
        return mergeRowWithAutoTariff({ ...r, collectManual: false }, tariffs, cities, branches, goodsTypes, trip.date);
      }),
    );
    if (changed) flushRowSave(rowId);
  };

  const focusEditable = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.focus();
      if (el instanceof HTMLInputElement && typeof el.select === 'function') {
        try {
          el.select();
        } catch {
          /* بعض أنواع الحقول لا تدعم select */
        }
      }
      return;
    }
    const inner = el.querySelector<HTMLElement>('input, select, textarea');
    inner?.focus();
  };

  const focusNext = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const key = event.key;
    const allFields = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));

    if (key === 'Enter') {
      event.preventDefault();
      const fields = allFields();
      const currentIndex = fields.indexOf(event.currentTarget as HTMLElement);
      focusEditable(fields[currentIndex + 1]);
      return;
    }

    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const input = target instanceof HTMLInputElement ? target : null;

    // تنقل أفقي (يمين/يسار) — فقط عند حافة النص حتى لا يتعطل تحرير الخلية
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (input && input.type !== 'checkbox') {
        const len = input.value.length;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === len && input.selectionEnd === len;
        // RTL: يسار بصرياً = الحقل التالي في DOM (عند نهاية النص منطقياً)
        if (key === 'ArrowLeft' && !atEnd) return;
        if (key === 'ArrowRight' && !atStart) return;
      }
      const fields = allFields();
      const idx = fields.indexOf(target);
      if (idx < 0) return;
      event.preventDefault();
      focusEditable(key === 'ArrowLeft' ? fields[idx + 1] : fields[idx - 1]);
      return;
    }

    // تنقل عمودي (أعلى/أسفل) — نفس العمود في الصف المجاور
    const tr = target.closest('tr');
    if (!tr) return;
    const rowFields = Array.from(tr.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));
    const colIndex = rowFields.indexOf(target);
    if (colIndex < 0) return;
    const bodyRows = Array.from(tr.parentElement?.querySelectorAll<HTMLTableRowElement>(':scope > tr') ?? []);
    const rowIndex = bodyRows.indexOf(tr as HTMLTableRowElement);
    const targetRow = key === 'ArrowDown' ? bodyRows[rowIndex + 1] : bodyRows[rowIndex - 1];
    if (!targetRow) return;
    const targetFields = Array.from(targetRow.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));
    if (!targetFields.length) return;
    event.preventDefault();
    focusEditable(targetFields[Math.min(colIndex, targetFields.length - 1)]);
  };

  const dedupeAgentsList = (options: SuggestedAgent[]) => {
    const seen = new Set<number>();
    return options.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  };

  const commitDestinationCell = (row: LedgerRow, rawInput: string) => {
    void (async () => {
      const raw = rawInput.trim();
      let next = raw;
      let agentId = row.agentId;
      let agentName = row.agentName;
      const cityResolved = resolveDestinationByQuickCode(raw, cities, branches);
      if (cityResolved) {
        next = cityResolved;
        agentId = undefined;
        agentName = '';
      } else {
        const quickGovernorate = isDigitsOnlyQuickCode(raw)
          ? resolveGovernorateFromQuickCode(
              raw,
              catalogAgents.map((agent) => ({
                code: agent.code,
                name: agent.name,
                governorate: agent.governorate,
                is_active: true,
              })),
            )
          : null;
        if (quickGovernorate) {
          next = quickGovernorate;
        }
        const unique = dedupeAgentsList([...(agentSuggestions[row.id] || []), ...catalogAgents]);
        const codeMatch = !quickGovernorate ? matchByEntityCode(unique, raw) : undefined;
        const nameMatches = codeMatch
          ? [codeMatch]
          : unique.filter((a) => {
              const label = resolveAgentDestinationLabel(a);
              const normRaw = normalizeName(raw);
              return (
                normalizeName(label) === normRaw ||
                normalizeName(a.name) === normRaw ||
                normalizeName(a.governorate ?? '') === normRaw ||
                normalizeName(a.city ?? '') === normRaw
              );
            });
        const agent =
          (nameMatches.length > 1
            ? pickPreferredAgentForGovernorate(nameMatches)
            : nameMatches[0]) ?? undefined;
        if (agent) {
          next = resolveAgentDestinationLabel(agent);
          agentId = agent.id;
          agentName = agent.name;
        } else if (isDigitsOnlyQuickCode(raw) && raw) {
          showToast(`لا يوجد فرع/مدينة/وكيل بالكود «${raw}»`, 'info');
        } else if (normalizeName(raw)) {
          showToast(
            'تأكد أن «الجهة» تطابق محافظة الوكيل (مثل: الرقة، الحسكة) ليتم حفظ الشحنة وربطها بالوكيل.',
            'info',
          );
        }
      }
      const norm = normalizeName(next);
      if (norm) rememberDestinationOption(norm);
      setRows((prev) =>
        appendTrailingEntrySlot(
          prev.map((r) => {
            if (r.id !== row.id) return r;
            const merged: LedgerRow = {
              ...r,
              destination: norm || r.destination,
              agentId,
              agentName,
              collectManual: false,
            };
            return mergeRowWithAutoTariff(merged, tariffs, cities, branches, goodsTypes, trip.date);
          }),
        ),
      );
      const destLookup = norm || normalizeName(raw);
      if (destLookup) {
        await lookupAgentsForRow(row.id, destLookup, row.origin);
      }
      const latest = rowsRef.current.find((r) => r.id === row.id);
      if (latest && shouldPersistRow(latest)) {
        flushRowSave(row.id);
      }
    })();
  };

  const rememberDestinationOption = (value: string) => {
    const normalized = normalizeName(value);
    if (!normalized) return;
    setDestinationOptions((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
  };

  const handleSmartFieldKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    row: LedgerRow,
    field: 'origin' | 'destination',
  ) => {
    if (event.key === 'Enter') {
      if (field === 'destination') {
        commitDestinationCell(row, event.currentTarget.value);
      } else {
        let normalized = normalizeName(event.currentTarget.value);
        if (field === 'origin' && branches.length) {
          const resolved = resolveOriginByQuickCode(normalized, branches);
          if (resolved) normalized = resolved;
        }
        if (normalized) {
          updateRow(row.id, field, normalized);
        }
      }
    }
    focusNext(event);
  };

  const closeSection = () => {
    setCloseConfirmOpen(false);
    navigate('/shipments');
  };

  const openPrintDialog = () => {
    setDeleteMode(false);
    setSelectedDeleteRowIds([]);
    setPrintDriverId(trip.driverId || 0);
    setPrintDateFrom(trip.date);
    setPrintDateTo(trip.date);
    setPrintDialogOpen(true);
  };

  const exitDeleteMode = () => {
    setDeleteMode(false);
    setSelectedDeleteRowIds([]);
    setDeleteConfirmOpen(false);
  };

  const enterTransferMode = () => {
    setDeleteMode(false);
    setSelectedDeleteRowIds([]);
    setTransferMode(true);
    setSelectedTransferRowIds([]);
  };

  const exitTransferMode = () => {
    setTransferMode(false);
    setSelectedTransferRowIds([]);
    setTransferDialogOpen(false);
    setTransferValidation({ loading: false, warnings: [], errors: [] });
  };

  const toggleTransferRowSelection = (rowId: number) => {
    setSelectedTransferRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId],
    );
  };

  const toggleSelectAllTransferable = () => {
    const ids = transferableVisibleRows.map((row) => row.id);
    setSelectedTransferRowIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  const openTransferDialog = async () => {
    if (!selectedTransferRowIds.length) {
      showToast('يجب تحديد سطر واحد على الأقل', 'error');
      return;
    }
    const dbIds = selectedTransferRows.map((row) => row.dbId).filter((id): id is string => Boolean(id));
    if (dbIds.length !== selectedTransferRows.length) {
      showToast('بعض الأسطر المحددة غير محفوظة — احفظ الدفتر أولاً قبل النقل', 'error');
      return;
    }
    setTransferReason('');
    setTransferDriverId(trip.driverId || 0);
    setTransferVehicleId(trip.vehicleId || 0);
    setTransferDate(trip.date);
    setTransferDialogOpen(true);
    setTransferValidation({ loading: true, warnings: [], errors: [] });
    try {
      const result = await httpClient.post<{
        valid: boolean;
        summary: {
          rowsCount: number;
          piecesCount: number;
          weightKg: number;
          weightTons: number;
          freightTotal: number;
          collectionTotal: number;
          prepaidTotal: number;
          destinations: string[];
        };
        warnings: string[];
        errors: string[];
      }>('/daily-ledger/transfer/validate', { rowIds: dbIds });
      setTransferValidation({
        loading: false,
        summary: result.summary,
        warnings: result.warnings,
        errors: result.errors,
      });
    } catch (error) {
      setTransferValidation({
        loading: false,
        warnings: [],
        errors: [error instanceof Error ? error.message : 'تعذر التحقق من الأسطر المحددة'],
      });
    }
  };

  const confirmTransfer = async () => {
    const dbIds = selectedTransferRows.map((row) => row.dbId).filter((id): id is string => Boolean(id));
    if (!dbIds.length) {
      showToast('لا توجد أسطر محفوظة للنقل', 'error');
      return;
    }
    if (!transferReason.trim()) {
      showToast('يجب إدخال سبب النقل', 'error');
      return;
    }
    if (!transferDriverId && !transferVehicleId) {
      showToast('يجب تحديد سائق أو مركبة للإرسالية الجديدة', 'error');
      return;
    }
    const driverBackendId = transferDriverId ? getBackendIdFromSynthetic(transferDriverId) ?? null : null;
    const vehicleBackendId = transferVehicleId ? getBackendIdFromSynthetic(transferVehicleId) ?? null : null;
    setTransferring(true);
    try {
      const result = await httpClient.post<{
        transferNo: string;
        movedRowsCount: number;
        targetSessionId: string;
      }>('/daily-ledger/transfer/confirm', {
        rowIds: dbIds,
        target: {
          ledgerDate: transferDate,
          driverId: driverBackendId,
          vehicleId: vehicleBackendId,
          notes: trip.tripNo || null,
        },
        reason: transferReason.trim(),
      });
      showToast(`تم نقل الإرسالية بنجاح — ${result.movedRowsCount} سطر (${result.transferNo})`, 'success');
      exitTransferMode();
      // الانتقال إلى الإرسالية الجديدة: نفس التاريخ/الخط مع السائق الجديد
      const targetDriver = drivers.find((d) => d.id === transferDriverId);
      setTrip((prev) => ({
        ...prev,
        date: transferDate,
        driverId: transferDriverId || prev.driverId,
        driver: targetDriver?.name ?? prev.driver,
        vehicleId: transferVehicleId || prev.vehicleId,
      }));
      await loadRemoteRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر نقل الإرسالية', 'error');
    } finally {
      setTransferring(false);
    }
  };

  const toggleDeleteRowSelection = (rowId: number) => {
    setSelectedDeleteRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId],
    );
  };

  const toggleSelectAllDeletable = () => {
    const ids = deletableVisibleRows.map((row) => row.id);
    setSelectedDeleteRowIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  const deleteSelectedRows = async () => {
    const selected = rows.filter((row) => selectedDeleteRowIds.includes(row.id));
    if (!selected.length) {
      showToast('لم تُحدَّد أسطر للحذف', 'info');
      return;
    }
    if (selected.some((row) => row.loadedAt)) {
      showToast('لا يمكن حذف أسطر محمّلة على بيان', 'error');
      return;
    }

    setDeletingRows(true);
    try {
      await flushPendingRowSaves();
      const dbIds = selected.map((row) => row.dbId).filter((id): id is string => Boolean(id));
      if (dbIds.length) {
        const result = await httpClient.post<{ deletedIds: string[]; blockedIds: string[] }>(
          '/daily-ledger/rows/delete',
          { rowIds: dbIds },
        );
        if (result.blockedIds.length) {
          showToast(`تعذر حذف ${result.blockedIds.length} سطر (ربما محمّل على بيان)`, 'error');
        }
      }

      const origin = resolveTripOrigin(tripRef.current.line);
      setRows((prev) => {
        const remaining = prev.filter((row) => !selectedDeleteRowIds.includes(row.id));
        if (!remaining.length) return buildEntrySlotRows(1, origin);
        return appendTrailingEntrySlot(remaining);
      });
      exitDeleteMode();
      showToast(`تم حذف ${selected.length} سطر`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حذف الأسطر المحددة', 'error');
    } finally {
      setDeletingRows(false);
    }
  };

  const handleDriverSelect = (driverId: number) => {
    const driver = drivers.find((d) => d.id === driverId);
    const linkedVehicle = driverId ? vehicles.find((v) => v.driverId === driverId) : undefined;
    setTrip((prev) => ({
      ...prev,
      driverId: driverId || 0,
      driver: driver?.name ?? '',
      ...(linkedVehicle
        ? {
            vehicleId: linkedVehicle.id,
            vehicle: `${linkedVehicle.plateNumber}${linkedVehicle.model ? ` — ${linkedVehicle.model}` : ''}`,
          }
        : { vehicleId: 0, vehicle: '' }),
    }));
  };

  const handleVehicleSelect = (vehicleId: number) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    const linkedDriver = vehicle?.driverId ? drivers.find((d) => d.id === vehicle.driverId) : undefined;
    setTrip((prev) => ({
      ...prev,
      vehicleId,
      vehicle: vehicle ? `${vehicle.plateNumber}${vehicle.model ? ` — ${vehicle.model}` : ''}` : '',
      ...(linkedDriver
        ? { driverId: linkedDriver.id, driver: linkedDriver.name }
        : vehicle?.driverId
          ? { driverId: vehicle.driverId, driver: vehicle.driverName ?? prev.driver }
          : {}),
    }));
  };

  const prepareDriverPrintRows = async (): Promise<{
    rows: RemoteDailyLedgerRow[];
    activeSearch: string;
    selectedDriver: Driver | undefined;
  } | null> => {
    const branchId = activeBranchIdRef.current;
    if (!branchId) {
      showToast('يرجى اختيار الفرع قبل الطباعة', 'error');
      return null;
    }
    if (!printDateFrom || !printDateTo) {
      showToast('يرجى اختيار فترة التاريخ', 'error');
      return null;
    }
    if (printDateFrom > printDateTo) {
      showToast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'error');
      return null;
    }
    if (!printDriverId) {
      showToast('يرجى اختيار السائق قبل الطباعة', 'error');
      return null;
    }

    const driverBackendId = getBackendIdFromSynthetic(printDriverId);
    if (!driverBackendId) {
      showToast('تعذر تحديد السائق', 'error');
      return null;
    }
    const selectedDriver = drivers.find((d) => d.id === printDriverId);

    const params = new URLSearchParams();
    params.set('branchId', branchId);
    params.set('dateFrom', printDateFrom);
    params.set('dateTo', printDateTo);
    params.set('includeLoaded', 'true');
    const data = await fetchAllDailyLedgerRows(params);
    const activeSearch = searchQuick.trim();
    const rows = sortRemoteLedgerRows(
      data.filter(
        (row) =>
          remoteRowMatchesDriver(row, {
            driverBackendId,
            driverName: selectedDriver?.name,
          }) && matchesQuickLedgerSearch(activeSearch, remoteRowSearchFields(row)),
      ),
    );

    if (!rows.length) {
      showToast(
        activeSearch
          ? `لا توجد أسطر للسائق تطابق البحث «${activeSearch}»`
          : 'لا توجد أسطر لهذا السائق في الفترة المحددة',
        'info',
      );
      return null;
    }

    showToast(
      activeSearch
        ? `تم جلب ${rows.length} سطر (بحث: ${activeSearch})`
        : `تم جلب ${rows.length} سطر للطباعة`,
      'info',
    );

    return { rows, activeSearch, selectedDriver };
  };

  const dispatchHtmlPrint = async (html: string, documentType: string) => {
    if (window.printer?.getDefault && window.printer?.print) {
      const defaultPrinter = await window.printer.getDefault();
      if (defaultPrinter.available && defaultPrinter.printer?.name) {
        const result = await window.printer.print({
          documentType,
          printerTarget: defaultPrinter.printer.name,
          copies: 1,
          payloadType: 'html',
          content: html,
        });
        if (result.queued) {
          showToast(result.message || 'تم إرسال الطباعة', 'success');
          return;
        }
        showToast(result.message || 'فشلت الطباعة', 'error');
        return;
      }
      showToast(defaultPrinter.message || 'لم يتم العثور على طابعة افتراضية', 'error');
      return;
    }

    if (isElectronRuntime()) {
      showToast('خدمة الطباعة غير متاحة — أعد تشغيل التطبيق بعد التحديث', 'error');
      return;
    }

    printHtmlInBrowser(html);
    showToast('تم فتح معاينة الطباعة', 'success');
  };

  const executeShipmentsPrint = async () => {
    setPrintLoading(true);
    try {
      const prepared = await prepareDriverPrintRows();
      if (!prepared) return;

      const { rows, activeSearch, selectedDriver } = prepared;
      const currentTrip = tripRef.current;
      const linkedVehicle = vehicles.find((v) => v.driverId === printDriverId);
      const vehicleLabel = linkedVehicle
        ? `${linkedVehicle.plateNumber}${linkedVehicle.model ? ` — ${linkedVehicle.model}` : ''}`
        : currentTrip.vehicle || '—';
      const dateLabel =
        printDateFrom === printDateTo ? printDateFrom : `${printDateFrom} → ${printDateTo}`;

      const html = buildQuickLedgerPrintHtml(
        rows.map(remoteRowToPrint),
        {
          title: activeSearch
            ? `دفتر الشحن — ${selectedDriver?.name ?? ''} — ${activeSearch}`
            : `دفتر الشحن — ${selectedDriver?.name ?? ''}`,
          dateLabel,
          driverName: selectedDriver?.name ?? '—',
          vehicleLabel,
        },
      );

      setPrintDialogOpen(false);
      await dispatchHtmlPrint(html, 'quick_ledger');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تنفيذ طباعة الشحنات', 'error');
    } finally {
      setPrintLoading(false);
    }
  };

  const executeReceiptsPrint = async () => {
    setPrintLoading(true);
    try {
      const prepared = await prepareDriverPrintRows();
      if (!prepared) return;

      const { rows, activeSearch, selectedDriver } = prepared;
      const title = activeSearch
        ? `إيصالات — ${selectedDriver?.name ?? ''} — ${activeSearch}`
        : `إيصالات — ${selectedDriver?.name ?? ''}`;

      const html = buildMahmoudPreprintedReceiptHtml(rows.map(mapRemoteLedgerRowToMahmoudReceipt), {
        title,
        applyPrintTransform: false,
      });

      setPrintDialogOpen(false);
      await dispatchHtmlPrint(html, 'mahmoud_receipt');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تنفيذ طباعة الإيصالات', 'error');
    } finally {
      setPrintLoading(false);
    }
  };

  const logRowContext = (row: LedgerRow) => ({
    rowLabel: rowProgressLabel(row),
    receiptNo: row.receiptNo,
    destination: row.destination,
  });

  const patchSaveItem = (key: string, patch: Partial<SaveProgressItem>) => {
    setSaveProgress((prev) => applySaveProgressItemPatch(prev, key, patch));
  };

  const saveRows = async () => {
    if (!activeBranchId) {
      showToast('يرجى اختيار الفرع قبل حفظ الشحنات', 'error');
      return;
    }
    const origin = resolveTripOrigin(trip.line);
    if (!origin) {
      showToast('يرجى اختيار الخط / المصدر أولاً', 'error');
      return;
    }

    const batchId = quickLedgerLog.startBatch({
      ledgerDate: trip.date,
      lineLabel: trip.line,
      branchId: activeBranchId,
      rowsToPost: 0,
    });

    setSaveProgress({
      open: true,
      phase: 'preparing',
      phaseLabel: 'جاري تجهيز الحفظ ومزامنة الأسطر...',
      items: [],
      completedCount: 0,
      totalCount: 0,
      startedAt: new Date().toISOString(),
      batchId,
    });
    setSaving(true);

    const failBatch = (
      phaseLabel: string,
      message: string,
      progressItems: SaveProgressItem[],
      details?: Record<string, unknown>,
    ) => {
      quickLedgerLog.log('error', 'validation', message, { details });
      quickLedgerLog.endBatch('failed', message, details);
      mergeFailedSaveRows(failedRowsFromProgressItems(progressItems));
      setSaveProgress((prev) => ({
        ...prev,
        items: progressItems,
        phase: 'failed',
        phaseLabel,
        summary: message,
        finishedAt: new Date().toISOString(),
      }));
      showToast(message, 'error');
    };

    try {
      quickLedgerLog.log('info', 'prepare', 'مزامنة الأسطر قبل الحفظ الجماعي');
      await flushPendingRowSaves();

      const currentRows = rowsRef.current;
      const rowsToPost = currentRows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
      const alreadyPostedCount = currentRows.filter(
        (row) => isRowStarted(row) && row.postedShipmentId,
      ).length;
      const resumeMode = alreadyPostedCount > 0 && rowsToPost.length > 0;

      quickLedgerLog.log('info', 'prepare', resumeMode ? 'استكمال حفظ متبقٍ' : 'بدء حفظ جديد', {
        details: { rowsToPost: rowsToPost.length, alreadyPostedCount },
      });

      const progressItems = buildSaveProgressItems(rowsToPost);
      setSaveProgress((prev) => ({
        ...prev,
        items: progressItems,
        totalCount: progressItems.length,
        alreadyPostedCount,
        phase: !rowsToPost.length ? 'done' : 'validating',
        phaseLabel: !rowsToPost.length
          ? 'اكتمل — لا توجد أسطر جديدة للترحيل'
          : resumeMode
            ? `استكمال الحفظ — ${rowsToPost.length} سطر متبقٍ (${alreadyPostedCount} مُرحَّل مسبقاً)`
            : 'التحقق من الإيصالات والسائق...',
      }));

      if (!rowsToPost.length) {
        quickLedgerLog.endBatch('success', 'لا توجد أسطر جديدة للترحيل — تمت مزامنة التعديلات فقط');
        setSaveProgress((prev) => ({
          ...prev,
          phase: 'done',
          phaseLabel: 'اكتمل — لا توجد أسطر جديدة للترحيل',
          summary: 'تمت مزامنة التعديلات على الأسطر.',
          completedCount: 0,
          totalCount: 0,
          finishedAt: new Date().toISOString(),
        }));
        showToast('تم حفظ التعديلات على الأسطر', 'success');
        await loadRemoteRows();
        return;
      }

      const batchDup = findDuplicateWithinBatch(rowsToPost);
      if (batchDup) {
        const message = describeReceiptConflict(currentRows, batchDup.row, batchDup.other);
        const items = progressItems.map((item) => {
          if (item.key === String(batchDup.row.id)) {
            return { ...item, status: 'error' as const, message };
          }
          if (item.key === String(batchDup.other.id)) {
            return { ...item, status: 'error' as const, message: 'مكرر مع سطر آخر' };
          }
          return item;
        });
        failBatch('فشل التحقق — إيصال مكرر داخل الدفعة', message, items, {
          receiptNo: batchDup.row.receiptNo,
          row: rowProgressLabel(batchDup.row),
        });
        return;
      }
      const postedDup = findReceiptConflictWithPosted(rowsToPost, currentRows);
      if (postedDup) {
        const message = describeReceiptConflict(currentRows, postedDup.row, postedDup.other);
        const items = progressItems.map((item) =>
          item.key === String(postedDup.row.id) ? { ...item, status: 'error' as const, message } : item,
        );
        failBatch('فشل التحقق — إيصال محفوظ مسبقاً', message, items, {
          receiptNo: postedDup.row.receiptNo,
          row: rowProgressLabel(postedDup.row),
          postedRow: rowProgressLabel(postedDup.other),
        });
        return;
      }
      const unpostedDup = findReceiptConflictWithUnposted(rowsToPost, currentRows);
      if (unpostedDup) {
        const message = describeReceiptConflict(currentRows, unpostedDup.row, unpostedDup.other);
        const items = progressItems.map((item) =>
          item.key === String(unpostedDup.row.id) ? { ...item, status: 'error' as const, message } : item,
        );
        failBatch('فشل التحقق — إيصال مكرر', message, items, {
          receiptNo: unpostedDup.row.receiptNo,
          row: rowProgressLabel(unpostedDup.row),
        });
        return;
      }

      const rowsMissingDriver = rowsToPost.filter((row) => {
        const fleet = resolveFleetForLedgerRow(row, trip, drivers, vehicles);
        return !fleet.driverId;
      });
      if (rowsMissingDriver.length) {
        const message =
          'يرجى اختيار السائق (من أعلى الدفتر) أو التأكد أن السطر مرتبط بسائق — مطلوب لحفظ الشحنات الجديدة.';
        const items = progressItems.map((item) =>
          rowsMissingDriver.some((row) => String(row.id) === item.key)
            ? { ...item, status: 'error' as const, message: 'السائق مطلوب' }
            : item,
        );
        failBatch('فشل التحقق — السائق مطلوب', message, items, {
          missingDriverCount: rowsMissingDriver.length,
        });
        return;
      }

      setSaveProgress((prev) => ({
        ...prev,
        phase: 'upserting',
        phaseLabel: resumeMode
          ? `استكمال الحفظ في الدفتر (0 / ${rowsToPost.length})...`
          : `حفظ الأسطر في الدفتر (0 / ${rowsToPost.length})...`,
      }));

      let workingRows = [...currentRows];
      const upsertedRowIds: string[] = [];
      const savedDbIdByDisplayId = new Map<number, string>();
      let progressSnapshot = progressItems;
      for (let index = 0; index < rowsToPost.length; index += 1) {
        const row = rowsToPost[index];
        const itemKey = String(row.id);

        if (row.dbId) {
          upsertedRowIds.push(row.dbId);
          savedDbIdByDisplayId.set(row.id, row.dbId);
          progressSnapshot = progressSnapshot.map((item) =>
            item.key === itemKey
              ? { ...item, status: 'saved' as const, message: 'محفوظ مسبقاً — استكمال الترحيل' }
              : item,
          );
          setSaveProgress((prev) => ({
            ...applySaveProgressItemPatch(prev, itemKey, {
              status: 'saved',
              message: 'محفوظ مسبقاً — استكمال الترحيل',
            }),
            phaseLabel: resumeMode
              ? `استكمال الحفظ في الدفتر (${index + 1} / ${rowsToPost.length})...`
              : `حفظ الأسطر في الدفتر (${index + 1} / ${rowsToPost.length})...`,
          }));
          continue;
        }

        patchSaveItem(itemKey, { status: 'running', message: 'جاري الحفظ...' });
        setSaveProgress((prev) => ({
          ...prev,
          phaseLabel: resumeMode
            ? `استكمال الحفظ في الدفتر (${index + 1} / ${rowsToPost.length})...`
            : `حفظ الأسطر في الدفتر (${index + 1} / ${rowsToPost.length})...`,
        }));

        const fleet = resolveFleetForLedgerRow(row, trip, drivers, vehicles);
        const effectiveDriverId = row.sessionDriverId ?? trip.driverId;
        const rowNo =
          row.serverRowNo ?? nextServerRowNoForDriver(workingRows, effectiveDriverId) ?? row.id;
        try {
          const saved = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
            branchId: activeBranchId,
            ledgerDate: trip.date,
            lineLabel: trip.line,
            originLabel: origin,
            tripNo: trip.tripNo || null,
            ...(row.dbId ? { rowId: row.dbId } : {}),
            ...fleet,
            rowNo,
            receiptNo: row.receiptNo || null,
            destination: row.destination,
            parcelType: row.parcelType,
            parcelCount: Number(row.parcelCount) || null,
            weightKg: parseWeightKg(row.weightKg) ?? null,
            senderName: row.sender,
            receiverName: row.receiver,
            collectAmountUsd: parseUsd(row.collectAmount),
            prepaidAmountUsd: parseUsd(row.prepaidAmount),
            hawalaAmountUsd: parseUsd(row.receiverCollect),
            feesAmountUsd: 0,
            transferServiceFeeUsd: parseUsd(row.transferServiceFee),
            notes: row.notes || null,
          });
          upsertedRowIds.push(saved.id);
          savedDbIdByDisplayId.set(row.id, saved.id);
          patchSaveItem(itemKey, { status: 'saved', message: `حُفظ — dbId=${saved.id.slice(0, 8)}` });
          quickLedgerLog.log('success', 'upsert', 'تم حفظ السطر في الدفتر', {
            ...logRowContext(row),
            details: { rowId: saved.id, rowNo: saved.row_no },
          });
          workingRows = workingRows.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  dbId: saved.id,
                  serverRowNo: saved.row_no,
                  sessionDriverId: saved.driver_id
                    ? syntheticEntityId(saved.driver_id)
                    : trip.driverId || r.sessionDriverId,
                }
              : r,
          );
          setRows(workingRows);
          clearFailedSaveRow(row.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر حفظ السطر';
          progressSnapshot = progressSnapshot.map((item) =>
            item.key === itemKey ? { ...item, status: 'error' as const, message } : item,
          );
          patchSaveItem(itemKey, { status: 'error', message });
          quickLedgerLog.log('error', 'upsert', message, logRowContext(row));
          setRows(workingRows);
          failBatch(`توقف الحفظ عند السطر ${rowProgressLabel(row)}`, message, progressSnapshot, {
            receiptNo: row.receiptNo,
            row: rowProgressLabel(row),
          });
          return;
        }
      }

      setSaveProgress((prev) => ({
        ...prev,
        phase: 'posting',
        phaseLabel: resumeMode ? 'استكمال ترحيل الشحنات المتبقية...' : 'ترحيل الشحنات وربطها بالوكلاء...',
      }));
      quickLedgerLog.log('info', 'post', `بدء ترحيل ${upsertedRowIds.length} سطر`);

      const result = await httpClient.post<{
        posted: Array<{ rowId: string; rowNo: number; shipmentId: string; shipmentNo: string; agentId: string | null }>;
        skipped: Array<{ rowId: string; rowNo: number; reason: string }>;
        errors: Array<{ rowId: string; rowNo: number; message: string }>;
      }>('/daily-ledger/rows/post-shipments', {
        branchId: activeBranchId,
        ledgerDate: trip.date,
        lineLabel: trip.line,
        rowIds: upsertedRowIds,
      });

      const postedByRowId = new Map(result.posted.map((item) => [item.rowId, item]));
      const skippedByRowId = new Map(result.skipped.map((item) => [item.rowId, item]));
      const errorsByRowId = new Map(result.errors.map((item) => [item.rowId, item]));

      for (const row of rowsToPost) {
        const dbId = savedDbIdByDisplayId.get(row.id) ?? row.dbId;
        if (!dbId) continue;
        const itemKey = String(row.id);
        if (errorsByRowId.has(dbId)) {
          const err = errorsByRowId.get(dbId)!;
          patchSaveItem(itemKey, { status: 'error', message: err.message });
          quickLedgerLog.log('error', 'post', err.message, {
            ...logRowContext(row),
            details: { rowNo: err.rowNo },
          });
        } else if (postedByRowId.has(dbId)) {
          const posted = postedByRowId.get(dbId)!;
          patchSaveItem(itemKey, {
            status: 'posted',
            message: `شحنة ${posted.shipmentNo}`,
          });
          quickLedgerLog.log('success', 'post', `تم ترحيل الشحنة ${posted.shipmentNo}`, logRowContext(row));
        } else if (skippedByRowId.has(dbId)) {
          const skipped = skippedByRowId.get(dbId)!;
          patchSaveItem(itemKey, { status: 'skipped', message: skipped.reason });
          quickLedgerLog.log('warn', 'post', skipped.reason, logRowContext(row));
        }
      }

      setRows((prev) =>
        prev.map((row) => {
          const dbId = savedDbIdByDisplayId.get(row.id) ?? row.dbId;
          const posted = dbId ? postedByRowId.get(dbId) : undefined;
          if (!posted) return row;
          return {
            ...row,
            dbId: posted.rowId,
            postedShipmentId: posted.shipmentId,
            agentId: posted.agentId ? syntheticEntityId(posted.agentId) : row.agentId,
          };
        }),
      );

      setFailedSaveRows((prev) => {
        const next = { ...prev };
        for (const row of rowsToPost) {
          const dbId = savedDbIdByDisplayId.get(row.id) ?? row.dbId;
          if (!dbId) continue;
          if (postedByRowId.has(dbId)) {
            delete next[row.id];
          } else if (errorsByRowId.has(dbId)) {
            next[row.id] = errorsByRowId.get(dbId)!.message;
          }
        }
        persistFailedSaveRows(trip.date, trip.line, next);
        return next;
      });

      const summaryParts: string[] = [];
      if (result.posted.length) summaryParts.push(`مُرحَّل: ${result.posted.length}`);
      if (result.errors.length) summaryParts.push(`أخطاء: ${result.errors.length}`);
      if (result.skipped.length) summaryParts.push(`تُخطّى: ${result.skipped.length}`);
      if (resumeMode && alreadyPostedCount > 0) {
        summaryParts.unshift(`مُرحَّل سابقاً: ${alreadyPostedCount}`);
      }
      const summary = summaryParts.join(' — ') || 'لا توجد أسطر صالحة للترحيل';

      const outcome =
        result.errors.length > 0
          ? result.posted.length > 0
            ? 'partial'
            : 'failed'
          : 'success';
      quickLedgerLog.endBatch(outcome, summary, {
        posted: result.posted.length,
        errors: result.errors.length,
        skipped: result.skipped.length,
        alreadyPostedCount,
        resumeMode,
      });

      setSaveProgress((prev) => ({
        ...prev,
        phase: result.errors.length && !result.posted.length ? 'failed' : 'done',
        phaseLabel:
          result.errors.length && !result.posted.length
            ? 'اكتمل مع أخطاء — أصلح الأسطر الحمراء ثم «استكمال الحفظ»'
            : resumeMode
              ? 'اكتمل استكمال الحفظ'
              : 'اكتمل الحفظ',
        summary,
        finishedAt: new Date().toISOString(),
        completedCount: prev.items.filter((item) =>
          ['saved', 'posted', 'skipped', 'error'].includes(item.status),
        ).length,
      }));

      if (result.posted.length) {
        showToast(
          resumeMode
            ? `تم استكمال ترحيل ${result.posted.length} شحنة — لم يُعاد حفظ المُرحَّل سابقاً`
            : `تم حفظ ${result.posted.length} شحنة وربطها بالوكيل بنجاح`,
          'success',
        );
      }
      if (result.errors.length) {
        showToast(
          result.errors.map((item) => `السطر ${item.rowNo}: ${item.message}`).join(' | '),
          'error',
        );
      } else if (!result.posted.length) {
        showToast(
          'لا توجد أسطر صالحة للترحيل. تأكد من اكتمال البيانات وأن «الجهة» تطابق محافظة وكيل واحد نشط.',
          'info',
        );
      }
      if (result.skipped.length && !result.posted.length && !result.errors.length) {
        showToast(
          result.skipped.map((item) => `السطر ${item.rowNo}: ${item.reason}`).join(' | '),
          'info',
        );
      }

      await loadRemoteRows();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر حفظ الشحنات';
      quickLedgerLog.log('error', 'batch', message);
      quickLedgerLog.endBatch('failed', message);
      setSaveProgress((prev) => ({
        ...prev,
        phase: 'failed',
        phaseLabel: 'فشل الحفظ',
        summary: message,
        finishedAt: new Date().toISOString(),
      }));
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quick-ledger-page" dir="rtl">
      <button
        type="button"
        className="quick-ledger-help-btn"
        onClick={openAgentHelp}
        title="اختصارات الوكلاء — ارقام الجهة"
        aria-label="اختصارات الوكلاء"
      >
        <HelpCircle size={22} />
      </button>
      <section className="quick-ledger-toolbar">
        <div>
          <div className="quick-ledger-eyebrow">إدخال سريع للشحنات</div>
          <h2>دفتر الشحن اليومي</h2>
          <p className="quick-ledger-hint">
            اختر <strong>الخط</strong> لعرض الشحنات المحفوظة فوراً (بدون أسطر فارغة في القائمة). للإدخال الجديد يظهر سطر واحد في الأسفل.
            «الجهة» = رقم الاختصار (<strong>؟</strong>) أو اسم المحافظة — مثل <strong>9</strong> للرقة.
          </p>
        </div>
        <div className="quick-ledger-actions">
          <div className="quick-ledger-search">
            <Search size={16} />
            <input
              list="ledger-branch-list"
              placeholder="بحث الفرع"
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              disabled={isBranchLocked}
              onKeyDown={(e) => {
                if (isBranchLocked) return;
                if (e.key !== 'Enter') return;
                const needle = normalizeName(branchSearch);
                if (!needle) return;
                const found =
                  branchChoices.find((b) => normalizeName(b.name) === needle) ??
                  branchChoices.find((b) => normalizeName(b.name).includes(needle));
                const backendId = found ? getBackendIdFromSynthetic(found.id) : undefined;
                if (backendId) void setActiveBranch(backendId);
              }}
              onBlur={() => {
                if (isBranchLocked) return;
                const needle = normalizeName(branchSearch);
                if (!needle) return;
                const found =
                  branchChoices.find((b) => normalizeName(b.name) === needle) ??
                  branchChoices.find((b) => normalizeName(b.name).includes(needle));
                const backendId = found ? getBackendIdFromSynthetic(found.id) : undefined;
                if (backendId) void setActiveBranch(backendId);
              }}
            />
          </div>
          <datalist id="ledger-branch-list">
            {branchChoices.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
          <div className="quick-ledger-search">
            <Search size={16} />
            <input placeholder="بحث سريع داخل الدفتر" value={searchQuick} onChange={(e) => setSearchQuick(e.target.value)} />
          </div>
          <button type="button" onClick={addRows}>
            <Plus size={16} />
            إضافة سطر
          </button>
          <button type="button" onClick={() => void loadRemoteRows()} disabled={remoteLoading}>
            {remoteLoading
              ? remoteSyncedCount > 0
                ? `مزامنة ${remoteSyncedCount}...`
                : 'جاري التحديث...'
              : 'تحديث'}
          </button>
          <label className="quick-ledger-print-toggle">
            <input type="checkbox" checked={includeLoaded} onChange={(e) => setIncludeLoaded(e.target.checked)} />
            إظهار المحمّلة
          </label>
          <button type="button" onClick={openPrintDialog}>
            <Printer size={16} />
            طباعة
          </button>
          {transferMode ? (
            <>
              <button type="button" onClick={exitTransferMode} disabled={transferring}>
                إلغاء النقل
              </button>
              <button
                type="button"
                className="primary"
                disabled={transferring || !selectedTransferRowIds.length}
                onClick={() => void openTransferDialog()}
              >
                <Truck size={16} />
                {`تأكيد نقل إرسالية (${selectedTransferRowIds.length})`}
              </button>
            </>
          ) : deleteMode ? (
            <>
              <button type="button" onClick={exitDeleteMode} disabled={deletingRows}>
                إلغاء التحديد
              </button>
              <button
                type="button"
                className="danger"
                disabled={deletingRows || !selectedDeleteRowIds.length}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 size={16} />
                {deletingRows ? 'جاري الحذف...' : `حذف المحدد (${selectedDeleteRowIds.length})`}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={enterTransferMode}>
                <Truck size={16} />
                نقل إرسالية
              </button>
              <button type="button" className="danger" onClick={() => setDeleteMode(true)}>
                <Trash2 size={16} />
                حذف أسطر
              </button>
            </>
          )}
          <button type="button" onClick={() => setCloseConfirmOpen(true)}>
            إغلاق القسم
          </button>
          <button type="button" onClick={() => quickLedgerLog.download()} title="تنزيل سجل عمليات دفتر الشحن">
            <ScrollText size={16} />
            سجل الحفظ
          </button>
          <button type="button" className="primary" onClick={() => void saveRows()} disabled={saving || loadingRefs}>
            <Save size={16} />
            {saving
              ? 'جاري الحفظ...'
              : stats.saved > 0 && stats.complete > 0
                ? `استكمال الحفظ (${stats.complete})`
                : 'حفظ الشحنات'}
          </button>
        </div>
      </section>

      <section className="quick-ledger-trip">
        <label>
          <span>الخط</span>
          <select value={trip.line} onChange={(e) => handleTripLineChange(e.target.value)}>
            <option value="">اختر الخط / المصدر</option>
            {lineOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>رقم الرحلة</span>
          <input value={trip.tripNo} onChange={(e) => setTrip({ ...trip, tripNo: e.target.value })} />
        </label>
        <label>
          <span>التاريخ</span>
          <input
            type="date"
            value={trip.date}
            max={todayIso}
            min={canPickHistoricalDate ? undefined : todayIso}
            onChange={(e) => {
              const next = e.target.value;
              if (!canPickHistoricalDate && next !== todayIso) {
                showToast('لا يمكن تغيير التاريخ — يلزم صلاحية تعديل تاريخ الدفتر', 'info');
                setTrip((prev) => ({ ...prev, date: todayIso }));
                return;
              }
              if (next > todayIso) {
                showToast('لا يمكن اختيار تاريخ مستقبلي', 'error');
                return;
              }
              setTrip((prev) => ({ ...prev, date: next }));
            }}
          />
        </label>
        <label>
          <span>المركبة</span>
          <select value={trip.vehicleId || ''} onChange={(e) => handleVehicleSelect(Number(e.target.value))}>
            <option value="">اختر المركبة...</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}{vehicle.model ? ` — ${vehicle.model}` : ''}{vehicle.type ? ` (${vehicle.type})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>السائق</span>
          <select value={trip.driverId || ''} onChange={(e) => handleDriverSelect(Number(e.target.value))}>
            <option value="">اختر السائق...</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.code ? `${driver.code} — ` : ''}{driver.name}
              </option>
            ))}
          </select>
        </label>
        {canPickHistoricalDate && (
          <p className="quick-ledger-trip-hint">يمكن للمدير اختيار تواريخ سابقة لإدخال بيانات متأخرة.</p>
        )}
      </section>

      <section className="quick-ledger-stats">
        <div><strong>{stats.started}</strong><span>أسطر مستخدمة</span></div>
        <div><strong>{stats.complete}</strong><span>جاهزة للترحيل</span></div>
        <div><strong>{stats.missing}</strong><span>ناقصة (إيصال+جهة+مرسل+مستلم)</span></div>
        <div><strong>{stats.saved}</strong><span>محفوظة</span></div>
        <div><strong>{stats.totalCollect.toLocaleString()}</strong><span>إجمالي الدولار</span></div>
        <div><strong>{formatWeightKgTons(stats.totalWeightKg)}</strong><span>إجمالي الوزن</span></div>
        {duplicateReceiptRowIds.size > 0 && (
          <div className="quick-ledger-stat-warn">
            <strong>{duplicateReceiptRowIds.size}</strong>
            <span>إيصال مكرر — عدّل أو احذف الأسطر المظللة</span>
          </div>
        )}
        {Object.keys(failedSaveRows).length > 0 && (
          <div className="quick-ledger-stat-warn">
            <strong>{Object.keys(failedSaveRows).length}</strong>
            <span>أسطر بها خطأ في الحفظ — ظل أحمر وامض، أصلحها ثم «استكمال الحفظ»</span>
          </div>
        )}
      </section>

      {transferMode && (
        <section className="quick-ledger-transfer-bar" dir="rtl">
          <div className="quick-ledger-transfer-bar-totals">
            <span><strong>{transferSelectionSummary.rows}</strong> سطر محدد</span>
            <span><strong>{transferSelectionSummary.pieces}</strong> طرد</span>
            <span>الوزن: <strong>{formatWeightKgTons(transferSelectionSummary.weightKg)}</strong></span>
            <span>أجرة الشحن: <strong>{transferSelectionSummary.freight.toLocaleString()}</strong></span>
            <span>التحصيل: <strong>{transferSelectionSummary.collect.toLocaleString()}</strong></span>
            <span>المدفوع مسبقاً: <strong>{transferSelectionSummary.prepaid.toLocaleString()}</strong></span>
            {transferSelectionSummary.destinations.length > 0 && (
              <span>الوجهات: <strong>{transferSelectionSummary.destinations.join('، ')}</strong></span>
            )}
          </div>
          <p className="quick-ledger-hint">
            حدّد الأسطر المراد نقلها إلى سائق/مركبة/تاريخ آخر. الأسطر المحمّلة على بيان غير قابلة للنقل.
          </p>
        </section>
      )}

      <section className="quick-ledger-table-shell">
        <table className="quick-ledger-table">
          <thead>
            <tr>
              {(deleteMode || transferMode) && (
                <th className="quick-ledger-select-col">
                  {deleteMode ? (
                    <input
                      type="checkbox"
                      aria-label="تحديد كل الأسطر القابلة للحذف"
                      checked={
                        deletableVisibleRows.length > 0 &&
                        selectedDeleteRowIds.length === deletableVisibleRows.length
                      }
                      onChange={toggleSelectAllDeletable}
                      disabled={!deletableVisibleRows.length}
                    />
                  ) : (
                    <input
                      type="checkbox"
                      aria-label="تحديد كل الأسطر القابلة للنقل"
                      checked={
                        transferableVisibleRows.length > 0 &&
                        selectedTransferRowIds.length === transferableVisibleRows.length
                      }
                      onChange={toggleSelectAllTransferable}
                      disabled={!transferableVisibleRows.length}
                    />
                  )}
                </th>
              )}
              <th>رقم الإيصال</th>
              <th>الجهة</th>
              <th className="col-parcel-type">نوع الطرود</th>
              <th className="col-parcel-count">عدد الطرود</th>
              <th>الوزن كغ</th>
              <th className="wide">المرسل</th>
              <th className="wide">المرسل إليه</th>
              <th title="يُملأ تلقائياً من تعريف الأسعار (مسار + نوع الطرد + وزن)؛ يمكنك التعديل يدوياً">تحصيل $</th>
              <th>دفع مسبق $</th>
              <th>حوالة</th>
              <th>أجرة الحوالة</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const started = isRowStarted(row);
              const locked = Boolean(row.loadedAt);
              const posted = Boolean(row.postedShipmentId);
              const deletable = isRowDeletable(row);
              const goodsTypeItems = goodsTypes.map((g) => ({ id: g.id, name: g.name }));
              const rowIssue = failedSaveRows[row.id]
                ?? (duplicateReceiptRowIds.has(row.id) ? 'رقم الإيصال مكرر' : undefined);
              const rowClassName = [
                locked ? 'saved' : posted ? 'started' : activeRowId === row.id ? 'active' : started ? 'started' : '',
                issueRowIds.has(row.id) ? 'ledger-row-error' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={row.id} className={rowClassName} title={rowIssue}>
                  {deleteMode && (
                    <td className="quick-ledger-select-col">
                      <input
                        type="checkbox"
                        aria-label={`تحديد سطر ${row.receiptNo || row.id}`}
                        checked={selectedDeleteRowIds.includes(row.id)}
                        disabled={!deletable}
                        title={deletable ? 'تحديد للحذف' : 'لا يمكن حذف سطر محمّل على بيان'}
                        onChange={() => toggleDeleteRowSelection(row.id)}
                      />
                    </td>
                  )}
                  {transferMode && (
                    <td className="quick-ledger-select-col">
                      <input
                        type="checkbox"
                        aria-label={`تحديد سطر ${row.receiptNo || row.id} للنقل`}
                        checked={selectedTransferRowIds.includes(row.id)}
                        disabled={!row.dbId || Boolean(row.loadedAt)}
                        title={
                          row.loadedAt
                            ? 'لا يمكن نقل سطر محمّل على بيان'
                            : !row.dbId
                              ? 'احفظ السطر أولاً قبل النقل'
                              : 'تحديد للنقل'
                        }
                        onChange={() => toggleTransferRowSelection(row.id)}
                      />
                    </td>
                  )}
                  <td><input className={duplicateReceiptRowIds.has(row.id) ? 'ledger-receipt-duplicate' : undefined} data-ledger-field="true" value={row.receiptNo} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'receiptNo', e.target.value)} title={rowIssue ?? (duplicateReceiptRowIds.has(row.id) ? 'رقم الإيصال مكرر' : undefined)} /></td>
                  <td className="quick-ledger-dest-cell">
                    <input
                      list="ledger-destination-options"
                      data-ledger-field="true"
                      value={row.destination}
                      disabled={locked}
                      placeholder="جهة أو كود (مدينة / فرع / وكيل)"
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={(e) => handleSmartFieldKeyDown(e, row, 'destination')}
                      onBlur={(e) => commitDestinationCell(row, e.target.value)}
                      onChange={(e) => updateRow(row.id, 'destination', e.target.value, true)}
                    />
                  </td>
                  <td className="quick-ledger-parcel-cell col-parcel-type">
                    <AutocompleteInput
                      value={row.parcelType}
                      onChange={(v) => updateRow(row.id, 'parcelType', v, true)}
                      onSelect={(item) => {
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? mergeRowWithAutoTariff(
                                  { ...r, parcelType: item.name, collectManual: false },
                                  tariffs,
                                  cities,
                                  branches,
                                  goodsTypes,
                                  trip.date,
                                )
                              : r,
                          ),
                        );
                        flushRowSave(row.id);
                      }}
                      onAddNew={(name) => {
                        void (async () => {
                          const normalized = normalizeName(name);
                          try {
                            const created = await phase15Gateway.goodsTypes.create({
                              code: `GT-${Date.now()}`,
                              name: normalized,
                              description: '',
                            });
                            setGoodsTypes((prevGoods) => {
                              const nextGoods = [...prevGoods, created];
                              setRows((prevRows) =>
                                prevRows.map((rr) =>
                                  rr.id === row.id
                                    ? mergeRowWithAutoTariff(
                                        { ...rr, parcelType: normalized, collectManual: false },
                                        tariffs,
                                        cities,
                                        branches,
                                        nextGoods,
                                        trip.date,
                                      )
                                    : rr,
                                ),
                              );
                              return nextGoods;
                            });
                            flushRowSave(row.id);
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : 'تعذر إضافة نوع الطرد', 'error');
                          }
                        })();
                      }}
                      items={goodsTypeItems}
                      placeholder="حرف أو اثنان…"
                      id={`ledger-pt-${row.id}`}
                      nextFieldId={`ledger-pc-${row.id}`}
                      disabled={locked}
                      wrapperClassName="quick-ledger-parcel-wrap"
                      dataLedgerField
                      onBlurInput={() => {
                        setRows((prev) =>
                          prev.map((r) => {
                            if (r.id !== row.id) return r;
                            const matched = goodsTypes.find((x) => normalizeName(x.name) === normalizeName(r.parcelType));
                            if (!matched) return r;
                            return mergeRowWithAutoTariff(
                              { ...r, parcelType: matched.name, collectManual: false },
                              tariffs,
                              cities,
                              branches,
                              goodsTypes,
                              trip.date,
                            );
                          }),
                        );
                        flushRowSave(row.id);
                      }}
                    />
                  </td>
                  <td className="col-parcel-count">
                    <input
                      id={`ledger-pc-${row.id}`}
                      data-ledger-field="true"
                      inputMode="numeric"
                      value={row.parcelCount}
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onChange={(e) => updateRow(row.id, 'parcelCount', e.target.value)}
                      onBlur={() => flushRowSave(row.id)}
                    />
                  </td>
                  <td>
                    <input
                      data-ledger-field="true"
                      inputMode="decimal"
                      value={row.weightKg}
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onBlur={() => recalcTariffCollectForRowId(row.id)}
                      onChange={(e) => updateRow(row.id, 'weightKg', e.target.value, true)}
                    />
                  </td>
                  <td>
                    <SmartPartyInput
                      data-ledger-field="true"
                      value={row.sender}
                      onChange={(v) => updateRow(row.id, 'sender', v)}
                      onSelect={(party) => {
                        updateRow(row.id, 'sender', party.name);
                      }}
                      onAddNew={(name) => updateRow(row.id, 'sender', name)}
                      placeholder="المرسل"
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                    />
                  </td>
                  <td>
                    <SmartPartyInput
                      data-ledger-field="true"
                      value={row.receiver}
                      onChange={(v) => updateRow(row.id, 'receiver', v)}
                      onAddNew={(name) => updateRow(row.id, 'receiver', name)}
                      placeholder="المرسل إليه"
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                    />
                  </td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.collectAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'collectAmount', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.prepaidAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'prepaidAmount', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.receiverCollect} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'receiverCollect', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.transferServiceFee} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'transferServiceFee', e.target.value)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="ledger-destination-options">
          {destinationOptions.map((item) => <option key={item} value={item} />)}
        </datalist>
      </section>

      <section className="quick-ledger-signatures">
        <span>اسم المستلم</span>
        <span>اسم السائق المستلم لدى الفرع المصدر</span>
        <span>رقم السيارة</span>
        <span>التاريخ</span>
        <span>التوقيع</span>
      </section>

      <QuickLedgerSaveProgressDialog
        progress={saveProgress}
        busy={saving}
        onClose={() => setSaveProgress(createInitialSaveProgress())}
        onDownloadLog={() => quickLedgerLog.download()}
      />
      <QuickLedgerAgentHelpDialog
        open={agentHelpOpen}
        loading={agentHelpLoading}
        entries={agentQuickCodeEntries}
        onClose={() => setAgentHelpOpen(false)}
      />

      {deleteConfirmOpen && (
        <div className="quick-ledger-confirm" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel">
            <h3>حذف الأسطر المحددة؟</h3>
            <p>
              سيتم حذف {selectedDeleteRowIds.length} سطر من الدفتر. الأسطر المحمّلة على بيان لا تُحذف.
              {rows.some((row) => selectedDeleteRowIds.includes(row.id) && row.postedShipmentId)
                ? ' بعض الأسطر المحددة مرتبطة بشحنات — سيُحذف سطر الدفتر فقط.'
                : ''}
            </p>
            <div>
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={deletingRows}>
                إلغاء
              </button>
              <button type="button" className="danger" onClick={() => void deleteSelectedRows()} disabled={deletingRows}>
                {deletingRows ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {printDialogOpen && (
        <div className="quick-ledger-confirm" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel">
            <h3>طباعة</h3>
            <p>
              اختر نوع الطباعة ثم حدّد السائق والفترة.
              {searchQuick.trim() ? (
                <>
                  {' '}
                  البحث النشط: <strong>{searchQuick.trim()}</strong> — تُطبع الأسطر المطابقة فقط (مثل الجهة الرقة).
                </>
              ) : (
                ' كل أسطر السائق في الفترة.'
              )}
            </p>
            <div className="quick-ledger-print-form space-y-3 mb-3">
              <label className="form-group block">
                <span className="form-label">السائق *</span>
                <select
                  className="form-select w-full"
                  value={printDriverId || ''}
                  onChange={(e) => setPrintDriverId(Number(e.target.value))}
                >
                  <option value="">— اختر السائق —</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.code ? `${driver.code} — ` : ''}{driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="form-group block">
                  <span className="form-label">من تاريخ</span>
                  <input
                    className="form-input w-full"
                    type="date"
                    value={printDateFrom}
                    onChange={(e) => setPrintDateFrom(e.target.value)}
                  />
                </label>
                <label className="form-group block">
                  <span className="form-label">إلى تاريخ</span>
                  <input
                    className="form-input w-full"
                    type="date"
                    value={printDateTo}
                    onChange={(e) => setPrintDateTo(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="quick-ledger-print-actions">
              <button type="button" onClick={() => setPrintDialogOpen(false)} disabled={printLoading}>
                إلغاء
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void executeShipmentsPrint()}
                disabled={printLoading}
              >
                {printLoading ? 'جاري التحضير...' : 'طباعة شحنات'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void executeReceiptsPrint()}
                disabled={printLoading}
              >
                {printLoading ? 'جاري التحضير...' : 'طباعة إيصالات'}
              </button>
            </div>
          </div>
        </div>
      )}

      {closeConfirmOpen && (
        <div className="quick-ledger-confirm" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel">
            <h3>إغلاق دفتر الإدخال؟</h3>
            <p>
              يوجد {stats.started} أسطر تم إدخال بيانات فيها. الإغلاق الآن سيعيدك إلى قائمة الشحنات. الأسطر المحفوظة ستبقى محفوظة، والأسطر غير المحفوظة ستبقى فقط على الشاشة الحالية.
            </p>
            <div>
              <button type="button" onClick={() => setCloseConfirmOpen(false)}>متابعة الإدخال</button>
              <button type="button" className="danger" onClick={closeSection}>إغلاق القسم</button>
            </div>
          </div>
        </div>
      )}

      {transferDialogOpen && (
        <div className="quick-ledger-confirm" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel" dir="rtl">
            <h3>نقل إرسالية</h3>
            {transferValidation.loading ? (
              <p>جاري التحقق من الأسطر المحددة...</p>
            ) : (
              <>
                {transferValidation.summary && (
                  <div className="quick-ledger-transfer-summary">
                    <div>الأسطر: <strong>{transferValidation.summary.rowsCount}</strong></div>
                    <div>الطرود: <strong>{transferValidation.summary.piecesCount}</strong></div>
                    <div>الوزن: <strong>{formatWeightKgTons(transferValidation.summary.weightKg)}</strong></div>
                    <div>أجرة الشحن: <strong>{transferValidation.summary.freightTotal.toLocaleString()}</strong></div>
                    <div>التحصيل: <strong>{transferValidation.summary.collectionTotal.toLocaleString()}</strong></div>
                    <div>المدفوع مسبقاً: <strong>{transferValidation.summary.prepaidTotal.toLocaleString()}</strong></div>
                    {transferValidation.summary.destinations.length > 0 && (
                      <div>الوجهات: <strong>{transferValidation.summary.destinations.join('، ')}</strong></div>
                    )}
                  </div>
                )}

                {transferValidation.errors.length > 0 && (
                  <ul className="quick-ledger-transfer-errors">
                    {transferValidation.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                )}
                {transferValidation.warnings.length > 0 && (
                  <ul className="quick-ledger-transfer-warnings">
                    {transferValidation.warnings.map((warn, idx) => (
                      <li key={idx}>{warn}</li>
                    ))}
                  </ul>
                )}

                <p className="quick-ledger-hint">
                  لن يتم إنشاء أثر مالي جديد للأسطر المرحّلة مسبقاً. سيتم نقلها تشغيلياً فقط (تغيير السائق/المركبة/التاريخ).
                </p>

                <div className="quick-ledger-print-form space-y-3 mb-3">
                  <label className="form-group block">
                    <span className="form-label">التاريخ</span>
                    <input
                      className="form-input w-full"
                      type="date"
                      value={transferDate}
                      max={todayIso}
                      min={canPickHistoricalDate ? undefined : todayIso}
                      onChange={(e) => setTransferDate(e.target.value)}
                    />
                  </label>
                  <label className="form-group block">
                    <span className="form-label">السائق</span>
                    <select
                      className="form-select w-full"
                      value={transferDriverId || ''}
                      onChange={(e) => setTransferDriverId(Number(e.target.value))}
                    >
                      <option value="">— اختر السائق —</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.code ? `${driver.code} — ` : ''}{driver.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-group block">
                    <span className="form-label">المركبة</span>
                    <select
                      className="form-select w-full"
                      value={transferVehicleId || ''}
                      onChange={(e) => setTransferVehicleId(Number(e.target.value))}
                    >
                      <option value="">— اختر المركبة —</option>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plateNumber}{vehicle.model ? ` — ${vehicle.model}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-group block">
                    <span className="form-label">سبب النقل *</span>
                    <input
                      className="form-input w-full"
                      value={transferReason}
                      placeholder="مثال: توزيع الحمولة على سيارة ثانية"
                      onChange={(e) => setTransferReason(e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}

            <div className="quick-ledger-print-actions">
              <button type="button" onClick={() => setTransferDialogOpen(false)} disabled={transferring}>
                إلغاء
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void confirmTransfer()}
                disabled={
                  transferring ||
                  transferValidation.loading ||
                  transferValidation.errors.length > 0 ||
                  !transferReason.trim() ||
                  (!transferDriverId && !transferVehicleId)
                }
              >
                {transferring ? 'جاري النقل...' : 'تأكيد النقل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
