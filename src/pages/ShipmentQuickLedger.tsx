import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  FileText,
  HelpCircle,
  Plus,
  Printer,
  Save,
  ScrollText,
  Search,
  Trash2,
  Truck,
  X,
  ChevronDown,
} from 'lucide-react';
import {
  buildMahmoudPreprintedReceiptHtml,
  mapRemoteLedgerRowToMahmoudReceipt,
} from '../lib/shipping/mahmoudPreprintedReceiptPrint';
import {
  buildQuickLedgerPrintHtml,
  remoteRowToPrint,
  type QuickLedgerPrintRow,
} from '../lib/shipping/quickLedgerShipmentPrint';
import { exportLedgerStylePdf, printHtmlInBrowser } from '../lib/export/ledgerStylePrint';
import { preparePrintHtmlForOutput, resolveCompanyLogoDataUrlForPrint } from '../lib/branding/companyLogoPrint';
import { useToast } from '../components/Toast';
import { getBackendIdFromSynthetic, phase15Gateway, syntheticEntityId } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import {
  addDailyLedgerSyncAudit,
  countPendingDailyLedgerDrafts,
  isDailyLedgerOfflineStoreAvailable,
  listDailyLedgerDrafts,
  markDailyLedgerDraftPending,
  markDailyLedgerDraftSynced,
  putDailyLedgerDraft,
  type DailyLedgerDraftContext,
  type DailyLedgerDraftRecord,
} from '../lib/offline/dailyLedgerOfflineStore';
import { createOfflineId } from '../lib/offline/indexedDb';
import { useCloudConnectionStatus } from '../lib/offline/useCloudConnectionStatus';
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
import QuickLedgerPrintHub, {
  type QuickLedgerPrintHubHandle,
  type QuickLedgerPrintHubMeta,
} from '../components/shipping/QuickLedgerPrintHub';
import {
  buildQuickCodesFromAgents,
  resolveGovernorateFromQuickCode,
} from '../lib/agents/agentQuickCodes';
import {
  buildLedgerRowsQueryScope,
  fetchAllDailyLedgerRows,
  resolveLedgerBranchId,
} from '../lib/shipping/dailyLedgerScope';
import {
  filterPrintableDailyLedgerRows,
  dedupeDailyLedgerRowsById,
  remoteCollectAmountLabel,
  remoteRowCollectionUsd,
  compareDailyLedgerRowsChronological,
  sortDailyLedgerRows,
} from '../lib/shipping/dailyLedgerPrintable';
import { computeTotalsFromRemoteRows, formatUsdAmount } from '../lib/shipping/dailyLedgerTotals';
import {
  resolveDocumentationLedgerDates,
  sortRemoteRowsChronological,
} from '../lib/shipping/dailyLedgerRowFilter';
import type { DailyLedgerEditingScope, RemoteDailyLedgerRow } from '../lib/shipping/dailyLedgerTypes';
import {
  savePrintDocumentation,
  type PrintDocumentationRowSnapshot,
} from '../lib/shipping/dailyLedgerDocumentationGateway';
import {
  createDispatchSaveLog,
  markDispatchSavePrinted,
  type DispatchSaveLogDetail,
  type DispatchSaveRowSnapshot,
} from '../lib/shipping/dailyLedgerDispatchSaveGateway';
import { dailyLedgerDispatchGateway } from '../lib/shipping/dailyLedgerDispatchGateway';
import QuickLedgerCustomSaveDialog, {
  resolveCustomSaveFleet,
  type CustomSaveSubmit,
} from '../components/shipping/QuickLedgerCustomSaveDialog';
import QuickLedgerDispatchSaveLogPanel from '../components/shipping/QuickLedgerDispatchSaveLogPanel';
import QuickLedgerPostSavePrintPrompt from '../components/shipping/QuickLedgerPostSavePrintPrompt';
import QuickLedgerGlobalSearchModal from '../components/shipping/QuickLedgerGlobalSearchModal';
import QuickLedgerDuplicateRowsModal from '../components/shipping/QuickLedgerDuplicateRowsModal';
import ShippingSyncIndicator from '../components/shipping/ShippingSyncIndicator';
import {
  mergeLedgerRowWithAutoTariff,
  parseUsd,
  parseWeightKg,
  resolveCityId,
} from '../lib/shipping/ledgerTariffPricing';
import type { Branch, City, Customer, Driver, GoodsType, Shipment, Tariff, Vehicle } from '../types';

type LedgerRow = {
  id: number;
  clientRowId: string;
  serverRowNo?: number;
  sessionDriverId?: number;
  sessionId?: string;
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
  branchBackendId?: string;
  branchLabel?: string;
  /** من جلسة الدفتر — مطلوب للحفظ في وضع «كل الفروع» */
  sessionLedgerDate?: string;
  sessionLineLabel?: string;
  /** تعريف الإرسالية (النظام الجديد) */
  dispatchId?: string;
  dispatchNo?: string;
};

const LEDGER_ENTRY_SLOTS = 1;
const LEDGER_ROWS_ADD_INCREMENT = 1;
const ROW_SAVE_DEBOUNCE_MS = 280;
const FINANCIAL_ROW_FIELDS = new Set<keyof LedgerRow>([
  'collectAmount',
  'prepaidAmount',
  'receiverCollect',
  'transferServiceFee',
]);
type LedgerMoneySnapshot = {
  collect: number;
  prepaid: number;
  hawala: number;
  fee: number;
};

function snapshotLedgerMoney(row: Pick<LedgerRow, 'collectAmount' | 'prepaidAmount' | 'receiverCollect' | 'transferServiceFee'>): LedgerMoneySnapshot {
  return {
    collect: parseUsd(row.collectAmount),
    prepaid: parseUsd(row.prepaidAmount),
    hawala: parseUsd(row.receiverCollect),
    fee: parseUsd(row.transferServiceFee),
  };
}

function ledgerMoneyMatchesSnapshot(
  row: Pick<LedgerRow, 'collectAmount' | 'prepaidAmount' | 'receiverCollect' | 'transferServiceFee'>,
  snapshot: LedgerMoneySnapshot,
): boolean {
  const current = snapshotLedgerMoney(row);
  return (
    current.collect === snapshot.collect &&
    current.prepaid === snapshot.prepaid &&
    current.hawala === snapshot.hawala &&
    current.fee === snapshot.fee
  );
}

/** أسطر ضمن نطاق الإرسالية النشطة للحفظ/الترحيل */
function rowInActiveSessionScope(row: LedgerRow, sessionId: string): boolean {
  if (row.sessionId === sessionId) return true;
  // أسطر إدخال جديدة قبل أول حفظ — تُنسب للإرسالية المعروضة حالياً
  if (!row.dbId && !row.sessionId) return true;
  return false;
}

/** نطاق الحفظ/الترحيل من بيانات الإرسالية الفعلية — يتجاوز اختلاف التاريخ/الخط في الواجهة */
function resolveSessionLedgerScope(
  sessionId: string,
  remoteRows: RemoteDailyLedgerRow[],
  fallback: { branchId: string; ledgerDate: string; lineLabel: string },
): { branchId: string; ledgerDate: string; lineLabel: string } {
  const sample = remoteRows.find((row) => row.session_id === sessionId);
  if (!sample?.branch_id) return fallback;
  return {
    branchId: sample.branch_id,
    ledgerDate: sample.ledger_date ?? fallback.ledgerDate,
    lineLabel: sample.line_label ?? fallback.lineLabel,
  };
}

type SuggestedAgent = { id: number; code: string; name: string; governorate?: string; city?: string; area?: string };

type LedgerPrintScope = 'driver' | 'date' | 'agent' | 'session' | 'destination' | 'dispatch' | 'receipts';

function resolveBranchLabelFromList(branches: Branch[], branchBackendId?: string | null): string {
  if (!branchBackendId) return '—';
  return branches.find((branch) => getBackendIdFromSynthetic(branch.id) === branchBackendId)?.name ?? '—';
}

function uniqueTransferBranchIds(rows: LedgerRow[]): string[] {
  return [
    ...new Set(rows.map((row) => row.branchBackendId).filter((value): value is string => Boolean(value))),
  ];
}

function uniqueTransferBranchLabels(rows: LedgerRow[], branches: Branch[]): string[] {
  return uniqueTransferBranchIds(rows).map((branchId) => resolveBranchLabelFromList(branches, branchId));
}

const fallbackDestinations = ['دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب'];

