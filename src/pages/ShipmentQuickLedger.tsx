import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Save, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { getBackendIdFromSynthetic, phase15Gateway, syntheticEntityId } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import { useAuth } from '../context/AuthProvider';
import SmartPartyInput from '../components/SmartPartyInput';
import AutocompleteInput from '../components/AutocompleteInput';
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

const DEFAULT_LEDGER_ROW_COUNT = 200;
const LEDGER_ROWS_ADD_INCREMENT = 100;

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
};

type SuggestedAgent = { id: number; code: string; name: string; city?: string; area?: string };

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

function isRowStarted(row: LedgerRow) {
  return Object.entries(row).some(
    ([key, value]) =>
      key !== 'id' &&
      key !== 'origin' &&
      key !== 'collectManual' &&
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      String(value).trim() !== '',
  );
}

function isRowComplete(row: LedgerRow) {
  return Boolean(
    row.receiptNo.trim() &&
      row.destination.trim() &&
      row.parcelType.trim() &&
      row.parcelCount.trim() &&
      row.sender.trim() &&
      row.receiver.trim(),
  );
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
    date: string;
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
    .meta { margin-bottom: 10px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
    .meta div { border: 1px solid #c5d0dc; padding: 4px 6px; background: #f8fafc; }
    .meta strong { font-weight: 800; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
    th, td { border: 1px solid #7f93a7; padding: 3px 2px; vertical-align: middle; word-break: break-word; }
    th { background: #dce8e5; font-weight: 800; text-align: center; height: 32px; line-height: 1.25; }
    td { text-align: center; height: 28px; background: #fff; }
    .col-receipt { width: 8%; }
    .col-dest { width: 10%; }
    .col-type { width: 14%; }
    .col-count { width: 5%; }
    .col-weight { width: 6%; }
    .col-party { width: 13%; text-align: right; }
    .col-money { width: 6.5%; direction: ltr; font-size: 9px; }
    th.col-money { font-size: 8px; line-height: 1.15; padding: 2px 1px; }
  </style>
</head>
<body>
  <div class="meta">
    <div><strong>التاريخ:</strong> ${escapePrintHtml(meta.date)}</div>
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
  const { user, activeBranchId, setActiveBranch } = useAuth();
  const [rows, setRows] = useState<LedgerRow[]>(() =>
    Array.from({ length: DEFAULT_LEDGER_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)),
  );
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
  const [printDate, setPrintDate] = useState(new Date().toISOString().split('T')[0]);
  const [printLoading, setPrintLoading] = useState(false);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState<string[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [agentSuggestions, setAgentSuggestions] = useState<Record<number, SuggestedAgent[]>>({});
  /** كل الوكلاء للشركة — يُحمَّل للمسؤولين لملء القائمة حتى لو بحث الوجهة لم يُطابق حقول الوكيل */
  const [catalogAgents, setCatalogAgents] = useState<SuggestedAgent[]>([]);
  const [includeLoaded, setIncludeLoaded] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const saveTimersRef = useRef<Record<number, number>>({});
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
    const q = normalizeName(searchQuick).toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        row.receiptNo,
        row.origin,
        row.destination,
        row.parcelType,
        row.sender,
        row.receiver,
        row.notes,
        row.agentName,
        String(row.agentId ?? ''),
      ].some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [rows, searchQuick]);

  const stats = useMemo(() => {
    const started = rows.filter(isRowStarted).length;
    const completeRows = rows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
    return {
      started,
      complete: completeRows.length,
      missing: Math.max(0, started - rows.filter(isRowComplete).length),
      saved: rows.filter((r) => Boolean(r.postedShipmentId)).length,
      totalCollect: rows.reduce((sum, row) => sum + rowAmountUsd(row), 0),
    };
  }, [rows]);

  const rowsRef = useRef(rows);
  const customersRef = useRef(customers);
  const goodsTypesRef = useRef(goodsTypes);
  const tripRef = useRef(trip);
  const activeBranchIdRef = useRef(activeBranchId);

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

  const mapRemoteRowToLocal = (remote: RemoteDailyLedgerRow): LedgerRow => ({
    id: remote.row_no,
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

  const loadRemoteRows = async () => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    if (!branchId) return;
    if (!currentTrip.date || !currentTrip.line) return;

    setRemoteLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('branchId', branchId);
      params.set('ledgerDate', currentTrip.date);
      params.set('lineLabel', currentTrip.line);
      if (currentTrip.driverId) {
        const driverBackendId = getBackendIdFromSynthetic(currentTrip.driverId);
        if (driverBackendId) params.set('driverId', driverBackendId);
      }
      params.set('includeLoaded', includeLoaded ? 'true' : 'false');
      params.set('limit', '500');
      params.set('offset', '0');
      const data = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
      const mapped = data.map(mapRemoteRowToLocal);
      const maxRowNo = Math.max(DEFAULT_LEDGER_ROW_COUNT, ...mapped.map((r) => r.id));
      const byNo = new Map<number, LedgerRow>(mapped.map((r) => [r.id, r]));
      const origin = resolveTripOrigin(currentTrip.line);
      const nextRows = Array.from({ length: maxRowNo }, (_, idx) => {
        const rowNo = idx + 1;
        const existing = byNo.get(rowNo);
        if (existing) return existing;
        return mergeRowWithAutoTariff({ ...createEmptyRow(rowNo), origin }, tariffs, cities, branches, goodsTypes, currentTrip.date);
      });
      setRows(nextRows);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحديث دفتر الشحن اليومي من الشبكة', 'error');
    } finally {
      setRemoteLoading(false);
    }
  };

  useEffect(() => {
    if (!loadingRefs) {
      void loadRemoteRows();
    }
  }, [activeBranchId, trip.date, trip.line, trip.driverId, includeLoaded, loadingRefs]);

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
          phase15Gateway.drivers.getAll().catch(() => [] as Driver[]),
          phase15Gateway.vehicles.getAll().catch(() => [] as Vehicle[]),
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
            const list = await httpClient.get<Array<{ id: string; code: string; name: string; is_active?: boolean }>>('/agents');
            const mapped = list
              .filter((a) => a.is_active !== false)
              .map((a) => ({
                id: syntheticEntityId(a.id),
                code: a.code,
                name: a.name,
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

  const updateRow = (id: number, field: keyof LedgerRow, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'parcelType') {
          const next = { ...row, parcelType: value, collectManual: false };
          return mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
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
            next = mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
          }
          return next;
        }
        let next: LedgerRow = { ...row, [field]: value };
        if (field === 'origin' || field === 'destination' || field === 'weightKg') {
          next = { ...next, collectManual: false };
          next = mergeRowWithAutoTariff(next, tariffs, cities, branches, goodsTypes, trip.date);
        }
        return next;
      }),
    );
    queueRowSave(id);
  };

  const saveRowToServer = async (rowNo: number) => {
    const branchId = activeBranchIdRef.current;
    const currentTrip = tripRef.current;
    if (!branchId) return;
    if (!currentTrip.date || !currentTrip.line) return;
    const row = rowsRef.current.find((r) => r.id === rowNo);
    if (!row) return;
    if (!row.dbId && !isRowStarted(row)) return;

    const origin = resolveTripOrigin(currentTrip.line);
    try {
      const saved = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
        branchId,
        ledgerDate: currentTrip.date,
        lineLabel: currentTrip.line,
        originLabel: origin,
        tripNo: currentTrip.tripNo || null,
        ...tripFleetPayload(currentTrip),
        rowNo: row.id,
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
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowNo
            ? {
                ...r,
                dbId: saved.id,
                updatedAt: saved.updated_at,
                postedShipmentId: saved.posted_shipment_id,
                loadedAt: saved.loaded_at,
              }
            : r,
        ),
      );

      if (saved.posted_shipment_id && !saved.loaded_at) {
        const shipmentSyntheticId = syntheticEntityId(saved.posted_shipment_id);
        const originBranch = resolveTripOrigin(currentTrip.line);
        const branchForRow = branchForOriginRow(originBranch)!;
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
            shipmentNo: normalizeName(row.receiptNo),
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
          /* إذا تعذر تحديث الشحنة، يبقى سطر الدفتر محفوظاً ولا يمنع المستخدم من المتابعة */
        }
      }
    } catch {}
  };

  const queueRowSave = (rowNo: number) => {
    const timer = saveTimersRef.current[rowNo];
    if (timer) window.clearTimeout(timer);
    saveTimersRef.current[rowNo] = window.setTimeout(() => {
      void saveRowToServer(rowNo);
    }, 650);
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
        if (row.postedShipmentId) return row;
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

  const lookupAgentsForRow = async (rowId: number, destinationValue: string, originValue: string) => {
    const destination = normalizeName(destinationValue);
    if (!destination) return;
    try {
      const agents = await phase15Gateway.agents.lookupByDestination(destination);
      const mapped: SuggestedAgent[] = agents.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        city: typeof (a as { city?: unknown }).city === 'string' ? (a as { city?: string }).city : undefined,
        area: typeof (a as { area?: unknown }).area === 'string' ? (a as { area?: string }).area : undefined,
      }));
      setAgentSuggestions((prev) => ({ ...prev, [rowId]: mapped }));
      if (mapped.length === 1) {
        setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, agentId: mapped[0].id, agentName: mapped[0].name } : row)));
      }
    } catch {
      /* ignore */
    }
  };

  const addRows = () => {
    const origin = resolveTripOrigin(trip.line);
    setRows((prev) => {
      const start = prev.length + 1;
      const nextRows = Array.from({ length: LEDGER_ROWS_ADD_INCREMENT }, (_, index) => {
        const base = createEmptyRow(start + index);
        const merged = {
          ...base,
          origin: origin || base.origin,
        };
        return mergeRowWithAutoTariff(merged, tariffs, cities, branches, goodsTypes, trip.date);
      });
      return [...prev, ...nextRows];
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
    if (changed) queueRowSave(rowId);
  };

  const focusNext = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-ledger-field="true"]'));
    const currentIndex = fields.indexOf(event.currentTarget as HTMLElement);
    fields[currentIndex + 1]?.focus();
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
    const raw = rawInput.trim();
    let next = raw;
    let agentId = row.agentId;
    let agentName = row.agentName;
    const cityResolved = resolveDestinationByQuickCode(raw, cities, branches);
    if (cityResolved) {
      next = cityResolved;
      agentId = undefined;
      agentName = '';
    } else if (isDigitsOnlyQuickCode(raw)) {
      const unique = dedupeAgentsList([...(agentSuggestions[row.id] || []), ...catalogAgents]);
      const agent = matchByEntityCode(unique, raw);
      if (agent) {
        const loc = [agent.city, agent.area].filter(Boolean).join(' / ');
        next = loc || agent.name;
        agentId = agent.id;
        agentName = agent.name;
      } else if (raw) {
        showToast(`لا يوجد فرع/مدينة/وكيل بالكود «${raw}»`, 'info');
      }
    }
    const norm = normalizeName(next);
    if (norm) rememberDestinationOption(norm);
    setRows((prev) =>
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
    );
    queueRowSave(row.id);
    const destLookup = norm || normalizeName(raw);
    if (destLookup) void lookupAgentsForRow(row.id, destLookup, row.origin);
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
    setPrintDriverId(trip.driverId || 0);
    setPrintDate(trip.date);
    setPrintDialogOpen(true);
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

  const executeDriverPrint = async () => {
    const branchId = activeBranchIdRef.current;
    if (!branchId) {
      showToast('يرجى اختيار الفرع قبل الطباعة', 'error');
      return;
    }
    if (!printDriverId) {
      showToast('يرجى اختيار السائق', 'error');
      return;
    }
    if (!printDate) {
      showToast('يرجى اختيار التاريخ', 'error');
      return;
    }

    const driverBackendId = getBackendIdFromSynthetic(printDriverId);
    if (!driverBackendId) {
      showToast('تعذر تحديد السائق', 'error');
      return;
    }

    const selectedDriver = drivers.find((d) => d.id === printDriverId);
    const linkedVehicle = vehicles.find((v) => v.driverId === printDriverId);
    const selectedVehicle = linkedVehicle ?? vehicles.find((v) => v.id === trip.vehicleId);

    setPrintLoading(true);
    try {
      const useCurrentLedger =
        printDriverId === trip.driverId && printDate === trip.date && Boolean(trip.line);

      let rowsToPrint: QuickLedgerPrintRow[] = [];

      if (useCurrentLedger) {
        rowsToPrint = rows.filter(isRowStarted).map(localRowToPrint);
      } else {
        const params = new URLSearchParams();
        params.set('branchId', branchId);
        params.set('ledgerDate', printDate);
        params.set('driverId', driverBackendId);
        params.set('includeLoaded', includeLoaded ? 'true' : 'false');
        params.set('limit', '500');
        params.set('offset', '0');
        const data = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
        rowsToPrint = data.filter(isRemoteRowPrintable).map(remoteRowToPrint);
      }

      if (!rowsToPrint.length) {
        showToast('لا توجد أسطر ببيانات لهذا السائق في التاريخ المحدد', 'info');
        return;
      }

      const vehicleLabel = selectedVehicle
        ? `${selectedVehicle.plateNumber}${selectedVehicle.model ? ` — ${selectedVehicle.model}` : ''}`
        : trip.vehicle || '—';

      const html = buildQuickLedgerPrintHtml(rowsToPrint, {
        title: `دفتر الشحن — ${selectedDriver?.name ?? ''}`,
        date: printDate,
        driverName: selectedDriver?.name ?? '',
        vehicleLabel,
        lineLabel: useCurrentLedger ? trip.line : undefined,
        tripNo: useCurrentLedger ? trip.tripNo : undefined,
      });

      setPrintDialogOpen(false);

      if (window.printer?.getDefault && window.printer?.print) {
        const defaultPrinter = await window.printer.getDefault();
        if (defaultPrinter.available && defaultPrinter.printer?.name) {
          const result = await window.printer.print({
            documentType: 'quick_ledger',
            printerTarget: defaultPrinter.printer.name,
            copies: 1,
            payloadType: 'html',
            content: html,
          });
          showToast(result.message || 'تم إرسال دفتر الشحن للطباعة', result.queued ? 'success' : 'info');
          if (result.queued) return;
        }
      }

      const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      } else {
        showToast('تعذر فتح نافذة الطباعة', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تنفيذ الطباعة', 'error');
    } finally {
      setPrintLoading(false);
    }
  };


  const saveRows = async () => {
    const rowsToSave = rows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
    if (!rowsToSave.length) {
      showToast('لا توجد أسطر مكتملة جديدة للحفظ', 'info');
      return;
    }
    if (!activeBranchId) {
      showToast('يرجى اختيار الفرع قبل حفظ الشحنات', 'error');
      return;
    }
    const origin = resolveTripOrigin(trip.line);
    if (!origin) {
      showToast('يرجى اختيار الخط / المصدر أولاً', 'error');
      return;
    }
    if (!trip.driverId) {
      showToast('يرجى اختيار السائق من المركبات والسائقون', 'error');
      return;
    }

    setSaving(true);
    try {
      for (const row of rowsToSave) {
        await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
          branchId: activeBranchId,
          ledgerDate: trip.date,
          lineLabel: trip.line,
          originLabel: origin,
          tripNo: trip.tripNo || null,
          ...tripFleetPayload(trip),
          rowNo: row.id,
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
      }

      const result = await httpClient.post<{
        posted: Array<{ rowId: string; rowNo: number; shipmentId: string; shipmentNo: string; agentId: string | null }>;
        skipped: Array<{ rowId: string; rowNo: number; reason: string }>;
        errors: Array<{ rowId: string; rowNo: number; message: string }>;
      }>('/daily-ledger/rows/post-shipments', {
        branchId: activeBranchId,
        ledgerDate: trip.date,
        lineLabel: trip.line,
      });

      const postedByRowNo = new Map(result.posted.map((item) => [item.rowNo, item]));
      setRows((prev) =>
        prev.map((row) => {
          const posted = postedByRowNo.get(row.id);
          if (!posted) return row;
          return {
            ...row,
            dbId: posted.rowId,
            postedShipmentId: posted.shipmentId,
            agentId: posted.agentId ? syntheticEntityId(posted.agentId) : row.agentId,
          };
        }),
      );

      if (result.posted.length) {
        showToast(`تم حفظ ${result.posted.length} شحنة وربطها بالوكيل بنجاح`, 'success');
      }
      if (result.errors.length) {
        showToast(
          result.errors.map((item) => `السطر ${item.rowNo}: ${item.message}`).join(' | '),
          'error',
        );
      } else if (!result.posted.length) {
        showToast('لا توجد أسطر صالحة للترحيل. تأكد من اكتمال البيانات وربط الوكيل بالوجهة.', 'info');
      }

      await loadRemoteRows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ الشحنات', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quick-ledger-page" dir="rtl">
      <section className="quick-ledger-toolbar">
        <div>
          <div className="quick-ledger-eyebrow">إدخال سريع للشحنات</div>
          <h2>دفتر الشحن اليومي</h2>
          <p className="quick-ledger-hint">
            اختر <strong>الخط</strong> من الأعلى ثم أدخل بيانات الشحنات في الجدول. عمود <strong>تحصيل $</strong> يُملأ تلقائياً من <strong>مالية → تعريف الأسعار</strong> عند تطابق <strong>المسار + نوع الطرد + الوزن</strong> والتاريخ (يمكنك التعديل يدوياً أو نقل المبلغ إلى <strong>دفع مسبق $</strong>).
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
            إضافة 100 سطر
          </button>
          <button type="button" onClick={() => void loadRemoteRows()} disabled={remoteLoading}>
            {remoteLoading ? 'جاري التحديث...' : 'تحديث'}
          </button>
          <label className="quick-ledger-print-toggle">
            <input type="checkbox" checked={includeLoaded} onChange={(e) => setIncludeLoaded(e.target.checked)} />
            إظهار المحمّلة
          </label>
          <button type="button" onClick={openPrintDialog}>
            <Printer size={16} />
            طباعة
          </button>
          <button type="button" onClick={() => setCloseConfirmOpen(true)}>
            إغلاق القسم
          </button>
          <button type="button" className="primary" onClick={() => void saveRows()} disabled={saving || loadingRefs}>
            <Save size={16} />
            {saving ? 'جاري الحفظ...' : 'حفظ الشحنات'}
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
          <input type="date" value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} />
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
      </section>

      <section className="quick-ledger-stats">
        <div><strong>{stats.started}</strong><span>أسطر مستخدمة</span></div>
        <div><strong>{stats.complete}</strong><span>جاهزة للحفظ</span></div>
        <div><strong>{stats.missing}</strong><span>ناقصة</span></div>
        <div><strong>{stats.saved}</strong><span>محفوظة</span></div>
        <div><strong>{stats.totalCollect.toLocaleString()}</strong><span>إجمالي الدولار</span></div>
      </section>

      <section className="quick-ledger-table-shell">
        <table className="quick-ledger-table">
          <thead>
            <tr>
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
              const goodsTypeItems = goodsTypes.map((g) => ({ id: g.id, name: g.name }));
              return (
                <tr key={row.id} className={locked ? 'saved' : posted ? 'started' : activeRowId === row.id ? 'active' : started ? 'started' : ''}>
                  <td><input data-ledger-field="true" value={row.receiptNo} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'receiptNo', e.target.value)} /></td>
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
                      onChange={(e) => updateRow(row.id, 'destination', e.target.value)}
                    />
                  </td>
                  <td className="quick-ledger-parcel-cell col-parcel-type">
                    <AutocompleteInput
                      value={row.parcelType}
                      onChange={(v) => updateRow(row.id, 'parcelType', v)}
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
                        queueRowSave(row.id);
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
                            queueRowSave(row.id);
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
                      onChange={(e) => updateRow(row.id, 'weightKg', e.target.value)}
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
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.collectAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'collectAmount', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.prepaidAmount} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'prepaidAmount', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.receiverCollect} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'receiverCollect', e.target.value)} /></td>
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.transferServiceFee} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'transferServiceFee', e.target.value)} /></td>
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

      {printDialogOpen && (
        <div className="quick-ledger-confirm" role="dialog" aria-modal="true">
          <div className="quick-ledger-confirm-panel">
            <h3>طباعة دفتر الشحن حسب السائق</h3>
            <p>اختر السائق والتاريخ لطباعة كل طلبات الشحن المرتبطة به من قسم المركبات والسائقون.</p>
            <div className="space-y-3 mb-3">
              <label className="form-group block">
                <span className="form-label">السائق</span>
                <select
                  className="form-select w-full"
                  value={printDriverId || ''}
                  onChange={(e) => setPrintDriverId(Number(e.target.value))}
                >
                  <option value="">اختر السائق...</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.code ? `${driver.code} — ` : ''}{driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-group block">
                <span className="form-label">التاريخ</span>
                <input
                  className="form-input w-full"
                  type="date"
                  value={printDate}
                  onChange={(e) => setPrintDate(e.target.value)}
                />
              </label>
            </div>
            <div>
              <button type="button" onClick={() => setPrintDialogOpen(false)} disabled={printLoading}>
                إلغاء
              </button>
              <button type="button" className="primary" onClick={() => void executeDriverPrint()} disabled={printLoading}>
                {printLoading ? 'جاري التحضير...' : 'طباعة'}
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
    </div>
  );
}