function createEmptyRow(id: number): LedgerRow {
  return {
    id,
    clientRowId: createOfflineId('ledger_row'),
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

/** هل رقم الإيصال «مثبّت» للتحقق من التكرar (Enter أو محفوظ سابقاً) */
function isReceiptNoConfirmed(row: LedgerRow, confirmedRowIds: Set<number>): boolean {
  return Boolean(row.dbId || row.postedShipmentId || confirmedRowIds.has(row.id));
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

function resolveBranchBackendIdFromLine(line: string, branchList: Branch[]): string | null {
  const needle = normalizeName(line);
  if (!needle) return null;
  const exact = branchList.find((item) => normalizeName(item.name) === needle);
  if (exact) return getBackendIdFromSynthetic(exact.id) ?? null;
  const partial = branchList.find((item) => {
    const name = normalizeName(item.name);
    return name.includes(needle) || needle.includes(name);
  });
  if (partial) return getBackendIdFromSynthetic(partial.id) ?? null;
  const firstPart = normalizeName(needle.split(/\s*[-–—]\s*/)[0] || needle);
  if (!firstPart) return null;
  const byFirst = branchList.find((item) => {
    const name = normalizeName(item.name);
    return name === firstPart || name.includes(firstPart) || firstPart.includes(name);
  });
  return byFirst ? getBackendIdFromSynthetic(byFirst.id) ?? null : null;
}

function resolveDefaultAleppoBranchId(branchList: Branch[]): string | null {
  const aleppo = branchList.find((item) => normalizeName(item.name).includes('حلب'));
  if (aleppo) return getBackendIdFromSynthetic(aleppo.id) ?? null;
  return branchList[0] ? getBackendIdFromSynthetic(branchList[0].id) ?? null : null;
}

function stampRowLedgerScope(
  row: LedgerRow,
  context: {
    activeBranchId: string | null;
    trip: { date: string; line: string };
    branchList: Branch[];
    userBranchId?: string | null;
  },
): LedgerRow {
  const resolvedBranch =
    row.branchBackendId?.trim() ||
    context.activeBranchId?.trim() ||
    context.userBranchId?.trim() ||
    resolveBranchBackendIdFromLine(context.trip.line, context.branchList) ||
    resolveBranchBackendIdFromLine(row.origin, context.branchList) ||
    resolveDefaultAleppoBranchId(context.branchList) ||
    '';
  const ledgerDate = row.sessionLedgerDate?.trim() || context.trip.date?.trim() || '';
  const lineLabel =
    row.sessionLineLabel?.trim() ||
    context.trip.line?.trim() ||
    row.origin?.trim() ||
    '';
  if (!resolvedBranch && !ledgerDate && !lineLabel) return row;
  return {
    ...row,
    branchBackendId: row.branchBackendId || resolvedBranch || undefined,
    branchLabel:
      row.branchLabel ||
      (resolvedBranch ? resolveBranchLabelFromList(context.branchList, resolvedBranch) : undefined),
    sessionLedgerDate: row.sessionLedgerDate || ledgerDate || undefined,
    sessionLineLabel: row.sessionLineLabel || lineLabel || undefined,
  };
}

function resolveRowEditingScope(
  row: LedgerRow,
  _viewAllBranches: boolean,
  globalScope: DailyLedgerEditingScope,
  activeBranchId: string | null,
  currentTrip: { date: string; line: string },
  branchList: Branch[],
  userBranchId?: string | null,
): DailyLedgerEditingScope | null {
  const ledgerDate =
    row.sessionLedgerDate?.trim() ||
    globalScope.ledgerDate?.trim() ||
    currentTrip.date?.trim() ||
    new Date().toISOString().slice(0, 10);
  const lineLabel =
    row.sessionLineLabel?.trim() ||
    globalScope.lineLabel?.trim() ||
    currentTrip.line?.trim() ||
    row.origin?.trim() ||
    branchList.find((item) => normalizeName(item.name).includes('حلب'))?.name ||
    branchList[0]?.name ||
    '';
  const branchId =
    row.branchBackendId?.trim() ||
    globalScope.branchId?.trim() ||
    activeBranchId?.trim() ||
    userBranchId?.trim() ||
    resolveBranchBackendIdFromLine(currentTrip.line, branchList) ||
    resolveBranchBackendIdFromLine(row.origin, branchList) ||
    resolveDefaultAleppoBranchId(branchList) ||
    '';

  if (!branchId || !ledgerDate || !lineLabel) return null;
  return { branchId, ledgerDate, lineLabel };
}

/** جاهز لترحيل الشحنة — لا يشترط وزناً ولا كمية ولا مبلغاً */
function isRowComplete(row: LedgerRow) {
  return isRowSavable(row);
}

function isRowDeletable(row: LedgerRow) {
  if (row.loadedAt) return false;
  return Boolean(row.dbId || isRowStarted(row));
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
    notes: row.notes,
  };
}

function resolvePrintDestinationLabel(
  rows: Array<{ destination: string }>,
  activeSearch: string,
  scope: LedgerPrintScope,
  agentFilter: string,
): string {
  if (activeSearch.trim()) return activeSearch.trim();
  if (scope === 'agent' && agentFilter.trim()) return agentFilter.trim();
  const destinations = [...new Set(rows.map((row) => normalizeName(row.destination)).filter(Boolean))];
  if (destinations.length === 1) return destinations[0];
  if (destinations.length > 1) return 'كل الوجهات';
  return '—';
}

function buildVehicleBackendIdsForDriver(driverBackendId: string, vehicleList: Vehicle[]): Set<string> {
  const normalizedDriverId = driverBackendId.trim().toLowerCase();
  const vehicleIds = new Set<string>();
  for (const vehicle of vehicleList) {
    const vehicleDriverBackendId = vehicle.driverId ? getBackendIdFromSynthetic(vehicle.driverId) : undefined;
    if (!vehicleDriverBackendId || vehicleDriverBackendId.toLowerCase() !== normalizedDriverId) continue;
    const vehicleBackendId = getBackendIdFromSynthetic(vehicle.id);
    if (vehicleBackendId) vehicleIds.add(vehicleBackendId.toLowerCase());
  }
  return vehicleIds;
}

function buildPrintRowsSnapshot(rows: RemoteDailyLedgerRow[]): PrintDocumentationRowSnapshot[] {
  return rows.map((row) => ({
    rowId: row.id,
    rowNo: row.row_no,
    receiptNo: row.receipt_no,
    destination: row.destination ?? '',
    parcelType: row.parcel_type ?? '',
    parcelCount: row.parcel_count,
    weightKg: row.weight_kg == null ? null : String(row.weight_kg),
    senderName: row.sender_name ?? '',
    receiverName: row.receiver_name ?? '',
    collectAmountUsd: String(remoteRowCollectionUsd(row) || row.collect_amount_usd || '0'),
    prepaidAmountUsd: String(row.prepaid_amount_usd ?? '0'),
    hawalaAmountUsd: String(row.hawala_amount_usd ?? '0'),
    transferServiceFeeUsd: String(row.transfer_service_fee_usd ?? '0'),
    notes: row.notes,
    driverLabel: row.driver_label,
    sessionId: row.session_id ?? null,
    ledgerDate: row.ledger_date ?? null,
  }));
}

type SaveBatchOptions = {
  mode?: 'all' | 'custom';
  displayRowIds?: number[];
  targetDate?: string;
  overrideFleet?: {
    driverId: string | null;
    vehicleId: string | null;
    driverLabel: string | null;
    vehicleLabel: string | null;
  };
};

function buildDispatchSaveSnapshotFromLedgerRows(
  rows: LedgerRow[],
  savedDbIdByDisplayId: Map<number, string>,
  dispatchNo: number | null | undefined,
  ledgerDate: string,
  drivers: Driver[],
  trip: { driver: string; driverId: number },
): DispatchSaveRowSnapshot[] {
  return rows.map((row) => {
    const driver = drivers.find((item) => item.id === (row.sessionDriverId ?? trip.driverId));
    return {
      rowId: savedDbIdByDisplayId.get(row.id) ?? row.dbId ?? String(row.id),
      rowNo: row.serverRowNo ?? row.id,
      receiptNo: row.receiptNo || null,
      destination: row.destination ?? '',
      parcelType: row.parcelType ?? '',
      parcelCount: Number(row.parcelCount) || null,
      weightKg: row.weightKg || null,
      senderName: row.sender ?? '',
      receiverName: row.receiver ?? '',
      collectAmountUsd: String(parseUsd(row.collectAmount) || 0),
      prepaidAmountUsd: String(parseUsd(row.prepaidAmount) || 0),
      hawalaAmountUsd: String(parseUsd(row.receiverCollect) || 0),
      transferServiceFeeUsd: String(parseUsd(row.transferServiceFee) || 0),
      notes: row.notes || null,
      driverLabel: driver?.name ?? trip.driver ?? null,
      dispatchNo: dispatchNo ?? null,
      ledgerDate,
    };
  });
}

function computeDispatchSaveTotals(rows: DispatchSaveRowSnapshot[]) {
  return rows.reduce(
    (acc, row) => {
      acc.rowCount += 1;
      acc.piecesCount += Number(row.parcelCount ?? 0) || 0;
      acc.weightKg += Number(String(row.weightKg ?? '').replace(/[^\d.-]/g, '')) || 0;
      acc.collectTotalUsd += Number(String(row.collectAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
      acc.prepaidTotalUsd += Number(String(row.prepaidAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
      acc.hawalaTotalUsd += Number(String(row.hawalaAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
      acc.transferFeeTotalUsd += Number(String(row.transferServiceFeeUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
      return acc;
    },
    {
      rowCount: 0,
      piecesCount: 0,
      weightKg: 0,
      collectTotalUsd: 0,
      prepaidTotalUsd: 0,
      hawalaTotalUsd: 0,
      transferFeeTotalUsd: 0,
    },
  );
}

function uniqueDestinationLabel(rows: Array<{ destination?: string | null }>): string {
  const destinations = [...new Set(rows.map((row) => normalizeName(row.destination ?? '')).filter(Boolean))];
  if (!destinations.length) return '—';
  if (destinations.length <= 4) return destinations.join('، ');
  return `${destinations.slice(0, 4).join('، ')}… (+${destinations.length - 4})`;
}

function dispatchSaveSnapshotToPrintRows(snapshot: DispatchSaveRowSnapshot[]): QuickLedgerPrintRow[] {
  return snapshot.map((row) => ({
    parcelType: row.parcelType,
    parcelCount: String(row.parcelCount ?? ''),
    weightKg: row.weightKg ?? '',
    collectAmount: row.collectAmountUsd,
    prepaidAmount: row.prepaidAmountUsd,
    hawalaAmount: row.hawalaAmountUsd,
    transferServiceFee: row.transferServiceFeeUsd,
    sender: row.senderName,
    receiver: row.receiverName,
    destination: row.destination,
    receiptNo: row.receiptNo ?? '',
    notes: row.notes ?? '',
  }));
}

function resolvePrintDriverLabel(
  rows: RemoteDailyLedgerRow[],
  activeSearch: string,
  scope: LedgerPrintScope,
  selectedDriverName: string,
  scopeFallback: string,
): string {
  if (scope === 'driver' && selectedDriverName) return selectedDriverName;
  if (activeSearch.trim()) {
    const drivers = [...new Set(
      rows.map((row) => normalizeName(row.driver_label ?? '')).filter(Boolean),
    )];
    if (drivers.length === 1) return drivers[0];
    if (drivers.length > 1) return `كل السائقين (${drivers.length})`;
    return scopeFallback;
  }
  return scopeFallback;
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
  const { status: cloudStatus } = useCloudConnectionStatus();
  const [rows, setRows] = useState<LedgerRow[]>(() => [createEmptyRow(1)]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeRowId, setActiveRowId] = useState(1);
  /** السطر الذي يُحرَّر فيه رقم الإيصال — لا نتحقق من التكرار أثناء الكتابة */
  const [receiptEditingRowId, setReceiptEditingRowId] = useState<number | null>(null);
  /** أسطر أكّد فيها المستخدم رقم الإيصال بـ Enter — قبلها لا تظهر تحذيرات التكرار */
  const [confirmedReceiptRowIds, setConfirmedReceiptRowIds] = useState<Set<number>>(() => new Set());
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const printHubRef = useRef<QuickLedgerPrintHubHandle>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const pendingFocusDbRowIdRef = useRef<string | null>(null);
  const [reprintRequired, setReprintRequired] = useState(false);
  const [remoteRowsRaw, setRemoteRowsRaw] = useState<RemoteDailyLedgerRow[]>([]);
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
      postedRowsCount?: number;
      unpostedRowsCount?: number;
      sourceLedgerDate?: string | null;
    };
    warnings: string[];
    errors: string[];
  }>({ loading: false, warnings: [], errors: [] });
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [customSaveOpen, setCustomSaveOpen] = useState(false);
  const [dispatchSaveLogOpen, setDispatchSaveLogOpen] = useState(false);
  const [postSavePrintOpen, setPostSavePrintOpen] = useState(false);
  const [postSavePrinting, setPostSavePrinting] = useState(false);
  const [postSavePrintContext, setPostSavePrintContext] = useState<{
    dispatchNo: number | null;
    driverLabel: string;
    destinationLabel: string;
    printRows: QuickLedgerPrintRow[];
    saveLogId?: string;
    ledgerDate: string;
    lineLabel: string;
    branchId: string;
  } | null>(null);
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
  const [pendingLocalDraftCount, setPendingLocalDraftCount] = useState(0);
  const [offlineStoreAvailable, setOfflineStoreAvailable] = useState(!isElectronRuntime());
  const [isLocalPersistenceNode, setIsLocalPersistenceNode] = useState<boolean | null>(isElectronRuntime() ? null : false);
  const loadGenerationRef = useRef(0);
  const restoredDraftScopeRef = useRef<string>('');
  const canViewAllLedgerEntriesRef = useRef(false);
  const ledgerBranchModeRef = useRef<'all' | 'single'>('single');
  const [ledgerBranchMode, setLedgerBranchMode] = useState<'all' | 'single'>('single');
  /** نطاق التحرير المحفوظ — يُستخدم للحفظ التلقائي ولا يتغيّر إلا بعد جلب ناجح */
  const editingScopeRef = useRef<DailyLedgerEditingScope>({
    branchId: '',
    ledgerDate: '',
    lineLabel: '',
  });
  const saveTimersRef = useRef<Record<number, number>>({});
  const saveInFlightRef = useRef<Record<number, Promise<void>>>({});
  const saveRowToServerRef = useRef<(displayRowId: number, options?: { force?: boolean }) => Promise<void>>(async () => {});
  const receiptEditingRowIdRef = useRef<number | null>(null);
  const receiptCommittedViaEnterRef = useRef(false);
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
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchSeed, setGlobalSearchSeed] = useState('');
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [destinationSort, setDestinationSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [pageSearchQuery, setPageSearchQuery] = useState('');

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

  const cycleDestinationSort = () => {
    setDestinationSort((prev) => {
      if (prev === 'none') return 'asc';
      if (prev === 'asc') return 'desc';
      return 'none';
    });
  };

  const visibleRows = useMemo(() => {
    const blankNewEntries = rows.filter((row) => !row.dbId && !row.loadedAt && !isRowStarted(row));
    const trailingBlank = blankNewEntries.length ? blankNewEntries[blankNewEntries.length - 1] : null;
    let displayable = rows.filter(
      (row) => isRowStarted(row) || (trailingBlank != null && row.id === trailingBlank.id),
    );
    const needle = normalizeName(pageSearchQuery.trim());
    let filtered = displayable;
    if (needle) {
      filtered = displayable.filter((row) => {
        if (trailingBlank != null && row.id === trailingBlank.id) return true;
        return (
          normalizeName(row.destination ?? '').includes(needle) ||
          normalizeName(row.sender ?? '').includes(needle) ||
          normalizeName(row.receiver ?? '').includes(needle) ||
          normalizeName(row.receiptNo ?? '').includes(needle)
        );
      });
    }
    if (destinationSort === 'none') return filtered;
    const entryRow =
      trailingBlank && filtered.some((row) => row.id === trailingBlank.id) ? trailingBlank : null;
    const sortable = entryRow ? filtered.filter((row) => row.id !== entryRow.id) : filtered;
    const factor = destinationSort === 'asc' ? 1 : -1;
    const sorted = [...sortable]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = String(a.row.destination ?? '')
          .trim()
          .localeCompare(String(b.row.destination ?? '').trim(), 'ar');
        return cmp !== 0 ? cmp * factor : a.index - b.index;
      })
      .map(({ row }) => row);
    return entryRow ? [...sorted, entryRow] : sorted;
  }, [rows, catalogAgents, destinationSort, pageSearchQuery]);

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
    const branchIds = uniqueTransferBranchIds(selectedTransferRows);
    const branchLabels = uniqueTransferBranchLabels(selectedTransferRows, branches);
    return {
      rows: selectedTransferRows.length,
      pieces,
      weightKg,
      collect,
      prepaid,
      freight,
      destinations: [...destinations],
      branchIds,
      branchLabels,
      hasMultipleBranches: branchIds.length > 1,
    };
  }, [selectedTransferRows, branches]);

  useEffect(() => {
    receiptEditingRowIdRef.current = receiptEditingRowId;
  }, [receiptEditingRowId]);

  useEffect(() => {
    setFailedSaveRows(loadFailedSaveRows(trip.date, trip.line));
  }, [trip.date, trip.line]);

  const duplicateReceiptRowIds = useMemo(() => {
    const byKey = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      if (row.id === receiptEditingRowId) continue;
      if (!isReceiptNoConfirmed(row, confirmedReceiptRowIds)) continue;
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
  }, [rows, receiptEditingRowId, confirmedReceiptRowIds]);

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
    const printable = filterPrintableDailyLedgerRows(remoteRowsRaw);
    const needle = normalizeName(pageSearchQuery.trim());
    const filteredRemote = needle
      ? printable.filter(
          (row) =>
            normalizeName(row.destination ?? '').includes(needle) ||
            normalizeName(row.sender_name ?? '').includes(needle) ||
            normalizeName(row.receiver_name ?? '').includes(needle) ||
            normalizeName(row.receipt_no ?? '').includes(needle),
        )
      : printable;
    const totals = computeTotalsFromRemoteRows(filteredRemote);
    const completeRows = rows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
    return {
      rowCount: totals.rowCount,
      collectionUsd: totals.collectionUsd,
      prepaidUsd: totals.prepaidUsd,
      hawalaUsd: totals.hawalaUsd,
      transferFeeUsd: totals.transferServiceFeeUsd,
      totalWeightKg: totals.weightKg,
      complete: completeRows.length,
      saved: filteredRemote.filter((row) => Boolean(row.posted_shipment_id)).length,
      searchActive: Boolean(needle),
      searchLabel: pageSearchQuery.trim(),
    };
  }, [remoteRowsRaw, rows, pageSearchQuery]);

  const rowsRef = useRef(rows);
  const customersRef = useRef(customers);
  const goodsTypesRef = useRef(goodsTypes);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const tripRef = useRef(trip);
  const activeBranchIdRef = useRef(activeBranchId);
  const driversRef = useRef(drivers);
  const vehiclesRef = useRef(vehicles);
  const branchesRef = useRef(branches);

  useEffect(() => {
    driversRef.current = drivers;
  }, [drivers]);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

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

  const isCompanyWideLedgerViewer = useMemo(() => {
    if (!user) return false;
    if (user.userType === 'admin' || user.role === 'admin') return true;
    return ['general_manager', 'branch_manager', 'manager', 'shipment_auditor'].includes(user.role);
  }, [user]);

  const isLedgerScopedOperator = useMemo(() => {
    if (!user) return false;
    return user.role === 'data_entry';
  }, [user]);

  /** المدير ومدقق الشحنات يريان كل إدخالات الموظفين؛ مدخل البيانات يرى إدخالاته فقط */
  const canViewAllLedgerEntries = useMemo(() => {
    if (!user || isLedgerScopedOperator) return false;
    if (user.userType === 'admin' || user.role === 'admin') return true;
    if (['general_manager', 'branch_manager', 'manager', 'shipment_auditor'].includes(user.role)) return true;
    return hasPermission('daily_ledger.view_all_entries');
  }, [user, hasPermission, isLedgerScopedOperator]);

  const canLedgerExportPdf = hasPermission('daily_ledger.export_pdf');
  const canLedgerTransfer = hasPermission('daily_ledger.transfer.create');
  const canLedgerCloseSection = hasPermission('daily_ledger.close_section');
  const canLedgerSaveLog = hasPermission('daily_ledger.save_log');
  const canLedgerDispatchSaveLog = hasPermission('daily_ledger.dispatch_save.read');
  const canLedgerViewLoaded = hasPermission('daily_ledger.view_loaded');
  const canLedgerDeleteRows = hasPermission('daily_ledger.delete_rows');
  const canLedgerPostShipments = hasPermission('daily_ledger.post_shipments');

  useEffect(() => {
    if (!canLedgerViewLoaded && includeLoaded) setIncludeLoaded(false);
  }, [canLedgerViewLoaded, includeLoaded]);

  useEffect(() => {
    canViewAllLedgerEntriesRef.current = canViewAllLedgerEntries;
  }, [canViewAllLedgerEntries]);

  useEffect(() => {
    ledgerBranchModeRef.current = ledgerBranchMode;
  }, [ledgerBranchMode]);

  useEffect(() => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    if (!currentTrip.date?.trim() || !currentTrip.line?.trim()) return;
    editingScopeRef.current = {
      branchId: branchId?.trim() || resolveBranchBackendIdFromLine(currentTrip.line, branchesRef.current) || '',
      ledgerDate: currentTrip.date,
      lineLabel: currentTrip.line,
    };
  }, [trip.date, trip.line, activeBranchId, ledgerBranchMode]);

  useEffect(() => {
    if (!canViewAllLedgerEntries) {
      setLedgerBranchMode('single');
      return;
    }
    // المدير: افتراضي فرع واحد (حلب) للإدخال والحفظ — «كل الفروع» اختياري من الزر
    setLedgerBranchMode('single');
  }, [canViewAllLedgerEntries, user?.id]);

  const branchChoices = useMemo(() => {
    if (!user) return branches;
    if (isCompanyWideLedgerViewer) return branches;
    if (isLedgerScopedOperator) {
      const onlyBranchId = user.branchId ?? user.allowedBranchIds?.[0] ?? null;
      if (!onlyBranchId) return branches.slice(0, 1);
      const sid = syntheticEntityId(onlyBranchId);
      return branches.filter((b) => b.id === sid);
    }
    const allowed = new Set((user.allowedBranchIds || []).map((id) => syntheticEntityId(id)));
    if (allowed.size === 0 && user.branchId) allowed.add(syntheticEntityId(user.branchId));
    if (allowed.size === 0) return branches.slice(0, 1);
    return branches.filter((b) => allowed.has(b.id));
  }, [branches, user, isCompanyWideLedgerViewer, isLedgerScopedOperator]);

  const isBranchLocked = useMemo(() => {
    if (!user) return false;
    if (isCompanyWideLedgerViewer) return false;
    if (isLedgerScopedOperator) return true;
    return (user.allowedBranchIds || []).length <= 1;
  }, [user, isCompanyWideLedgerViewer, isLedgerScopedOperator]);

  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  const canPickHistoricalDate = useMemo(() => {
    if (!user) return false;
    if (user.userType === 'admin' || user.role === 'admin') return true;
    if (['general_manager', 'branch_manager', 'manager'].includes(user.role)) return true;
    return hasPermission('shipments.ledger.past_dates') || hasPermission('daily_ledger.backdate.create');
  }, [user, hasPermission]);

  const canPickFutureDate = useMemo(() => {
    if (!user) return false;
    if (user.userType === 'admin' || user.role === 'admin') return true;
    if (['general_manager', 'branch_manager', 'manager'].includes(user.role)) return true;
    return hasPermission('shipments.ledger.future_dates');
  }, [user, hasPermission]);

  const activeBranchDisplayName = useMemo(() => {
    if (canViewAllLedgerEntries && ledgerBranchMode === 'all') return 'كل الفروع';
    if (!activeBranchId) return '—';
    return (
      branches.find((branch) => getBackendIdFromSynthetic(branch.id) === activeBranchId)?.name
      ?? branchSearch
      ?? '—'
    );
  }, [activeBranchId, branchSearch, branches, canViewAllLedgerEntries, ledgerBranchMode]);

  const activeDraftContext = useMemo<DailyLedgerDraftContext | null>(() => {
    if (canViewAllLedgerEntries && ledgerBranchMode === 'all') return null;
    if (!activeBranchId || !trip.date || !trip.line) return null;
    return {
      branchId: activeBranchId,
      ledgerDate: trip.date,
      lineLabel: trip.line,
      sessionId: null,
    };
  }, [activeBranchId, canViewAllLedgerEntries, ledgerBranchMode, trip.date, trip.line]);

  /** المدير يختار الفرع داخل البطاقة؛ موظف الإدخال مربوط بفرعه فقط */
  const canPickDispatchBranch = canViewAllLedgerEntries;

  const dispatchLockedBranchId = useMemo(() => {
    if (canPickDispatchBranch) return null;
    if (user?.branchId) return user.branchId;
    if (activeBranchId) return activeBranchId;
    const first = branchChoices[0];
    return first ? getBackendIdFromSynthetic(first.id) ?? null : null;
  }, [activeBranchId, branchChoices, canPickDispatchBranch, user?.branchId]);

  const dispatchPreferredBranchId = useMemo(() => {
    return (
      activeBranchId ||
      resolveBranchBackendIdFromLine(trip.line, branches) ||
      dispatchLockedBranchId
    );
  }, [activeBranchId, branches, dispatchLockedBranchId, trip.line]);

  const draftScopeKey = useMemo(() => {
    if (!activeDraftContext) return '';
    return [
      activeDraftContext.branchId,
      activeDraftContext.ledgerDate,
      activeDraftContext.lineLabel,
      activeDraftContext.sessionId ?? '',
    ].join('|');
  }, [activeDraftContext]);

  const isCloudOffline = cloudStatus === 'offline';
  const isPersistenceOffline = isCloudOffline && isLocalPersistenceNode !== true;

  const requirePersistenceConnection = (message: string) => {
    if (!isPersistenceOffline) return true;
    showToast(message, 'error');
    return false;
  };

  const requireCloudConnection = (
    message = 'هذا الإجراء يحتاج اتصالاً بالسحابة. سيتم حفظ الإدخال محلياً فقط حتى عودة الاتصال.',
  ) => {
    if (!isCloudOffline) return true;
    showToast(message, 'error');
    return false;
  };

  /** branchLabel يُحفظ مع السطر للخادم — لا يُعرض (الخط = مصدر البضاعة). */

  /** يعمل المستخدم على تاريخ سابق — تنبيه أن الإدخال تصحيح ويستلزم إعادة الطباعة */
  const isBackdateMode = useMemo(() => Boolean(trip.date && trip.date < todayIso), [trip.date, todayIso]);

  /** تاريخ مستقبلي — تحميل اليوم وسفر الغد (دوريات الجمارك) */
  const isFutureDateMode = useMemo(() => Boolean(trip.date && trip.date > todayIso), [trip.date, todayIso]);

  const mapRemoteRowToLocal = (remote: RemoteDailyLedgerRow, displayId: number): LedgerRow => ({
    id: displayId,
    clientRowId: createOfflineId('ledger_row'),
    serverRowNo: remote.row_no,
    sessionDriverId: remote.driver_id ? syntheticEntityId(remote.driver_id) : undefined,
    sessionId: remote.session_id ?? undefined,
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
    collectAmount: remoteCollectAmountLabel(remote),
    prepaidAmount: String(remote.prepaid_amount_usd ?? ''),
    receiverCollect: String(remote.hawala_amount_usd ?? ''),
    transferServiceFee: String(remote.transfer_service_fee_usd ?? ''),
    collectManual:
      parseUsd(String(remote.collect_amount_usd ?? '')) > 0 || parseUsd(String(remote.fees_amount_usd ?? '')) > 0,
    agentId: undefined,
    agentName: '',
    notes: remote.notes ?? '',
    branchBackendId: remote.branch_id,
    branchLabel: resolveBranchLabelFromList(branches, remote.branch_id),
    sessionLedgerDate: remote.ledger_date,
    sessionLineLabel: remote.line_label,
    dispatchId: remote.dispatch_id ?? undefined,
    dispatchNo: remote.dispatch_no != null ? String(remote.dispatch_no) : undefined,
  });

  const flushPendingRowSaves = async (scopeSessionId?: string | null) => {
    Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current = {};
    receiptEditingRowIdRef.current = null;
    setReceiptEditingRowId(null);
    const targets = rowsRef.current.filter((row) => {
      if (!shouldPersistRow(row)) return false;
      if (scopeSessionId) return rowInActiveSessionScope(row, scopeSessionId);
      return true;
    });
    for (const row of targets) {
      await saveRowToServerRef.current(row.id, { force: true });
    }
  };

  useEffect(() => {
    const flush = () => {
      void flushPendingRowSaves();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const buildEntrySlotRows = (startId: number, origin: string, count = LEDGER_ENTRY_SLOTS) => {
    const scopeContext = {
      activeBranchId: activeBranchIdRef.current,
      trip: tripRef.current,
      branchList: branchesRef.current,
      userBranchId: userRef.current?.branchId ?? userRef.current?.allowedBranchIds?.[0] ?? null,
    };
    return Array.from({ length: count }, (_, idx) => {
      const seeded = stampRowLedgerScope({ ...createEmptyRow(startId + idx), origin }, scopeContext);
      return mergeRowWithAutoTariff(
        seeded,
        tariffs,
        cities,
        branches,
        goodsTypes,
        tripRef.current.date,
      );
    });
  };

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
    const viewAllBranches = canViewAllLedgerEntriesRef.current && ledgerBranchModeRef.current === 'all';
    let sorted = sortDailyLedgerRows(filterPrintableDailyLedgerRows(remoteRows));
    if (viewAllBranches) {
      sorted = [...sorted].sort((a, b) => {
        const branchCmp = resolveBranchLabelFromList(branches, a.branch_id).localeCompare(
          resolveBranchLabelFromList(branches, b.branch_id),
          'ar',
        );
        if (branchCmp !== 0) return branchCmp;
        return compareDailyLedgerRowsChronological(a, b);
      });
    }
    let displayId = 1;
    const consolidated = sorted.map((remote) => mapRemoteRowToLocal(remote, displayId++));
    const nextEntryId = consolidated.length > 0 ? displayId : 1;
    return [...consolidated, ...buildEntrySlotRows(nextEntryId, origin)];
  };

  const rowToDraftPayload = (row: LedgerRow): Record<string, unknown> => ({
    receiptNo: row.receiptNo,
    origin: row.origin,
    destination: row.destination,
    parcelType: row.parcelType,
    parcelCount: row.parcelCount,
    weightKg: row.weightKg,
    sender: row.sender,
    receiver: row.receiver,
    collectAmount: row.collectAmount,
    prepaidAmount: row.prepaidAmount,
    receiverCollect: row.receiverCollect,
    transferServiceFee: row.transferServiceFee,
    collectManual: row.collectManual ?? false,
    agentId: row.agentId,
    agentName: row.agentName,
    notes: row.notes,
    branchBackendId: row.branchBackendId,
    branchLabel: row.branchLabel,
    dispatchId: row.dispatchId,
    dispatchNo: row.dispatchNo,
  });

  const draftToLocalRow = (draft: DailyLedgerDraftRecord, displayId: number): LedgerRow => {
    const payload = draft.payload as Partial<LedgerRow>;
    return {
      ...createEmptyRow(displayId),
      clientRowId: draft.clientRowId,
      dbId: draft.serverRowId ?? undefined,
      serverRowNo: draft.rowNo,
      sessionId: draft.sessionId ?? undefined,
      receiptNo: String(payload.receiptNo ?? ''),
      origin: String(payload.origin ?? resolveTripOrigin(draft.lineLabel)),
      destination: String(payload.destination ?? ''),
      parcelType: String(payload.parcelType ?? ''),
      parcelCount: String(payload.parcelCount ?? ''),
      weightKg: String(payload.weightKg ?? ''),
      sender: String(payload.sender ?? ''),
      receiver: String(payload.receiver ?? ''),
      collectAmount: String(payload.collectAmount ?? ''),
      prepaidAmount: String(payload.prepaidAmount ?? ''),
      receiverCollect: String(payload.receiverCollect ?? ''),
      transferServiceFee: String(payload.transferServiceFee ?? ''),
      collectManual: Boolean(payload.collectManual),
      agentId: typeof payload.agentId === 'number' ? payload.agentId : undefined,
      agentName: typeof payload.agentName === 'string' ? payload.agentName : '',
      notes: String(payload.notes ?? ''),
      branchBackendId: typeof payload.branchBackendId === 'string' ? payload.branchBackendId : draft.branchId,
      branchLabel: typeof payload.branchLabel === 'string' ? payload.branchLabel : resolveBranchLabelFromList(branches, draft.branchId),
      dispatchId: typeof payload.dispatchId === 'string' ? payload.dispatchId : undefined,
      dispatchNo: typeof payload.dispatchNo === 'string' ? payload.dispatchNo : undefined,
    };
  };

  const refreshPendingDraftCount = async (context = activeDraftContext) => {
    if (!context) {
      setPendingLocalDraftCount(0);
      return;
    }
    try {
      setPendingLocalDraftCount(await countPendingDailyLedgerDrafts(context));
    } catch {
      setPendingLocalDraftCount(0);
    }
  };

  const restoreLocalDraftsForContext = async (
    context: DailyLedgerDraftContext,
    remoteValues: RemoteDailyLedgerRow[],
    baseRows: LedgerRow[],
  ) => {
    if (!offlineStoreAvailable) return baseRows;
    const restoreKey = `${context.branchId}|${context.ledgerDate}|${context.lineLabel}|${context.sessionId ?? ''}`;
    if (restoredDraftScopeRef.current === restoreKey) return baseRows;

    const serverIds = new Set(remoteValues.map((row) => row.id));
    const serverReceipts = new Set(
      remoteValues.map((row) => normalizeReceiptNo(row.receipt_no ?? '')).filter(Boolean),
    );
    const localClientIds = new Set(baseRows.map((row) => row.clientRowId));

    try {
      const drafts = await listDailyLedgerDrafts(context);
      const restoreCandidates = drafts.filter((draft) => {
        if (draft.status === 'synced') return false;
        if (localClientIds.has(draft.clientRowId)) return false;
        if (draft.serverRowId && serverIds.has(draft.serverRowId)) return false;
        const receipt = normalizeReceiptNo(draft.receiptNo ?? String(draft.payload.receiptNo ?? ''));
        if (receipt && serverReceipts.has(receipt)) return false;
        return true;
      });
      if (!restoreCandidates.length) {
        restoredDraftScopeRef.current = restoreKey;
        await refreshPendingDraftCount(context);
        return baseRows;
      }

      const nonPlaceholder = baseRows.filter(isRowStarted);
      const maxId = nonPlaceholder.reduce((max, row) => Math.max(max, row.id), 0);
      const restoredRows = restoreCandidates.map((draft, index) => draftToLocalRow(draft, maxId + index + 1));
      const merged = appendTrailingEntrySlot([...nonPlaceholder, ...restoredRows]);
      restoredDraftScopeRef.current = restoreKey;
      showToast(`تم استعادة ${restoredRows.length} صف محفوظ محلياً على هذا الجهاز.`, 'info');
      await addDailyLedgerSyncAudit({
        eventType: 'draft_restore',
        message: `Restored ${restoredRows.length} local daily ledger draft rows.`,
      });
      await refreshPendingDraftCount(context);
      return merged;
    } catch (error) {
      console.warn('[daily-ledger] local draft restore failed', error);
      return baseRows;
    }
  };

  const loadRemoteRows = async () => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    const viewAllEntries = canViewAllLedgerEntriesRef.current;
    const viewAllBranches = viewAllEntries && ledgerBranchModeRef.current === 'all';
    if (!viewAllBranches && !branchId) return;
    if (!currentTrip.date) return;
    if (!viewAllEntries && !currentTrip.line) return;

    const generation = ++loadGenerationRef.current;

    try {
      await flushPendingRowSaves();
      if (generation !== loadGenerationRef.current) return;

      setDestinationSort('none');
      setRemoteRowsRaw([]);
      setRemoteSyncedCount(0);

      const origin = resolveTripOrigin(currentTrip.line);
      setRows(buildEntrySlotRows(1, origin));

      const queryScope = buildLedgerRowsQueryScope(
        branchId || '',
        currentTrip.date,
        currentTrip.line || '',
        includeLoaded,
        {
          managerViewAllBranches: viewAllBranches,
          allLines: viewAllEntries,
        },
      );
      const remoteValues = await fetchAllDailyLedgerRows(queryScope);
      if (generation !== loadGenerationRef.current) return;

      editingScopeRef.current = {
        branchId: viewAllBranches
          ? (branchId ?? resolveBranchBackendIdFromLine(currentTrip.line, branchesRef.current) ?? '')
          : branchId!,
        ledgerDate: currentTrip.date,
        lineLabel: currentTrip.line,
      };

      setRemoteSyncedCount(remoteValues.length);
      setReprintRequired(remoteValues.some((row) => row.session_reprint_required === true));
      setRemoteRowsRaw(remoteValues);
      const displayRows = buildDisplayRowsFromRemote(remoteValues);
      const draftContext = viewAllBranches
        ? null
        : {
            branchId: branchId!,
            ledgerDate: currentTrip.date,
            lineLabel: currentTrip.line,
            sessionId: null,
          };
      const rowsWithDrafts = draftContext
        ? await restoreLocalDraftsForContext(draftContext, remoteValues, displayRows)
        : displayRows;
      if (generation !== loadGenerationRef.current) return;
      setRows(rowsWithDrafts);
      const focusDbRowId = pendingFocusDbRowIdRef.current;
      if (focusDbRowId) {
        pendingFocusDbRowIdRef.current = null;
        const displayRow = rowsWithDrafts.find((entry) => entry.dbId === focusDbRowId);
        if (displayRow) {
          setActiveRowId(displayRow.id);
          window.setTimeout(() => {
            document
              .querySelector(`[data-ledger-row-id="${displayRow.id}"]`)
              ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }, 80);
        } else {
          showToast('تم فتح تاريخ السطر — لم يُعثر على السطر في العرض الحالي.', 'info');
        }
      }
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
    let cancelled = false;
    void (async () => {
      if (isElectronRuntime() && window.runtime?.getConfig) {
        const config = await window.runtime.getConfig();
        const localNode = config.runtimeMode === 'local_production' && config.backendResolutionMode === 'localhost';
        if (cancelled) return;
        setIsLocalPersistenceNode(localNode);
        if (localNode) {
          setOfflineStoreAvailable(false);
          return;
        }
      } else setIsLocalPersistenceNode(false);
      const available = await isDailyLedgerOfflineStoreAvailable();
      if (cancelled) return;
      setOfflineStoreAvailable(available);
      if (!available) {
        showToast('التخزين المحلي غير متاح في هذا المتصفح. سيبقى الدفتر يعمل، لكن المسودات المحلية قد لا تُستعاد بعد التحديث.', 'error');
      }
    })().catch(() => { if (!cancelled) setOfflineStoreAvailable(false); });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!offlineStoreAvailable || !activeDraftContext) return;
    const context = activeDraftContext;
    const timer = window.setTimeout(() => {
      void (async () => {
        const drafts = rowsRef.current.filter((row) => {
          if (row.loadedAt || row.postedShipmentId) return false;
          return isRowStarted(row);
        });

        for (const row of drafts) {
          const record: DailyLedgerDraftRecord = {
            clientRowId: row.clientRowId,
            serverRowId: row.dbId ?? null,
            branchId: context.branchId,
            ledgerDate: context.ledgerDate,
            lineLabel: context.lineLabel,
            sessionId: row.sessionId ?? context.sessionId ?? null,
            rowNo: row.serverRowNo ?? row.id,
            receiptNo: row.receiptNo,
            payload: rowToDraftPayload(row),
            status: isCloudOffline ? 'pending_sync' : row.dbId ? 'synced' : 'draft',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastError: null,
          };
          await putDailyLedgerDraft(record);
        }
        await refreshPendingDraftCount(context);
      })().catch((error) => {
        console.warn('[daily-ledger] local draft persistence failed', error);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeDraftContext, draftScopeKey, isCloudOffline, offlineStoreAvailable, rows]);

  useEffect(() => {
    if (loadingRefs) return;
    if (!trip.date) return;
    const needsSingleBranch = !canViewAllLedgerEntries || ledgerBranchMode === 'single';
    if (needsSingleBranch && !activeBranchId) return;
    if (!canViewAllLedgerEntries && !trip.line) return;
    setRemoteLoading(true);
    setRemoteRowsRaw([]);
    void loadRemoteRows();
  }, [activeBranchId, trip.date, trip.line, includeLoaded, loadingRefs, canViewAllLedgerEntries, ledgerBranchMode]);

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
        const preferredBranch =
          branchesData.find((b) => normalizeName(b.name).includes('حلب')) ?? branchesData[0] ?? null;
        const preferredLine =
          preferredBranch?.name
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
        if (preferredBranch) {
          const backendId = getBackendIdFromSynthetic(preferredBranch.id);
          if (backendId && !activeBranchIdRef.current) {
            void setActiveBranch(backendId);
            setBranchSearch(preferredBranch.name);
          }
        }

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
    if (canViewAllLedgerEntries && ledgerBranchMode === 'all') return;
    if (activeBranchId) return;
    const fallback = user.branchId ?? user.allowedBranchIds?.[0] ?? null;
    if (fallback) {
      void setActiveBranch(fallback);
      return;
    }
    if (isCompanyWideLedgerViewer && branchChoices[0]) {
      const backendId = getBackendIdFromSynthetic(branchChoices[0].id);
      if (backendId) void setActiveBranch(backendId);
    }
  }, [
    activeBranchId,
    branchChoices,
    branches.length,
    canViewAllLedgerEntries,
    isCompanyWideLedgerViewer,
    ledgerBranchMode,
    setActiveBranch,
    user,
  ]);

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
    setRows((prev) => {
      const before = prev.find((row) => row.id === id);
      const mapped = prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'parcelType') {
          const next = { ...row, parcelType: value };
          return skipTariff ? next : mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
        }
        if (field === 'collectAmount') {
          const collect = parseUsd(value);
          let next: LedgerRow = { ...row, collectAmount: value, collectManual: value.trim() !== '' };
          if (collect > 0) {
            next = { ...next, prepaidAmount: '0', collectManual: true };
          } else if (!value.trim()) {
            next = { ...next, collectManual: false };
            next = skipTariff ? next : mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
          }
          return stampRowLedgerScope(next, {
            activeBranchId: activeBranchIdRef.current,
            trip: tripRef.current,
            branchList: branchesRef.current,
            userBranchId: userRef.current?.branchId ?? userRef.current?.allowedBranchIds?.[0] ?? null,
          });
        }
        if (field === 'prepaidAmount') {
          const prepaid = parseUsd(value);
          let next: LedgerRow = { ...row, prepaidAmount: value };
          if (prepaid > 0) {
            next = { ...next, collectAmount: '0', collectManual: true };
          } else {
            next = { ...next, collectManual: false };
            next = skipTariff ? next : mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
          }
          return stampRowLedgerScope(next, {
            activeBranchId: activeBranchIdRef.current,
            trip: tripRef.current,
            branchList: branchesRef.current,
            userBranchId: userRef.current?.branchId ?? userRef.current?.allowedBranchIds?.[0] ?? null,
          });
        }
        let next: LedgerRow = { ...row, [field]: value };
        if (!skipTariff && (field === 'origin' || field === 'destination' || field === 'weightKg')) {
          next = mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
        }
        next = stampRowLedgerScope(next, {
          activeBranchId: activeBranchIdRef.current,
          trip: tripRef.current,
          branchList: branchesRef.current,
          userBranchId: userRef.current?.branchId ?? userRef.current?.allowedBranchIds?.[0] ?? null,
        });
        return next;
      });
      const after = mapped.find((row) => row.id === id);
      const becameSavable = after && isRowSavable(after) && (!before || !isRowSavable(before));
      return becameSavable ? appendTrailingEntrySlot(mapped) : mapped;
    });
    if (field === 'receiptNo' || field === 'destination' || field === 'sender' || field === 'receiver') {
      clearFailedSaveRow(id);
    }
    if (field !== 'receiptNo' && !FINANCIAL_ROW_FIELDS.has(field)) {
      queueRowSave(id);
    }
  };

  const validateReceiptNoCommit = (rowId: number): boolean => {
    const row = rowsRef.current.find((entry) => entry.id === rowId);
    if (!row) return true;
    const normalized = normalizeName(row.receiptNo);
    if (!normalized) return true;
    const dup = findReceiptConflictForRow(row, rowsRef.current);
    if (!dup) return true;
    showToast(describeReceiptConflict(rowsRef.current, row, dup), 'error');
    return false;
  };

  const commitReceiptNoCell = (rowId: number) => {
    if (receiptCommittedViaEnterRef.current) {
      receiptCommittedViaEnterRef.current = false;
      return;
    }
    setReceiptEditingRowId(null);
    if (validateReceiptNoCommit(rowId)) {
      flushRowSave(rowId);
    }
  };

  const handleReceiptKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowId: number) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!validateReceiptNoCommit(rowId)) return;
      receiptCommittedViaEnterRef.current = true;
      setReceiptEditingRowId(null);
      const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));
      const currentIndex = fields.indexOf(event.currentTarget as HTMLElement);
      focusEditable(fields[currentIndex + 1]);
      flushRowSave(rowId);
      return;
    }
    focusNext(event);
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

        const ledgerDate =
          saved.ledger_date ?? row.sessionLedgerDate ?? currentTrip.date;

        const amounts = shipmentAmountsFromLedgerRow(row);
        await phase15Gateway.shipments.update(shipmentSyntheticId, {
          date: ledgerDate,
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

  const saveRowToServer = async (displayRowId: number, options?: { force?: boolean }) => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    const saveScope = editingScopeRef.current;
    const viewAllBranches = canViewAllLedgerEntriesRef.current && ledgerBranchModeRef.current === 'all';
    const row = rowsRef.current.find((r) => r.id === displayRowId);
    if (!row) return;
    const userBranchId = userRef.current?.branchId ?? userRef.current?.allowedBranchIds?.[0] ?? null;
    const stampedRow = stampRowLedgerScope(row, {
      activeBranchId: branchId,
      trip: currentTrip,
      branchList: branchesRef.current,
      userBranchId,
    });
    if (stampedRow !== row) {
      setRows((prev) => prev.map((entry) => (entry.id === displayRowId ? stampedRow : entry)));
      rowsRef.current = rowsRef.current.map((entry) => (entry.id === displayRowId ? stampedRow : entry));
    }
    const rowScope = resolveRowEditingScope(
      stampedRow,
      viewAllBranches,
      saveScope,
      branchId,
      currentTrip,
      branchesRef.current,
      userBranchId,
    );
    if (!rowScope) {
      if (shouldPersistRow(stampedRow)) {
        showToast('تعذر حفظ السطر — تأكد من اختيار التاريخ وخط المصدر (الخط)', 'error');
      }
      return;
    }
    editingScopeRef.current = rowScope;
    if (!options?.force && receiptEditingRowIdRef.current === displayRowId) return;
    if (!shouldPersistRow(row)) return;
    if (isPersistenceOffline) {
      await markDailyLedgerDraftPending(row.clientRowId, 'لا يوجد اتصال بالسحابة. تم حفظ السطر محلياً.').catch(() => undefined);
      await refreshPendingDraftCount();
      return;
    }
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

    const origin = resolveTripOrigin(rowScope.lineLabel);

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

      const latestFleet = resolveFleetForLedgerRow(
        latestRow,
        currentTrip,
        driversRef.current,
        vehiclesRef.current,
      );
      const latestDriverId = latestRow.sessionDriverId ?? currentTrip.driverId;
      const latestRowNo =
        latestRow.serverRowNo ??
        nextServerRowNoForDriver(rowsRef.current, latestDriverId) ??
        latestRow.id;

      const moneySnapshot = snapshotLedgerMoney(latestRow);

      try {
        const saved = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
          branchId: resolveLedgerBranchId(rowScope.branchId),
          ledgerDate: rowScope.ledgerDate,
          lineLabel: rowScope.lineLabel,
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
          const mapped = prev.map((r) => {
            if (r.id !== displayRowId) return r;
            const moneyStillMatches = ledgerMoneyMatchesSnapshot(r, moneySnapshot);
            const serverCollectLabel = remoteCollectAmountLabel(saved);
            return {
              ...r,
              dbId: saved.id,
              serverRowNo: saved.row_no,
              sessionDriverId: saved.driver_id
                ? syntheticEntityId(saved.driver_id)
                : latestDriverId || r.sessionDriverId,
              sessionId: saved.session_id ?? r.sessionId,
              updatedAt: saved.updated_at,
              postedShipmentId: saved.posted_shipment_id,
              loadedAt: saved.loaded_at,
              ...(moneyStillMatches
                ? {
                    collectAmount: serverCollectLabel || r.collectAmount,
                    prepaidAmount: String(saved.prepaid_amount_usd ?? '') || r.prepaidAmount,
                    receiverCollect: String(saved.hawala_amount_usd ?? '') || r.receiverCollect,
                    transferServiceFee: String(saved.transfer_service_fee_usd ?? '') || r.transferServiceFee,
                  }
                : {}),
              branchBackendId: saved.branch_id ?? r.branchBackendId,
              sessionLedgerDate: saved.ledger_date ?? r.sessionLedgerDate,
              sessionLineLabel: saved.line_label ?? r.sessionLineLabel,
              dispatchId: saved.dispatch_id ?? r.dispatchId,
              dispatchNo: saved.dispatch_no != null ? String(saved.dispatch_no) : r.dispatchNo,
            };
          });
          const savedRow = mapped.find((r) => r.id === displayRowId);
          if (savedRow?.dbId && isRowSavable(savedRow)) {
            return appendTrailingEntrySlot(mapped);
          }
          return mapped;
        });

        if (latestRow.clientRowId) {
          await markDailyLedgerDraftSynced(latestRow.clientRowId, saved.id);
          await refreshPendingDraftCount();
        }
        syncPostedShipmentInBackground(latestRow, saved, currentTrip);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ السطر';
        if (latestRow.clientRowId) {
          await markDailyLedgerDraftPending(latestRow.clientRowId, message).catch(() => undefined);
          await refreshPendingDraftCount();
        }
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
        const next = { ...row, origin };
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
        return mergeRowWithAutoTariff(r, tariffs, cities, branches, goodsTypes, trip.date);
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
    if (ledgerBranchModeRef.current === 'all') {
      showToast(
        'نقل الإرسالية يتم لفرع واحد في كل عملية — حدّد أسطر نفس الفرع فقط (لا تجمع بين حلب والرئيسي مثلاً).',
        'info',
      );
    }
  };

  const exitTransferMode = () => {
    setTransferMode(false);
    setSelectedTransferRowIds([]);
    setTransferDialogOpen(false);
    setTransferValidation({ loading: false, warnings: [], errors: [] });
  };

  const toggleTransferRowSelection = (rowId: number) => {
    setSelectedTransferRowIds((prev) => {
      if (prev.includes(rowId)) return prev.filter((id) => id !== rowId);
      const row = rowsRef.current.find((entry) => entry.id === rowId);
      if (!row?.branchBackendId) return [...prev, rowId];
      const selectedBranchIds = uniqueTransferBranchIds(
        rowsRef.current.filter((entry) => prev.includes(entry.id)),
      );
      if (selectedBranchIds.length > 0 && !selectedBranchIds.includes(row.branchBackendId)) {
        const currentLabel = resolveBranchLabelFromList(branches, selectedBranchIds[0]);
        const nextLabel = row.branchLabel ?? resolveBranchLabelFromList(branches, row.branchBackendId);
        showToast(
          `لا يمكن الجمع بين فروع مختلفة — الأسطر المحددة من «${currentLabel}»، وهذا السطر من «${nextLabel}».`,
          'error',
        );
        return prev;
      }
      return [...prev, rowId];
    });
  };

  const toggleSelectAllTransferable = () => {
    const eligible = transferableVisibleRows;
    if (!eligible.length) return;

    const branchGroups = new Map<string, number[]>();
    for (const row of eligible) {
      const branchKey = row.branchBackendId ?? '__unknown__';
      const bucket = branchGroups.get(branchKey) ?? [];
      bucket.push(row.id);
      branchGroups.set(branchKey, bucket);
    }

    if (branchGroups.size === 1) {
      const ids = eligible.map((row) => row.id);
      setSelectedTransferRowIds((prev) => (prev.length === ids.length ? [] : ids));
      return;
    }

    const activeBackendBranchId = activeBranchIdRef.current
      ? resolveLedgerBranchId(activeBranchIdRef.current)
      : null;
    let targetBranchKey =
      activeBackendBranchId && branchGroups.has(activeBackendBranchId)
        ? activeBackendBranchId
        : [...branchGroups.entries()].sort((left, right) => right[1].length - left[1].length)[0]?.[0];
    const targetIds = branchGroups.get(targetBranchKey ?? '') ?? [];
    const allTargetSelected =
      targetIds.length > 0 &&
      targetIds.every((id) => selectedTransferRowIds.includes(id)) &&
      selectedTransferRowIds.length === targetIds.length;

    if (allTargetSelected) {
      setSelectedTransferRowIds([]);
      return;
    }

    setSelectedTransferRowIds(targetIds);
    const targetLabel =
      targetBranchKey && targetBranchKey !== '__unknown__'
        ? resolveBranchLabelFromList(branches, targetBranchKey)
        : 'فرع غير محدد';
    showToast(
      `تم تحديد ${targetIds.length} سطر من «${targetLabel}» فقط — النقل لا يجمع بين فروع مختلفة.`,
      'info',
    );
  };

  const flushTransferSelectionSaves = async (rowIds: number[]) => {
    Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current = {};
    receiptEditingRowIdRef.current = null;
    setReceiptEditingRowId(null);
    for (const rowId of rowIds) {
      await saveRowToServerRef.current(rowId, { force: true });
    }
  };

  const runTransferValidation = async (dbIds: string[]) => {
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
          postedRowsCount?: number;
          unpostedRowsCount?: number;
          sourceLedgerDate?: string | null;
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

  const openTransferDialog = async () => {
    if (!requirePersistenceConnection('نقل الإرسالية يحتاج اتصالاً بالخادم المحلي أو خادم الشبكة.')) return;
    if (!selectedTransferRowIds.length) {
      showToast('يجب تحديد سطر واحد على الأقل', 'error');
      return;
    }
    const dbIds = selectedTransferRows.map((row) => row.dbId).filter((id): id is string => Boolean(id));
    if (dbIds.length !== selectedTransferRows.length) {
      showToast('بعض الأسطر المحددة غير محفوظة — احفظ الدفتر أولاً قبل النقل', 'error');
      return;
    }
    if (transferSelectionSummary.hasMultipleBranches) {
      showToast(
        `لا يمكن نقل أسطر من فروع مختلفة (${transferSelectionSummary.branchLabels.join('، ')}) — حدّد أسطر فرع واحد.`,
        'error',
      );
      return;
    }
    setTransferReason('');
    setTransferDriverId(trip.driverId || 0);
    setTransferVehicleId(trip.vehicleId || 0);
    setTransferDate(trip.date);
    setTransferDialogOpen(true);
    try {
      await flushTransferSelectionSaves(selectedTransferRowIds);
    } catch {
      showToast('تعذر حفظ بعض التعديلات — راجع الأسطر ثم أعد المحاولة', 'error');
      return;
    }
    await runTransferValidation(dbIds);
  };

  const confirmTransfer = async () => {
    if (!requirePersistenceConnection('تأكيد نقل الإرسالية يحتاج اتصالاً بالخادم المحلي أو خادم الشبكة.')) return;
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
      await flushTransferSelectionSaves(selectedTransferRowIds);
      const result = await httpClient.post<{
        transferNo: string;
        movedRowsCount: number;
        targetSessionId: string;
      }>('/daily-ledger/transfer/confirm', {

        rowIds: dbIds,
        target: {
          ledgerDate: transferDate,
          lineLabel: trip.line || null,
          driverId: driverBackendId,
          vehicleId: vehicleBackendId,
          notes: trip.tripNo || null,
        },
        reason: transferReason.trim(),
      });
      const movedCount = result.movedRowsCount;
      const allOperational =
        (transferValidation.summary?.postedRowsCount ?? 0) > 0 &&
        (transferValidation.summary?.unpostedRowsCount ?? 0) === 0;
      showToast(
        allOperational
          ? `تم نقل ${movedCount} سطر تشغيلياً (${result.transferNo}) — بدون أثر مالي جديد. أعد طباعة الإرساليات المتأثرة.`
          : `تم نقل الإرسالية بنجاح — ${movedCount} سطر (${result.transferNo}). يرجى إعادة طباعة الإرساليات المتأثرة.`,
        'success',
      );
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

    if (isPersistenceOffline && selected.some((row) => row.dbId)) {
      showToast('حذف الصفوف المحفوظة على السحابة يحتاج اتصالاً. يمكنك حذف الصفوف المحلية غير المتزامنة فقط أثناء الانقطاع.', 'error');
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

  const handlePrintHubPrepare = useCallback(() => {
    setDeleteMode(false);
    setSelectedDeleteRowIds([]);
    void resolveCompanyLogoDataUrlForPrint();
  }, []);

  const recordPrintForRows = async (
    printedRows: RemoteDailyLedgerRow[],
    printScopeLabel: string,
  ) => {
    if (isPersistenceOffline) return;
    const bySession = new Map<string, { rowCount: number; piecesCount: number; weightKg: number }>();
    for (const row of printedRows) {
      const sessionId = row.session_id;
      if (!sessionId) continue;
      const agg = bySession.get(sessionId) ?? { rowCount: 0, piecesCount: 0, weightKg: 0 };
      agg.rowCount += 1;
      agg.piecesCount += Number(row.parcel_count) || 0;
      agg.weightKg += parseWeightKg(row.weight_kg ?? '') ?? 0;
      bySession.set(sessionId, agg);
    }
    if (!bySession.size) return;
    const sessions = [...bySession.entries()].map(([sessionId, agg]) => ({ sessionId, ...agg }));
    try {
      await httpClient.post('/daily-ledger/print/record', {
        sessions,
        printType: 'session',
        printScope: printScopeLabel,
      });
    } catch {
      /* تسجيل الطباعة اختياري — لا نُفشل الطباعة بسببه */
    }
  };

  const recordPrintDocumentation = async (input: {
    rows: RemoteDailyLedgerRow[];
    printType: 'shipments' | 'receipts';
    printScopeLabel: string;
    title: string;
    driverLabel: string;
    destinationLabel: string;
    activeSearch: string;
    selectedDriver?: Driver;
    scope: LedgerPrintScope;
    ledgerDate: string;
  }) => {
    if (isPersistenceOffline || !input.rows.length) return;
    const totals = computeTotalsFromRemoteRows(input.rows);
    const branchBackendId = activeBranchIdRef.current
      ? resolveLedgerBranchId(activeBranchIdRef.current)
      : input.rows[0]?.branch_id ?? null;
    const driverBackendId =
      input.selectedDriver
        ? getBackendIdFromSynthetic(input.selectedDriver.id) ?? null
        : input.rows[0]?.driver_id ?? null;
    const { ledgerDate, ledgerDateTo } = resolveDocumentationLedgerDates(input.rows, {
      dateFrom: input.ledgerDate,
      dateTo: input.ledgerDate,
      screenDate: tripRef.current.date,
    });
    try {
      await savePrintDocumentation({
        branchId: branchBackendId,
        ledgerDate,
        ledgerDateTo,
        lineLabel: tripRef.current.line || input.rows[0]?.line_label || null,
        originLabel: input.rows[0]?.origin_label || null,
        driverId: driverBackendId,
        driverLabel: input.driverLabel,
        destinationLabel: input.destinationLabel,
        searchQuery: input.activeSearch || null,
        printType: input.printType,
        printScope: input.printScopeLabel,
        title: input.title,
        rowCount: totals.rowCount,
        piecesCount: totals.piecesCount,
        weightKg: totals.weightKg,
        collectTotalUsd: totals.collectionUsd,
        prepaidTotalUsd: totals.prepaidUsd,
        hawalaTotalUsd: totals.hawalaUsd,
        transferFeeTotalUsd: totals.transferServiceFeeUsd,
        rowsSnapshot: buildPrintRowsSnapshot(input.rows),
      });
    } catch {
      /* حفظ التوثيق اختياري — لا نُفشل الطباعة بسببه */
    }
  };

  const dispatchHtmlPrint = async (html: string, documentType: string) => {
    const preparedHtml = await preparePrintHtmlForOutput(html);
    if (window.printer?.getDefault && window.printer?.print) {
      const defaultPrinter = await window.printer.getDefault();
      if (defaultPrinter.available && defaultPrinter.printer?.name) {
        const result = await window.printer.print({
          documentType,
          printerTarget: defaultPrinter.printer.name,
          copies: 1,
          payloadType: 'html',
          content: preparedHtml,
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

    await printHtmlInBrowser(preparedHtml);
    showToast('تم فتح معاينة الطباعة', 'success');
  };

  const handlePrintHubShipments = useCallback(
    async (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => {
      const printRows = rows.map(remoteRowToPrint);
      const html = buildQuickLedgerPrintHtml(printRows, {
        title: meta.title,
        destinationLabel: meta.destinationLabel,
        driverName: meta.driverLabel,
      });
      await dispatchHtmlPrint(html, 'quick_ledger');
      await recordPrintForRows(rows, `shipments_${meta.scope}`);
      await recordPrintDocumentation({
        rows,
        printType: 'shipments',
        printScopeLabel: `shipments_${meta.scope}`,
        title: meta.title,
        driverLabel: meta.driverLabel,
        destinationLabel: meta.destinationLabel,
        activeSearch: meta.activeSearch,
        selectedDriver: meta.selectedDriver,
        scope: meta.scope,
        ledgerDate: meta.ledgerDate,
      });
      showToast(`تمت طباعة ${rows.length} سطر`, 'success');
    },
    [isPersistenceOffline],
  );

  const handlePrintHubReceipts = useCallback(
    async (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => {
      const html = buildMahmoudPreprintedReceiptHtml(rows.map(mapRemoteLedgerRowToMahmoudReceipt), {
        title: meta.title,
        applyPrintTransform: false,
      });
      await dispatchHtmlPrint(html, 'mahmoud_receipt');
      await recordPrintForRows(rows, `receipts_${meta.scope}`);
      await recordPrintDocumentation({
        rows,
        printType: 'receipts',
        printScopeLabel: `receipts_${meta.scope}`,
        title: meta.title,
        driverLabel: meta.driverLabel,
        destinationLabel: meta.destinationLabel,
        activeSearch: meta.activeSearch,
        selectedDriver: meta.selectedDriver,
        scope: meta.scope,
        ledgerDate: meta.ledgerDate,
      });
      showToast(`تمت طباعة ${rows.length} إيصال`, 'success');
    },
    [isPersistenceOffline],
  );

  const handlePrintHubDestinationPdf = useCallback(
    async (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => {
      if (!rows.length) {
        showToast('لا توجد أسطر متاحة للتصدير', 'info');
        return;
      }

      const destinations = [
        ...new Set(rows.map((row) => normalizeName(row.destination ?? '')).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, 'ar'));

      let exported = 0;
      for (const destination of destinations) {
        const destRows = rows.filter((row) => normalizeName(row.destination ?? '') === destination);
        if (!destRows.length) continue;

        const printRows = destRows.map(remoteRowToPrint);
        const html = buildQuickLedgerPrintHtml(printRows, {
          title: `${meta.title} — ${destination}`,
          destinationLabel: destination,
          driverName: meta.driverLabel,
        });

        const safeDestination = destination.replace(/[\\/:*?"<>|]+/g, '-');
        const safeLine = (meta.lineLabel || 'line').replace(/[\\/:*?"<>|]+/g, '-');
        await exportLedgerStylePdf({
          title: `دفتر الشحن اليومي — ${destination} — ${meta.ledgerDate}`,
          html,
          defaultFileName: `daily-ledger-${safeLine}-${safeDestination}-${meta.ledgerDate}.pdf`,
          landscape: false,
        });
        exported += 1;
      }

      showToast(
        exported === 1 ? 'تم تصدير ملف PDF' : `تم تصدير ${exported} ملفات PDF`,
        'success',
      );
    },
    [showToast],
  );

  const logRowContext = (row: LedgerRow) => ({
    rowLabel: rowProgressLabel(row),
    receiptNo: row.receiptNo,
    destination: row.destination,
  });

  const patchSaveItem = (key: string, patch: Partial<SaveProgressItem>) => {
    setSaveProgress((prev) => applySaveProgressItemPatch(prev, key, patch));
  };

  const saveRows = async (options: SaveBatchOptions = { mode: 'all' }) => {
    if (isLocalPersistenceNode !== true && !requireCloudConnection('حفظ الشحنات على السحابة يحتاج اتصالاً. ستبقى الصفوف محفوظة محلياً بانتظار المزامنة.')) {
      return;
    }
    if (!activeBranchId) {
      showToast('يرجى اختيار الفرع قبل حفظ الشحنات', 'error');
      return;
    }
    if (!trip.line?.trim()) {
      showToast('يرجى اختيار الخط / المصدر أولاً', 'error');
      return;
    }
    const saveMode = options.mode ?? 'all';
    const targetLedgerDate = options.targetDate ?? trip.date;
    const saveScope = {
      branchId: activeBranchId,
      ledgerDate: targetLedgerDate,
      lineLabel: trip.line,
    };
    const saveBranchId = resolveLedgerBranchId(saveScope.branchId);
    const origin = resolveTripOrigin(saveScope.lineLabel);
    if (!origin) {
      showToast('يرجى اختيار الخط / المصدر أولاً', 'error');
      return;
    }

    const batchId = quickLedgerLog.startBatch({
      ledgerDate: saveScope.ledgerDate,
      lineLabel: saveScope.lineLabel,
      branchId: saveBranchId,
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
      const savingToAlternateDate = targetLedgerDate !== trip.date;
      if (savingToAlternateDate) {
        Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
        saveTimersRef.current = {};
        receiptEditingRowIdRef.current = null;
        setReceiptEditingRowId(null);
      } else {
        await flushPendingRowSaves();
      }

      const currentRows = rowsRef.current;
      const batchRows = currentRows;
      let rowsToPost = batchRows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
      if (options.displayRowIds?.length) {
        const selected = new Set(options.displayRowIds);
        rowsToPost = rowsToPost.filter((row) => selected.has(row.id));
      }
      const alreadyPostedCount = batchRows.filter(
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
        const message = describeReceiptConflict(batchRows, batchDup.row, batchDup.other);
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
      const postedDup = findReceiptConflictWithPosted(rowsToPost, batchRows);
      if (postedDup) {
        const message = describeReceiptConflict(batchRows, postedDup.row, postedDup.other);
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
      const unpostedDup = findReceiptConflictWithUnposted(rowsToPost, batchRows);
      if (unpostedDup) {
        const message = describeReceiptConflict(batchRows, unpostedDup.row, unpostedDup.other);
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
        if (options.overrideFleet?.driverId) return false;
        const fleet = resolveFleetForLedgerRow(row, trip, drivers, vehicles);
        return !fleet.driverId;
      });
      if (rowsMissingDriver.length) {
        const message =
          'يرجى اختيار السائق من أعلى الدفتر أو التأكد أن السطر مرتبط بسائق — مطلوب لحفظ الشحنات الجديدة.';
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

      let activeDispatch: Awaited<ReturnType<typeof dailyLedgerDispatchGateway.create>> | null = null;
      try {
        const dispatchList = await dailyLedgerDispatchGateway.list({
          branchId: saveBranchId,
          ledgerDate: targetLedgerDate,
          lineLabel: saveScope.lineLabel,
          suggestNext: true,
        });
        const sampleRow = rowsToPost[0];
        const sampleFleet = options.overrideFleet
          ?? (sampleRow ? resolveFleetForLedgerRow(sampleRow, trip, drivers, vehicles) : null);
        activeDispatch = await dailyLedgerDispatchGateway.create({
          branchId: saveBranchId,
          ledgerDate: targetLedgerDate,
          lineLabel: saveScope.lineLabel,
          dispatchNo: dispatchList.nextDispatchNo ?? 1,
          driverId: sampleFleet?.driverId ?? null,
          vehicleId: sampleFleet?.vehicleId ?? null,
          driverLabel: sampleFleet?.driverLabel ?? null,
          vehicleLabel: sampleFleet?.vehicleLabel ?? null,
          tripNo: trip.tripNo || null,
          notes: saveMode === 'custom' ? 'حفظ مخصص' : 'حفظ الكل',
        });
      } catch (dispatchError) {
        const message =
          dispatchError instanceof Error ? dispatchError.message : 'تعذر إنشاء تعريف الإرسالية';
        quickLedgerLog.log('error', 'dispatch', message);
        failBatch('فشل إنشاء تعريف الإرسالية', message, progressItems, { targetLedgerDate });
        return;
      }

      const dispatchIdForSave = activeDispatch.id;

      let workingRows = [...currentRows];
      const upsertedRowIds: string[] = [];
      const savedDbIdByDisplayId = new Map<number, string>();
      let progressSnapshot = progressItems;
      for (let index = 0; index < rowsToPost.length; index += 1) {
        const row = rowsToPost[index];
        const itemKey = String(row.id);

        patchSaveItem(itemKey, { status: 'running', message: 'جاري الحفظ...' });
        setSaveProgress((prev) => ({
          ...prev,
          phaseLabel: resumeMode
            ? `استكمال الحفظ في الدفتر (${index + 1} / ${rowsToPost.length})...`
            : `حفظ الأسطر في الدفتر (${index + 1} / ${rowsToPost.length})...`,
        }));

        const fleet = options.overrideFleet ?? resolveFleetForLedgerRow(row, trip, drivers, vehicles);
        const effectiveDriverId = options.overrideFleet?.driverId
          ? drivers.find((driver) => getBackendIdFromSynthetic(driver.id) === options.overrideFleet?.driverId)?.id
          : (row.sessionDriverId ?? trip.driverId);
        const rowNo =
          row.serverRowNo ?? nextServerRowNoForDriver(workingRows, effectiveDriverId ?? trip.driverId) ?? row.id;
        try {
          const saved = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
            branchId: saveBranchId,
            ledgerDate: targetLedgerDate,
            lineLabel: saveScope.lineLabel,
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
            dispatchId: dispatchIdForSave,
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
                    : (effectiveDriverId ?? trip.driverId ?? r.sessionDriverId),
                  sessionId: saved.session_id ?? r.sessionId,
                  dispatchId: saved.dispatch_id ?? activeDispatch?.id ?? r.dispatchId,
                  dispatchNo:
                    saved.dispatch_no != null
                      ? String(saved.dispatch_no)
                      : activeDispatch?.dispatch_no != null
                        ? String(activeDispatch.dispatch_no)
                        : r.dispatchNo,
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
        pendingCentral?: boolean;
        operationId?: string;
        queuedRowIds?: string[];
      }>('/daily-ledger/rows/post-shipments', {
        branchId: saveBranchId,
        ledgerDate: targetLedgerDate,
        lineLabel: saveScope.lineLabel,
        rowIds: upsertedRowIds,
      });

      if (result.pendingCentral) {
        for (const row of rowsToPost) patchSaveItem(String(row.id), { status: 'saved', message: 'محفوظ محلياً — بانتظار تأكيد المركز' });
        const summary = `حُفظ ${rowsToPost.length} سطر محلياً، والترحيل المركزي قيد الانتظار.`;
        quickLedgerLog.endBatch('success', summary, { operationId: result.operationId, pendingCentral: true });
        setSaveProgress((prev) => ({ ...prev, phase: 'done', phaseLabel: 'محفوظ محلياً — بانتظار تأكيد المركز', summary, completedCount: prev.totalCount, finishedAt: new Date().toISOString() }));
        showToast(summary, 'info');
        return;
      }

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
        persistFailedSaveRows(saveScope.ledgerDate, saveScope.lineLabel, next);
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
            ? `تم استكمال ترحيل ${result.posted.length} شحنة بتاريخ ${saveScope.ledgerDate} — ستظهر في قائمة الشحنات (تحميل/تسليم) والذمم في قسم المالية (وكلاء/عملاء).`
            : savingToAlternateDate
              ? `تم ترحيل ${result.posted.length} شحنة بتاريخ ${saveScope.ledgerDate} — نُقلت من تاريخ العرض (${trip.date}).`
              : `تم ترحيل ${result.posted.length} شحنة بتاريخ ${saveScope.ledgerDate} — متاحة الآن في قائمة الشحنات والذمم المالية.`,
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

      const postedLedgerRows = rowsToPost.filter((row) => {
        const dbId = savedDbIdByDisplayId.get(row.id) ?? row.dbId;
        return dbId ? postedByRowId.has(dbId) : false;
      });
      if (postedLedgerRows.length || rowsToPost.length) {
        try {
          const snapshot = buildDispatchSaveSnapshotFromLedgerRows(
            postedLedgerRows.length ? postedLedgerRows : rowsToPost,
            savedDbIdByDisplayId,
            activeDispatch?.dispatch_no,
            targetLedgerDate,
            drivers,
            trip,
          );
          const totals = computeDispatchSaveTotals(snapshot);
          const fleetMeta = options.overrideFleet
            ?? (postedLedgerRows[0]
              ? resolveFleetForLedgerRow(postedLedgerRows[0], trip, drivers, vehicles)
              : rowsToPost[0]
                ? resolveFleetForLedgerRow(rowsToPost[0], trip, drivers, vehicles)
                : null);
          const saveLog = await createDispatchSaveLog({
            branchId: saveBranchId,
            dispatchId: activeDispatch?.id ?? null,
            dispatchNo: activeDispatch?.dispatch_no ?? null,
            ledgerDate: targetLedgerDate,
            lineLabel: saveScope.lineLabel,
            originLabel: origin,
            driverId: fleetMeta?.driverId ?? null,
            vehicleId: fleetMeta?.vehicleId ?? null,
            driverLabel: fleetMeta?.driverLabel ?? null,
            vehicleLabel: fleetMeta?.vehicleLabel ?? null,
            tripNo: trip.tripNo || null,
            destinationLabel: uniqueDestinationLabel(snapshot),
            saveMode,
            rowCount: totals.rowCount,
            piecesCount: totals.piecesCount,
            weightKg: totals.weightKg,
            collectTotalUsd: totals.collectTotalUsd,
            prepaidTotalUsd: totals.prepaidTotalUsd,
            hawalaTotalUsd: totals.hawalaTotalUsd,
            transferFeeTotalUsd: totals.transferFeeTotalUsd,
            postedCount: result.posted.length,
            errorCount: result.errors.length,
            skippedCount: result.skipped.length,
            receiptNos: snapshot.map((row) => row.receiptNo).filter((value): value is string => Boolean(value)),
            rowIds: upsertedRowIds,
            rowsSnapshot: snapshot,
            outcome,
            summary,
          });
          if (result.posted.length) {
            setPostSavePrintContext({
              dispatchNo: activeDispatch?.dispatch_no ?? saveLog.dispatch_no,
              driverLabel: fleetMeta?.driverLabel ?? trip.driver ?? '—',
              destinationLabel: uniqueDestinationLabel(snapshot),
              printRows: dispatchSaveSnapshotToPrintRows(
                snapshot.filter((row) => postedByRowId.has(row.rowId)),
              ),
              saveLogId: saveLog.id,
              ledgerDate: targetLedgerDate,
              lineLabel: saveScope.lineLabel,
              branchId: saveBranchId,
            });
            setPostSavePrintOpen(true);
          }
        } catch (logError) {
          quickLedgerLog.log(
            'warn',
            'dispatch-save-log',
            logError instanceof Error ? logError.message : 'تعذر حفظ سجل الإرسالية',
          );
        }
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

  const handleGlobalSearchSelect = async (row: RemoteDailyLedgerRow) => {
    setGlobalSearchOpen(false);
    pendingFocusDbRowIdRef.current = row.id;
    const targetDate = String(row.ledger_date ?? '').slice(0, 10);
    const targetLine = row.line_label ?? tripRef.current.line;
    if (row.branch_id) {
      setLedgerBranchMode('single');
      await setActiveBranch(row.branch_id);
    }
    const nextTrip = {
      ...tripRef.current,
      date: targetDate || tripRef.current.date,
      line: targetLine || tripRef.current.line,
    };
    tripRef.current = nextTrip;
    setTrip(nextTrip);
    setRemoteLoading(true);
    await loadRemoteRows();
  };

  const handleCustomSaveSubmit = (input: CustomSaveSubmit) => {
    setCustomSaveOpen(false);
    const fleet = resolveCustomSaveFleet(input.driverId, input.vehicleId, drivers, vehicles);
    void saveRows({
      mode: 'custom',
      displayRowIds: input.rowIds,
      targetDate: input.targetDate,
      overrideFleet: fleet,
    });
  };

  const handlePostSavePrintConfirm = async () => {
    if (!postSavePrintContext) return;
    setPostSavePrinting(true);
    try {
      const ctx = postSavePrintContext;
      const html = buildQuickLedgerPrintHtml(ctx.printRows, {
        title: 'قائمة الشحنات — إرسالية محفوظة',
        destinationLabel: ctx.destinationLabel,
        driverName: ctx.driverLabel,
      });
      await dispatchHtmlPrint(html, 'quick_ledger');
      try {
        const doc = await savePrintDocumentation({
          branchId: ctx.branchId,
          ledgerDate: ctx.ledgerDate,
          lineLabel: ctx.lineLabel,
          driverLabel: ctx.driverLabel,
          destinationLabel: ctx.destinationLabel,
          printType: 'shipments',
          printScope: 'dispatch_save',
          title: `إرسالية ${ctx.dispatchNo != null ? `#${ctx.dispatchNo}` : ''}`,
          rowCount: ctx.printRows.length,
          piecesCount: ctx.printRows.reduce((sum, row) => sum + (Number(row.parcelCount) || 0), 0),
          weightKg: ctx.printRows.reduce((sum, row) => sum + (Number(String(row.weightKg).replace(/[^\d.-]/g, '')) || 0), 0),
          collectTotalUsd: ctx.printRows.reduce((sum, row) => sum + (Number(String(row.collectAmount).replace(/[^\d.-]/g, '')) || 0), 0),
          prepaidTotalUsd: ctx.printRows.reduce((sum, row) => sum + (Number(String(row.prepaidAmount).replace(/[^\d.-]/g, '')) || 0), 0),
          hawalaTotalUsd: ctx.printRows.reduce((sum, row) => sum + (Number(String(row.hawalaAmount).replace(/[^\d.-]/g, '')) || 0), 0),
          transferFeeTotalUsd: ctx.printRows.reduce((sum, row) => sum + (Number(String(row.transferServiceFee).replace(/[^\d.-]/g, '')) || 0), 0),
          rowsSnapshot: ctx.printRows.map((row, index) => ({
            rowId: ctx.saveLogId ?? `local-${index}`,
            rowNo: index + 1,
            receiptNo: row.receiptNo || null,
            destination: row.destination,
            parcelType: row.parcelType,
            parcelCount: Number(row.parcelCount) || null,
            weightKg: row.weightKg || null,
            senderName: row.sender,
            receiverName: row.receiver,
            collectAmountUsd: row.collectAmount,
            prepaidAmountUsd: row.prepaidAmount,
            hawalaAmountUsd: row.hawalaAmount,
            transferServiceFeeUsd: row.transferServiceFee,
            notes: row.notes || null,
            driverLabel: ctx.driverLabel,
            sessionId: null,
            ledgerDate: ctx.ledgerDate,
          })),
        });
        if (ctx.saveLogId) {
          await markDispatchSavePrinted(ctx.saveLogId, { printDocumentId: doc.id });
        }
      } catch {
        /* توثيق الطباعة اختياري */
      }
      setPostSavePrintOpen(false);
      setPostSavePrintContext(null);
    } finally {
      setPostSavePrinting(false);
    }
  };

  const handleReprintDispatchSaveLog = async (detail: DispatchSaveLogDetail) => {
    const printRows = dispatchSaveSnapshotToPrintRows(detail.rows_snapshot ?? []);
    const html = buildQuickLedgerPrintHtml(printRows, {
      title: `إرسالية ${detail.dispatch_no != null ? `#${detail.dispatch_no}` : ''}`,
      destinationLabel: detail.destination_label ?? '—',
      driverName: detail.driver_label ?? '—',
    });
    await dispatchHtmlPrint(html, 'quick_ledger');
  };

  useEffect(() => {
    if (!saveMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (saveMenuRef.current?.contains(target)) return;
      setSaveMenuOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [saveMenuOpen]);
  const selectedDeleteHasServerRows = rows.some((row) => selectedDeleteRowIds.includes(row.id) && Boolean(row.dbId));

  return (
    <div className="quick-ledger-page" dir="rtl">
      <button
        type="button"
        className="quick-ledger-help-btn"
        onClick={openAgentHelp}
        title="اختصارات الوكلاء — ارقام الجهة (مثل 9 للرقة)"
        aria-label="اختصارات الوكلاء"
      >
        <HelpCircle size={22} />
      </button>

      <header className="quick-ledger-header">
        <section className="quick-ledger-toolbar" aria-label="أدوات الدفتر">
          <h2 className="quick-ledger-title">دفتر الشحن اليومي</h2>
          <div className="quick-ledger-actions">
            {canViewAllLedgerEntries && (
              <button
                type="button"
                className={`quick-ledger-all-branches-btn${ledgerBranchMode === 'all' ? ' is-active' : ''}`}
                onClick={() => {
                  setLedgerBranchMode('all');
                  setBranchSearch('كل الفروع');
                }}
                title="عرض إدخالات كل فروع الشركة لنفس التاريخ"
              >
                كل الفروع
              </button>
            )}
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
            {canLedgerViewLoaded ? (
              <label className="quick-ledger-print-toggle">
                <input type="checkbox" checked={includeLoaded} onChange={(e) => setIncludeLoaded(e.target.checked)} />
                إظهار المحمّلة
              </label>
            ) : null}
            <QuickLedgerPrintHub
              ref={printHubRef}
              ledgerDate={trip.date}
              lineLabel={trip.line}
              lineOptions={lineOptions}
              branches={branches}
              canPickBranch={canPickDispatchBranch}
              preferredBranchId={dispatchPreferredBranchId}
              lockedBranchId={dispatchLockedBranchId}
              canViewAllBranches={canViewAllLedgerEntries && ledgerBranchMode === 'all'}
              includeLoaded={includeLoaded}
              searchQuick=""
              catalogAgents={catalogAgents}
              remoteRowsRaw={remoteRowsRaw}
              drivers={drivers}
              vehicles={vehicles}
              canExportPdf={canLedgerExportPdf}
              canPickFutureDate={canPickFutureDate}
              canPickHistoricalDate={canPickHistoricalDate}
              todayIso={todayIso}
              currentTripDriverId={trip.driverId}
              disabled={isPersistenceOffline}
              onPrintShipments={handlePrintHubShipments}
              onPrintReceipts={handlePrintHubReceipts}
              onExportDestinationPdf={canLedgerExportPdf ? handlePrintHubDestinationPdf : undefined}
              onToast={showToast}
              onPreparePrint={handlePrintHubPrepare}
            />
            {canLedgerTransfer ? (
              transferMode ? (
                <>
                  <button type="button" onClick={exitTransferMode} disabled={transferring}>
                    إلغاء النقل
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      transferring ||
                      isPersistenceOffline ||
                      !selectedTransferRowIds.length ||
                      transferSelectionSummary.hasMultipleBranches
                    }
                    onClick={() => void openTransferDialog()}
                  >
                    <Truck size={16} />
                    {`تأكيد نقل (${selectedTransferRowIds.length})`}
                  </button>
                </>
              ) : canLedgerDeleteRows && deleteMode ? null : !deleteMode ? (
                <button type="button" onClick={enterTransferMode} disabled={isPersistenceOffline}>
                  <Truck size={16} />
                  نقل إرسالية
                </button>
              ) : null
            ) : null}
            {canLedgerDeleteRows ? (
              deleteMode ? (
                <>
                  <button type="button" onClick={exitDeleteMode} disabled={deletingRows}>
                    إلغاء التحديد
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={deletingRows || !selectedDeleteRowIds.length || (isPersistenceOffline && selectedDeleteHasServerRows)}
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 size={16} />
                    {deletingRows ? 'جاري الحذف...' : `حذف (${selectedDeleteRowIds.length})`}
                  </button>
                </>
              ) : !transferMode ? (
                <button type="button" className="danger" onClick={() => setDeleteMode(true)}>
                  <Trash2 size={16} />
                  حذف أسطر
                </button>
              ) : null
            ) : null}
            {canLedgerCloseSection ? (
              <button type="button" onClick={() => setCloseConfirmOpen(true)}>
                إغلاق القسم
              </button>
            ) : null}
            {canLedgerDispatchSaveLog ? (
              <button
                type="button"
                onClick={() => setDispatchSaveLogOpen(true)}
                title="سجل حفظ إرساليات — مرجع للمدير والمحاسبة"
              >
                <FileText size={16} />
                سجل حفظ إرساليات
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDuplicatesOpen(true)}
              title="فحص إيصالات مكررة — نفس اليوم أو عبر التواريخ"
            >
              <Copy size={16} />
              أسطر مكررة
            </button>
            {canLedgerSaveLog ? (
              <button type="button" onClick={() => quickLedgerLog.download()} title="تنزيل سجل عمليات دفتر الشحن">
                <ScrollText size={16} />
                سجل الحفظ
              </button>
            ) : null}
            {canLedgerPostShipments ? (
              <div
                ref={saveMenuRef}
                className={`quick-ledger-save-menu${saveMenuOpen ? ' is-open' : ''}`}
              >
                <button
                  type="button"
                  className="primary quick-ledger-save-menu-trigger"
                  onClick={() => setSaveMenuOpen((open) => !open)}
                  disabled={saving || loadingRefs || (isCloudOffline && isLocalPersistenceNode !== true)}
                  aria-haspopup="menu"
                  aria-expanded={saveMenuOpen}
                  title={
                    isCloudOffline
                      ? isLocalPersistenceNode === true ? 'سيُحفظ محلياً ويُرحّل عند عودة اتصال المركز.' : 'الحفظ على السحابة يحتاج اتصالاً. الصفوف المحلية بانتظار المزامنة.'
                      : 'اختر نوع الحفظ — حفظ الكل أو حفظ مخصص'
                  }
                >
                  <Save size={16} />
                  {saving ? 'جاري الحفظ...' : 'حفظ الشحنات'}
                  <ChevronDown size={16} className={saveMenuOpen ? 'is-open' : ''} aria-hidden />
                </button>
                {saveMenuOpen ? (
                  <div className="quick-ledger-save-menu-dropdown" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSaveMenuOpen(false);
                        void saveRows({ mode: 'all' });
                      }}
                    >
                      حفظ الكل
                      {stats.complete > 0 ? ` (${stats.complete} سطر)` : ''}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSaveMenuOpen(false);
                        setCustomSaveOpen(true);
                      }}
                    >
                      حفظ مخصص...
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <ShippingSyncIndicator fallbackStatus={cloudStatus} pendingDrafts={pendingLocalDraftCount} />
          </div>
        </section>

        <section className="quick-ledger-trip" aria-label="بيانات الرحلة">
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
              className={isBackdateMode ? 'is-backdate' : isFutureDateMode ? 'is-future' : undefined}
              value={trip.date}
              max={canPickFutureDate ? undefined : todayIso}
              min={canPickHistoricalDate ? undefined : todayIso}
              title={
                isBackdateMode
                  ? 'تصحيح على تاريخ سابق'
                  : isFutureDateMode
                    ? 'دفتر بتاريخ مستقبلي — شحنات محمّلة اليوم ومسافرة لاحقاً'
                    : canPickHistoricalDate && canPickFutureDate
                      ? 'يمكن اختيار تاريخ سابق أو مستقبل حسب الصلاحية'
                      : canPickHistoricalDate
                        ? 'يمكن اختيار تواريخ سابقة'
                        : canPickFutureDate
                          ? 'يمكن اختيار تاريخ مستقبلي'
                          : undefined
              }
              onChange={(e) => {
                const next = e.target.value;
                if (!canPickHistoricalDate && next < todayIso) {
                  showToast('لا يمكن اختيار تاريخ سابق — يلزم صلاحية تعديل تاريخ الدفتر', 'info');
                  setTrip((prev) => ({ ...prev, date: todayIso }));
                  return;
                }
                if (!canPickFutureDate && next > todayIso) {
                  showToast('لا يمكن اختيار تاريخ مستقبلي — يلزم صلاحية تاريخ مستقبلي لدفتر الشحن', 'error');
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
          <label className="quick-ledger-trip-search">
            <span>الفرع</span>
            <div className="quick-ledger-search">
              <Search size={14} />
              <input
                list="ledger-branch-list"
                placeholder={canViewAllLedgerEntries ? 'كل الفروع أو فرع' : 'الفرع'}
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                disabled={isBranchLocked}
                onKeyDown={(e) => {
                  if (isBranchLocked) return;
                  if (e.key !== 'Enter') return;
                  const needle = normalizeName(branchSearch);
                  if (!needle) return;
                  if (canViewAllLedgerEntries && (needle === 'كل الفروع' || needle.includes('كل الفروع'))) {
                    setLedgerBranchMode('all');
                    setBranchSearch('كل الفروع');
                    return;
                  }
                  const found =
                    branchChoices.find((b) => normalizeName(b.name) === needle) ??
                    branchChoices.find((b) => normalizeName(b.name).includes(needle));
                  const backendId = found ? getBackendIdFromSynthetic(found.id) : undefined;
                  if (backendId) {
                    setLedgerBranchMode('single');
                    void setActiveBranch(backendId);
                    setBranchSearch(found!.name);
                  }
                }}
                onBlur={() => {
                  if (isBranchLocked) return;
                  const needle = normalizeName(branchSearch);
                  if (!needle) return;
                  if (canViewAllLedgerEntries && (needle === 'كل الفروع' || needle.includes('كل الفروع'))) {
                    setLedgerBranchMode('all');
                    setBranchSearch('كل الفروع');
                    return;
                  }
                  const found =
                    branchChoices.find((b) => normalizeName(b.name) === needle) ??
                    branchChoices.find((b) => normalizeName(b.name).includes(needle));
                  const backendId = found ? getBackendIdFromSynthetic(found.id) : undefined;
                  if (backendId) {
                    setLedgerBranchMode('single');
                    void setActiveBranch(backendId);
                    setBranchSearch(found!.name);
                  }
                }}
              />
            </div>
          </label>
          <datalist id="ledger-branch-list">
            {canViewAllLedgerEntries && <option value="كل الفروع" />}
            {branchChoices.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
          <label className="quick-ledger-trip-search quick-ledger-page-search-field">
            <span>بحث في الصفحة</span>
            <div className="quick-ledger-page-search-row">
              <Search size={16} aria-hidden />
              <input
                value={pageSearchQuery}
                onChange={(e) => setPageSearchQuery(e.target.value)}
                placeholder="جهة، مرسل، مستلم، رقم إيصال — أسطر هذه الصفحة فقط..."
                title="يبحث فقط ضمن الأسطر المعروضة حالياً في هذه الصفحة"
              />
              {pageSearchQuery.trim() ? (
                <button
                  type="button"
                  className="quick-ledger-page-search-clear"
                  onClick={() => setPageSearchQuery('')}
                  aria-label="مسح البحث"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </label>
          <label className="quick-ledger-trip-search quick-ledger-global-search-field">
            <span>بحث شامل</span>
            <button
              type="button"
              className="quick-ledger-global-search-trigger"
              onClick={() => {
                setGlobalSearchSeed('');
                setGlobalSearchOpen(true);
              }}
              title="بحث في كل التواريخ — مرسل، مستلم، إشعار/إيصال، نوع بضاعة"
            >
              <Search size={16} />
              <span>مرسل · مستلم · إشعار/إيصال · نوع بضاعة — كل التواريخ...</span>
            </button>
          </label>
          {canViewAllLedgerEntries ? (
            <span
              className="quick-ledger-scope-chip"
              title={
                ledgerBranchMode === 'all'
                  ? 'وضع المدير — كل فروع الشركة لنفس التاريخ'
                  : `وضع المدير — فرع ${activeBranchDisplayName}`
              }
            >
              {activeBranchDisplayName}
              {' · '}
              {remoteLoading ? '…' : `${remoteSyncedCount} سطر`}
            </span>
          ) : null}
          {reprintRequired ? (
            <span className="quick-ledger-scope-chip is-warn" title="تم تعديل الإرسالية بعد الطباعة">
              أعد الطباعة
            </span>
          ) : null}
        </section>
      </header>

      <section className="quick-ledger-stats">
        {stats.searchActive && (
          <div className="quick-ledger-stat-filter">
            <strong>محصلات البحث</strong>
            <span>«{stats.searchLabel}»</span>
          </div>
        )}
        <div><strong>{stats.rowCount}</strong><span>{stats.searchActive ? 'أسطر البحث' : 'عدد الأسطر'}</span></div>
        <div><strong>USD {formatUsdAmount(stats.collectionUsd)}</strong><span>التحصيل</span></div>
        <div><strong>USD {formatUsdAmount(stats.prepaidUsd)}</strong><span>دفع مسبق</span></div>
        <div><strong>USD {formatUsdAmount(stats.hawalaUsd)}</strong><span>حوالة</span></div>
        <div><strong>USD {formatUsdAmount(stats.transferFeeUsd)}</strong><span>أجور الحوالة</span></div>
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

      {transferMode && canLedgerTransfer && (
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
            {transferSelectionSummary.branchLabels.length === 1 && (
              <span>الفرع: <strong>{transferSelectionSummary.branchLabels[0]}</strong></span>
            )}
            {transferSelectionSummary.hasMultipleBranches && (
              <span className="quick-ledger-transfer-branch-error">
                فروع متعددة ({transferSelectionSummary.branchLabels.join('، ')}) — لا يمكن النقل
              </span>
            )}
          </div>
          <p className="quick-ledger-hint">
            {transferSelectionSummary.hasMultipleBranches
              ? 'أزل التحديد عن أسطر الفروع الأخرى — كل عملية نقل لفرع واحد فقط.'
              : 'حدّد الأسطر المراد نقلها إلى سائق/مركبة/تاريخ آخر. الأسطر المحمّلة على بيان غير قابلة للنقل.'}
          </p>
        </section>
      )}

      <section className="quick-ledger-table-shell">
        <table className="quick-ledger-table">
          <thead>
            <tr>
              {((deleteMode && canLedgerDeleteRows) || (transferMode && canLedgerTransfer)) && (
                <th className="quick-ledger-select-col">
                  {deleteMode && canLedgerDeleteRows ? (
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
              <th className="col-parcel-type">نوع البضاعة</th>
              <th className="col-parcel-count">عدد الطرود</th>
              <th className="col-weight">الوزن كغ</th>
              <th className="col-money" title="يُملأ تلقائياً من تعريف الأسعار (مسار + نوع الطرد + وزن)؛ يمكنك التعديل يدوياً">تحصيل $</th>
              <th className="col-money">حوالة</th>
              <th className="col-money">أجرة الحوالة</th>
              <th className="col-money">دفع مسبق $</th>
              <th className="wide col-sender">المرسل</th>
              <th className="wide col-receiver">المرسل إليه</th>
              {destinationSort === 'asc' ? (
                <th
                  className="quick-ledger-sortable-th is-sorted col-dest"
                  onClick={cycleDestinationSort}
                  title="ترتيب تنازلي حسب الجهة"
                  aria-sort="ascending"
                >
                  <span className="quick-ledger-sortable-th-inner">
                    الجهة
                    <ArrowUp size={14} aria-hidden />
                  </span>
                </th>
              ) : destinationSort === 'desc' ? (
                <th
                  className="quick-ledger-sortable-th is-sorted col-dest"
                  onClick={cycleDestinationSort}
                  title="إلغاء الترتيب — العودة للترتيب الأصلي"
                  aria-sort="descending"
                >
                  <span className="quick-ledger-sortable-th-inner">
                    الجهة
                    <ArrowDown size={14} aria-hidden />
                  </span>
                </th>
              ) : (
                <th
                  className="quick-ledger-sortable-th col-dest"
                  onClick={cycleDestinationSort}
                  title="ترتيب تصاعدي حسب الجهة"
                  aria-sort="none"
                >
                  <span className="quick-ledger-sortable-th-inner">
                    الجهة
                    <ArrowUpDown size={14} aria-hidden className="quick-ledger-sort-icon-muted" />
                  </span>
                </th>
              )}
              <th className="col-receipt">رقم الإيصال</th>
              <th className="notes col-notes">ملاحظات</th>
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
                locked ? 'saved' : posted ? 'ledger-row-posted started' : activeRowId === row.id ? 'active' : started ? 'started' : '',
                issueRowIds.has(row.id) ? 'ledger-row-error' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={row.id} className={rowClassName} title={rowIssue} data-ledger-row-id={row.id}>
                  {deleteMode && canLedgerDeleteRows && (
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
                  {transferMode && canLedgerTransfer && (
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
                  <td className="quick-ledger-parcel-cell col-parcel-type">
                    <AutocompleteInput
                      value={row.parcelType}
                      onChange={(v) => updateRow(row.id, 'parcelType', v, true)}
                      onSelect={(item) => {
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? mergeRowWithAutoTariff(
                                  { ...r, parcelType: item.name },
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
                                        { ...rr, parcelType: normalized },
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
                              { ...r, parcelType: matched.name },
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
                      title="عدد الطرود"
                      aria-label="عدد الطرود"
                      value={row.parcelCount}
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onChange={(e) => updateRow(row.id, 'parcelCount', e.target.value)}
                      onBlur={() => flushRowSave(row.id)}
                    />
                  </td>
                  <td className="col-weight">
                    <input
                      data-ledger-field="true"
                      inputMode="decimal"
                      title="الوزن"
                      aria-label="الوزن"
                      value={row.weightKg}
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onBlur={() => recalcTariffCollectForRowId(row.id)}
                      onChange={(e) => updateRow(row.id, 'weightKg', e.target.value, true)}
                    />
                  </td>
                  <td className="col-money"><input data-ledger-field="true" inputMode="decimal" value={row.collectAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'collectAmount', e.target.value)} /></td>
                  <td className="col-money"><input data-ledger-field="true" inputMode="decimal" value={row.receiverCollect} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'receiverCollect', e.target.value)} /></td>
                  <td className="col-money"><input data-ledger-field="true" inputMode="decimal" value={row.transferServiceFee} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'transferServiceFee', e.target.value)} /></td>
                  <td className="col-money"><input data-ledger-field="true" inputMode="decimal" value={row.prepaidAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onBlur={() => flushRowSave(row.id)} onChange={(e) => updateRow(row.id, 'prepaidAmount', e.target.value)} /></td>
                  <td className="col-sender">
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
                  <td className="col-receiver">
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
                  <td className="quick-ledger-dest-cell col-dest">
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
                  <td className="col-receipt">
                    <input
                      className={duplicateReceiptRowIds.has(row.id) ? 'ledger-receipt-duplicate' : undefined}
                      data-ledger-field="true"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={row.receiptNo}
                      disabled={locked}
                      onFocus={() => {
                        setActiveRowId(row.id);
                        setReceiptEditingRowId(row.id);
                      }}
                      onKeyDown={(e) => handleReceiptKeyDown(e, row.id)}
                      onBlur={() => commitReceiptNoCell(row.id)}
                      onChange={(e) => updateRow(row.id, 'receiptNo', e.target.value)}
                      title={rowIssue ?? (duplicateReceiptRowIds.has(row.id) ? 'رقم الإيصال مكرر' : undefined)}
                    />
                  </td>
                  <td className="col-notes">
                    <input
                      data-ledger-field="true"
                      value={row.notes}
                      disabled={locked}
                      placeholder="ملاحظات"
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onBlur={() => flushRowSave(row.id)}
                      onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                    />
                  </td>
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
      <QuickLedgerCustomSaveDialog
        open={customSaveOpen}
        onClose={() => setCustomSaveOpen(false)}
        onSubmit={handleCustomSaveSubmit}
        submitting={saving}
        defaultDate={trip.date}
        tripDriverId={trip.driverId || undefined}
        drivers={drivers}
        vehicles={vehicles}
        candidateRows={rows}
        isRowComplete={isRowComplete}
      />
      <QuickLedgerDispatchSaveLogPanel
        open={dispatchSaveLogOpen}
        onClose={() => setDispatchSaveLogOpen(false)}
        defaultBranchId={activeBranchId ? resolveLedgerBranchId(activeBranchId) : undefined}
        defaultDateFrom={trip.date}
        defaultDateTo={trip.date}
        onReprint={handleReprintDispatchSaveLog}
      />
      <QuickLedgerGlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        initialQuery={globalSearchSeed}
        branchId={activeBranchId ?? undefined}
        allBranches={canViewAllLedgerEntries && ledgerBranchMode === 'all'}
        includeLoaded={includeLoaded}
        branches={branches}
        onSelectRow={(row) => void handleGlobalSearchSelect(row)}
      />
      <QuickLedgerDuplicateRowsModal
        open={duplicatesOpen}
        onClose={() => setDuplicatesOpen(false)}
        branchId={activeBranchId ?? undefined}
        allBranches={canViewAllLedgerEntries && ledgerBranchMode === 'all'}
        onSelectRow={(row) => {
          setDuplicatesOpen(false);
          void handleGlobalSearchSelect(row);
        }}
      />
      <QuickLedgerPostSavePrintPrompt
        open={postSavePrintOpen}
        dispatchNo={postSavePrintContext?.dispatchNo}
        rowCount={postSavePrintContext?.printRows.length ?? 0}
        onConfirmPrint={() => void handlePostSavePrintConfirm()}
        onSkip={() => {
          setPostSavePrintOpen(false);
          setPostSavePrintContext(null);
        }}
        printing={postSavePrinting}
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
              <button
                type="button"
                className="danger"
                onClick={() => void deleteSelectedRows()}
                disabled={deletingRows || (isPersistenceOffline && selectedDeleteHasServerRows)}
              >
                {deletingRows ? 'جاري الحذف...' : 'تأكيد الحذف'}
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
              يوجد {stats.rowCount} أسطر تم إدخال بيانات فيها. الإغلاق الآن سيعيدك إلى قائمة الشحنات. الأسطر المحفوظة ستبقى محفوظة، والأسطر غير المحفوظة ستبقى فقط على الشاشة الحالية.
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
                  <>
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

                    {transferValidation.errors.length === 0 && (
                      <div
                        className={
                          transferValidation.summary.unpostedRowsCount === 0 &&
                          (transferValidation.summary.postedRowsCount ?? 0) > 0
                            ? 'quick-ledger-transfer-notice'
                            : 'quick-ledger-transfer-notice quick-ledger-transfer-notice--ready'
                        }
                      >
                        {(transferValidation.summary.postedRowsCount ?? 0) > 0 &&
                        transferValidation.summary.unpostedRowsCount === 0 ? (
                          <>
                            <strong>نقل تشغيلي — جاهز للتأكيد</strong>
                            <p>
                              كل الأسطر المحددة ({transferValidation.summary.postedRowsCount}) مُرحّلة مسبقاً.
                              سينتقل السائق/المركبة/التاريخ فقط <strong>بدون أثر مالي جديد</strong>.
                            </p>
                          </>
                        ) : (transferValidation.summary.postedRowsCount ?? 0) === 0 ? (
                          <>
                            <strong>جاهز للنقل</strong>
                            <p>الأسطر المحددة لم تُرحّل بعد — سيُنشأ أثرها المالي عند حفظ الشحنات في الإرسالية الهدف.</p>
                          </>
                        ) : (
                          <>
                            <strong>نقل مختلط</strong>
                            <p>
                              {transferValidation.summary.postedRowsCount} سطر مُرحّل (تشغيلي فقط) و{' '}
                              {transferValidation.summary.unpostedRowsCount} سطر غير مُرحّل — راجع التحديد قبل التأكيد.
                            </p>
                          </>
                        )}
                        {(transferValidation.summary.sourceLedgerDate || isBackdateMode) && (
                          <p className="quick-ledger-transfer-notice-meta">
                            {transferValidation.summary.sourceLedgerDate
                              ? `من دفتر تاريخ ${transferValidation.summary.sourceLedgerDate}`
                              : `من دفتر تاريخ ${trip.date}`}
                            {isBackdateMode ? ' — تصحيح على تاريخ سابق' : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {transferValidation.errors.length > 0 && (
                  <div className="quick-ledger-transfer-notice quick-ledger-transfer-notice--error">
                    <strong>لا يمكن تنفيذ النقل ({transferValidation.errors.length} مشكلة)</strong>
                    <ul className="quick-ledger-transfer-errors">
                      {transferValidation.errors.slice(0, 8).map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                      {transferValidation.errors.length > 8 && (
                        <li>{`… و ${transferValidation.errors.length - 8} مشكلة أخرى`}</li>
                      )}
                    </ul>
                    <p className="quick-ledger-transfer-notice-meta">
                      عدّل الأسطر في الجدول (تحصيل أو دفع مسبق)، ثم اضغط «إعادة التحقق بعد الحفظ».
                    </p>
                    <button
                      type="button"
                      className="quick-ledger-transfer-revalidate-btn"
                      disabled={transferring || transferValidation.loading}
                      onClick={() => {
                        const dbIds = selectedTransferRows
                          .map((row) => row.dbId)
                          .filter((id): id is string => Boolean(id));
                        void (async () => {
                          try {
                            await flushTransferSelectionSaves(selectedTransferRowIds);
                            await runTransferValidation(dbIds);
                          } catch {
                            showToast('تعذر حفظ التعديلات — تحقق من الاتصال ثم أعد المحاولة', 'error');
                          }
                        })();
                      }}
                    >
                      إعادة التحقق بعد الحفظ
                    </button>
                  </div>
                )}
                {transferValidation.warnings.length > 0 && (
                  <div className="quick-ledger-transfer-notice quick-ledger-transfer-notice--warn">
                    {transferValidation.warnings.map((warn, idx) => (
                      <p key={idx}>{warn}</p>
                    ))}
                  </div>
                )}

                <p className="quick-ledger-hint">
                  حدّد السائق أو المركبة والتاريخ الهدف، ثم اكتب سبب النقل للتوثيق.
                </p>

                <div className="quick-ledger-print-form space-y-3 mb-3">
                  <label className="form-group block">
                    <span className="form-label">التاريخ</span>
                    <input
                      className="form-input w-full"
                      type="date"
                      value={transferDate}
                      max={canPickFutureDate ? undefined : todayIso}
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
