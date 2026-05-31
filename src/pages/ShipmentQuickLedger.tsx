import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Save, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { getBackendIdFromSynthetic, phase15Gateway, syntheticEntityId } from '../lib/api/phase15Gateway';
import { httpClient } from '../lib/api/httpClient';
import { useAuth } from '../context/AuthProvider';
import SmartPartyInput from '../components/SmartPartyInput';
import AutocompleteInput from '../components/AutocompleteInput';
import type { Branch, City, Customer, GoodsType, Shipment, Tariff } from '../types';

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
  fees: string;
  /** عند true ووجود قيمة في fees لا يُعاد حساب الأجور من التعريف تلقائياً */
  feesManual?: boolean;
  agentId?: number;
  agentName?: string;
  notes: string;
};

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
    fees: '',
    feesManual: false,
    agentId: undefined,
    agentName: '',
    notes: '',
  };
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parseUsd(value: string) {
  const clean = value.trim().replace(/,/g, '');
  if (!clean) return 0;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRowStarted(row: LedgerRow) {
  return Object.entries(row).some(
    ([key, value]) =>
      key !== 'id' &&
      key !== 'origin' &&
      key !== 'feesManual' &&
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
  return Math.max(parseUsd(row.collectAmount) + parseUsd(row.receiverCollect) + parseUsd(row.fees) - parseUsd(row.prepaidAmount), 0);
}

function parseWeightKg(value: string) {
  const clean = value.trim().replace(/,/g, '');
  if (!clean) return undefined;
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveCityId(label: string, cities: City[], branches: Branch[]): number | undefined {
  const n = normalizeName(label);
  if (!n) return undefined;
  const direct = cities.find((c) => normalizeName(c.name) === n);
  if (direct) return direct.id;
  const br = branches.find((b) => normalizeName(b.name) === n);
  if (br) {
    const hint = cities.find(
      (c) =>
        normalizeName(br.name).includes(normalizeName(c.name)) ||
        normalizeName(c.name).includes(normalizeName(br.name)),
    );
    return hint?.id;
  }
  return undefined;
}

function pickTariff(
  tariffs: Tariff[],
  fromCityId: number,
  toCityId: number,
  goodsTypeId: number,
  asOf: string,
): Tariff | undefined {
  const day = (asOf.split('T')[0] ?? asOf).trim();
  const candidates = tariffs.filter(
    (t) =>
      t.fromCityId === fromCityId &&
      t.toCityId === toCityId &&
      t.goodsTypeId === goodsTypeId &&
      (!t.validFrom || t.validFrom <= day) &&
      (!t.validTo || t.validTo >= day),
  );
  if (!candidates.length) return undefined;
  return [...candidates].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
}

function formatUsdAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** أجور USD من «تعريف الأسعار»: max(الحد الأدنى × عدد الطرود، السعر للكغ × الوزن الكلي). */
function computeTariffFeesString(
  row: LedgerRow,
  tariffs: Tariff[],
  cities: City[],
  branches: Branch[],
  goodsTypes: GoodsType[],
  asOf: string,
): string | null {
  const origin = normalizeName(row.origin);
  const dest = normalizeName(row.destination);
  const gtn = normalizeName(row.parcelType);
  if (!origin || !dest || !gtn) return null;
  const fromId = resolveCityId(origin, cities, branches);
  const toId = resolveCityId(dest, cities, branches);
  const gt = goodsTypes.find((g) => normalizeName(g.name) === gtn);
  if (!fromId || !toId || !gt) return null;
  const t = pickTariff(tariffs, fromId, toId, gt.id, asOf);
  if (!t) return null;
  const w = parseWeightKg(row.weightKg);
  const rawPcs = Number(String(row.parcelCount).trim().replace(/,/g, ''));
  const pcs = Number.isFinite(rawPcs) && rawPcs > 0 ? Math.floor(rawPcs) : 1;
  const weightComponent = t.pricePerKg > 0 && w != null ? t.pricePerKg * w : null;
  const minPart = t.minimumCharge > 0 ? t.minimumCharge * pcs : null;
  if (weightComponent == null && minPart == null) return null;
  const amount = Math.max(weightComponent ?? 0, minPart ?? 0);
  return formatUsdAmount(amount);
}

function goodsTypeItemsForRow(
  row: LedgerRow,
  tariffs: Tariff[],
  cities: City[],
  branches: Branch[],
  goodsTypes: GoodsType[],
  asOf: string,
): Array<{ id: number; name: string }> {
  const origin = normalizeName(row.origin);
  const dest = normalizeName(row.destination);
  if (!origin || !dest) return goodsTypes.map((g) => ({ id: g.id, name: g.name }));
  const fromId = resolveCityId(origin, cities, branches);
  const toId = resolveCityId(dest, cities, branches);
  if (!fromId || !toId) return goodsTypes.map((g) => ({ id: g.id, name: g.name }));
  const day = (asOf.split('T')[0] ?? asOf).trim();
  const goodsTypeIds = new Set(
    tariffs
      .filter(
        (t) =>
          t.fromCityId === fromId &&
          t.toCityId === toId &&
          (!t.validFrom || t.validFrom <= day) &&
          (!t.validTo || t.validTo >= day),
      )
      .map((t) => t.goodsTypeId),
  );
  if (!goodsTypeIds.size) return goodsTypes.map((g) => ({ id: g.id, name: g.name }));
  return goodsTypes.filter((g) => goodsTypeIds.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
}

function mergeRowWithAutoTariff(
  row: LedgerRow,
  tariffs: Tariff[],
  cities: City[],
  branches: Branch[],
  goodsTypes: GoodsType[],
  asOf: string,
): LedgerRow {
  if (row.feesManual && String(row.fees ?? '').trim() !== '') return row;
  const nf = computeTariffFeesString(row, tariffs, cities, branches, goodsTypes, asOf);
  if (nf == null) return row;
  return { ...row, fees: nf, feesManual: false };
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
  const [rows, setRows] = useState<LedgerRow[]>(() => Array.from({ length: 25 }, (_, index) => createEmptyRow(index + 1)));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeRowId, setActiveRowId] = useState(1);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
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
    collectAmount: String(remote.collect_amount_usd ?? ''),
    prepaidAmount: String(remote.prepaid_amount_usd ?? ''),
    receiverCollect: String(remote.hawala_amount_usd ?? ''),
    transferServiceFee: String(remote.transfer_service_fee_usd ?? ''),
    fees: String(remote.fees_amount_usd ?? ''),
    feesManual: String(remote.fees_amount_usd ?? '').trim() !== '',
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
      params.set('includeLoaded', includeLoaded ? 'true' : 'false');
      params.set('limit', '500');
      params.set('offset', '0');
      const data = await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
      const mapped = data.map(mapRemoteRowToLocal);
      const maxRowNo = Math.max(25, ...mapped.map((r) => r.id));
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
  }, [activeBranchId, trip.date, trip.line, includeLoaded, loadingRefs]);

  useEffect(() => {
    let cancelled = false;
    const loadRefs = async () => {
      setLoadingRefs(true);
      try {
        const [branchesData, citiesData, goodsTypesData, customersData] = await Promise.all([
          phase15Gateway.branches.getAll(),
          phase15Gateway.cities.getAll(),
          phase15Gateway.goodsTypes.getAll(),
          phase15Gateway.sendersReceivers.getAll(),
        ]);
        if (cancelled) return;
        setBranches(branchesData);
        setCities(citiesData);
        setGoodsTypes(goodsTypesData);
        setCustomers(customersData);
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
        if (field === 'fees') {
          return { ...row, fees: value, feesManual: value.trim() !== '' };
        }
        if (field === 'parcelType') {
          return { ...row, parcelType: value };
        }
        let next: LedgerRow = { ...row, [field]: value };
        if (field === 'origin' || field === 'parcelCount' || field === 'weightKg') {
          next = { ...next, feesManual: false };
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
        vehicleLabel: currentTrip.vehicle || null,
        driverLabel: currentTrip.driver || null,
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
        feesAmountUsd: parseUsd(row.fees),
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

          const total = rowAmountUsd(row);
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
            freightCharge: parseUsd(row.fees),
            transferFee: parseUsd(row.collectAmount),
            hawalaAmount: parseUsd(row.receiverCollect),
            prepaidAmount: parseUsd(row.prepaidAmount),
            discount: 0,
            total,
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
        const next = { ...row, origin, feesManual: false };
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
      const nextRows = Array.from({ length: 10 }, (_, index) => {
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

  /** إعادة حساب الأجور من التعريف بعد تعديل العدد أو الوزن (لا يُستبدل إن كان المستخدم عدّل الأجور يدوياً). */
  const recalcTariffFeesForRowId = (rowId: number) => {
    let changed = false;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        changed = true;
        return mergeRowWithAutoTariff({ ...r, feesManual: false }, tariffs, cities, branches, goodsTypes, trip.date);
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
          feesManual: false,
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

  const handlePrint = async () => {
    try {
      const escapeHtml = (value: string) =>
        String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

      const rowsToPrint = visibleRows.filter(isRowStarted);
      const buildHtml = () => {
        const bodyRows = rowsToPrint
          .map(
            (row) => `<tr>
<td class="c-no">${escapeHtml(String(row.id))}</td>
<td class="c-receipt">${escapeHtml(row.receiptNo)}</td>
<td class="c-dest">${escapeHtml(row.destination)}</td>
<td class="c-type">${escapeHtml(row.parcelType)}</td>
<td class="c-pcs">${escapeHtml(row.parcelCount)}</td>
<td class="c-w">${escapeHtml(row.weightKg)}</td>
<td class="c-party">${escapeHtml(row.sender)}</td>
<td class="c-party">${escapeHtml(row.receiver)}</td>
<td class="c-money">${escapeHtml(row.collectAmount)}</td>
<td class="c-money">${escapeHtml(row.prepaidAmount)}</td>
<td class="c-money">${escapeHtml(row.receiverCollect)}</td>
<td class="c-money">${escapeHtml(row.transferServiceFee)}</td>
<td class="c-money">${escapeHtml(row.fees)}</td>
</tr>`,
          )
          .join('');

        return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>دفتر الشحن اليومي</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin: 0; padding: 0; background: white; font-family: Tahoma, Arial, sans-serif; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #111827; padding: 2px 3px; font-size: 9.5px; line-height: 1.25; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 800; text-align: center; }
    td { word-break: break-word; white-space: normal; }
    .c-no { width: 32px; text-align: center; }
    .c-receipt { width: 70px; text-align: center; }
    .c-dest { width: 120px; }
    .c-type { width: 80px; }
    .c-pcs { width: 42px; text-align: center; }
    .c-w { width: 46px; text-align: center; }
    .c-party { width: 130px; }
    .c-money { width: 62px; text-align: center; direction: ltr; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th class="c-no">#</th>
        <th class="c-receipt">رقم الإيصال</th>
        <th class="c-dest">الجهة</th>
        <th class="c-type">نوع الطرود</th>
        <th class="c-pcs">عدد الطرود</th>
        <th class="c-w">الوزن كغ</th>
        <th class="c-party">المرسل</th>
        <th class="c-party">المرسل إليه</th>
        <th class="c-money">تحصيل $</th>
        <th class="c-money">دفع مسبق $</th>
        <th class="c-money">حوالة</th>
        <th class="c-money">أجرة الحوالة</th>
        <th class="c-money">الأجور $</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || ''}
    </tbody>
  </table>
</body>
</html>`;
      };

      if (window.printer?.getDefault && window.printer?.print) {
        const defaultPrinter = await window.printer.getDefault();
        if (defaultPrinter.available && defaultPrinter.printer?.name) {
          const result = await window.printer.print({
            documentType: 'quick_ledger',
            printerTarget: defaultPrinter.printer.name,
            copies: 1,
            payloadType: 'html',
            content: buildHtml(),
          });
          showToast(result.message || 'تم إرسال دفتر الشحن اليومي للطباعة', result.queued ? 'success' : 'info');
          if (result.queued) return;
        }
      }
      window.print();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تنفيذ الطباعة', 'error');
      window.print();
    }
  };

  const findCustomer = (name: string, list: Customer[]) => {
    const normalized = normalizeName(name);
    return list.find((customer) => normalizeName(customer.name) === normalized);
  };

  const ensureCustomer = async (name: string, type: 'sender' | 'receiver', list: Customer[]) => {
    const existing = findCustomer(name, list);
    if (existing) return { customer: existing, list };
    const created = await phase15Gateway.sendersReceivers.create({
      name: normalizeName(name),
      phone: '',
      customerType: type,
      address: '',
      balance: 0,
      creditLimit: 0,
      notes: '',
    });
    return { customer: created, list: [...list, created] };
  };

  const ensureGoodsType = async (name: string, list: GoodsType[]) => {
    const normalized = normalizeName(name);
    const existing = list.find((item) => normalizeName(item.name) === normalized);
    if (existing) return { goodsType: existing, list };
    const created = await phase15Gateway.goodsTypes.create({
      code: `GT-${Date.now()}`,
      name: normalized,
      description: '',
    });
    return { goodsType: created, list: [...list, created] };
  };

  const saveRows = async () => {
    const rowsToSave = rows.filter((row) => isRowComplete(row) && !row.postedShipmentId);
    if (!rowsToSave.length) {
      showToast('لا توجد أسطر مكتملة جديدة للحفظ', 'info');
      return;
    }
    if (!branches.length) {
      showToast('لا يوجد فرع متاح للحفظ', 'error');
      return;
    }
    const origin = resolveTripOrigin(trip.line);
    if (!origin) {
      showToast('يرجى اختيار الخط / المصدر أولاً', 'error');
      return;
    }

    setSaving(true);
    let customerList = customers;
    let goodsList = goodsTypes;
    try {
      for (const row of rowsToSave) {
        const branchForRow = branchForOriginRow(origin)!;

        const senderResult = await ensureCustomer(row.sender, 'sender', customerList);
        customerList = senderResult.list;
        const receiverResult = await ensureCustomer(row.receiver, 'receiver', customerList);
        customerList = receiverResult.list;
        const goodsResult = await ensureGoodsType(row.parcelType, goodsList);
        goodsList = goodsResult.list;

        const total = rowAmountUsd(row);
        const payload: Partial<Shipment> = {
          shipmentNo: normalizeName(row.receiptNo),
          date: trip.date,
          branchId: branchForRow.id,
          branchName: branchForRow.name,
          agentId: row.agentId,
          agentName: row.agentName,
          originName: normalizeName(origin),
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
          freightCharge: parseUsd(row.fees),
          transferFee: parseUsd(row.collectAmount),
          hawalaAmount: parseUsd(row.receiverCollect),
          transferServiceFee: parseUsd(row.transferServiceFee),
          discount: 0,
          total,
          currency: 'USD',
          paymentMethod: parseUsd(row.prepaidAmount) > 0 ? 'prepaid' : 'cash',
          deliveryType: 'branch',
          notes: [row.notes, trip.tripNo ? `رقم الرحلة: ${trip.tripNo}` : '', trip.vehicle ? `المركبة: ${trip.vehicle}` : '', trip.driver ? `السائق: ${trip.driver}` : '']
            .filter(Boolean)
            .join(' | '),
        };

        if (activeBranchId) {
          try {
            const ensured = await httpClient.post<RemoteDailyLedgerRow>('/daily-ledger/rows/upsert', {
              branchId: activeBranchId,
              ledgerDate: trip.date,
              lineLabel: trip.line,
              originLabel: origin,
              tripNo: trip.tripNo || null,
              vehicleLabel: trip.vehicle || null,
              driverLabel: trip.driver || null,
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
              feesAmountUsd: parseUsd(row.fees),
              transferServiceFeeUsd: parseUsd(row.transferServiceFee),
              notes: row.notes || null,
            });
            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, dbId: ensured.id, updatedAt: ensured.updated_at, postedShipmentId: ensured.posted_shipment_id, loadedAt: ensured.loaded_at } : r)));
          } catch {}
        }

        const created = await phase15Gateway.shipments.create(payload);
        const shipmentUuid = getBackendIdFromSynthetic(created.id);
        if (row.dbId && shipmentUuid) {
          await httpClient.post<{ ok: boolean }>(`/daily-ledger/rows/${row.dbId}/post`, { shipmentId: shipmentUuid });
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, postedShipmentId: shipmentUuid } : r)));
        }
      }

      setCustomers(customerList);
      setGoodsTypes(goodsList);
      showToast(`تم حفظ ${rowsToSave.length} شحنة بنجاح`, 'success');
    } catch (error) {
      setCustomers(customerList);
      setGoodsTypes(goodsList);
      showToast(error instanceof Error ? error.message : 'تعذر حفظ بعض الشحنات', 'error');
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
            اختر <strong>الخط</strong> من الأعلى ثم أدخل بيانات الشحنات في الجدول. عمود <strong>الأجور</strong> يُحسب تلقائياً من <strong>مالية → تعريف الأسعار</strong> عند تطابق المسار ونوع الطرود والتاريخ (يمكنك التعديل يدوياً).
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
            إضافة 10 أسطر
          </button>
          <button type="button" onClick={() => void loadRemoteRows()} disabled={remoteLoading}>
            {remoteLoading ? 'جاري التحديث...' : 'تحديث'}
          </button>
          <label className="quick-ledger-print-toggle">
            <input type="checkbox" checked={includeLoaded} onChange={(e) => setIncludeLoaded(e.target.checked)} />
            إظهار المحمّلة
          </label>
          <button type="button" onClick={() => void handlePrint()}>
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
          <input value={trip.vehicle} onChange={(e) => setTrip({ ...trip, vehicle: e.target.value })} placeholder="اسم المركبة / اللوحة" />
        </label>
        <label>
          <span>السائق</span>
          <input value={trip.driver} onChange={(e) => setTrip({ ...trip, driver: e.target.value })} placeholder="اسم السائق" />
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
              <th>نوع الطرود</th>
              <th>عدد الطرود</th>
              <th>الوزن كغ</th>
              <th className="wide">المرسل</th>
              <th className="wide">المرسل إليه</th>
              <th>تحصيل $</th>
              <th>دفع مسبق $</th>
              <th>حوالة</th>
              <th>أجرة الحوالة</th>
              <th title="يُملأ تلقائياً من تعريف الأسعار عند تطابق المسار ونوع الطرود والتاريخ؛ يمكنك التعديل يدوياً">الأجور $</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const started = isRowStarted(row);
              const locked = Boolean(row.loadedAt);
              const posted = Boolean(row.postedShipmentId);
              const goodsTypeItems = goodsTypeItemsForRow(row, tariffs, cities, branches, goodsTypes, trip.date);
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
                  <td className="quick-ledger-parcel-cell">
                    <AutocompleteInput
                      value={row.parcelType}
                      onChange={(v) => updateRow(row.id, 'parcelType', v)}
                      onSelect={(item) => {
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? mergeRowWithAutoTariff({ ...r, parcelType: item.name, feesManual: false }, tariffs, cities, branches, goodsTypes, trip.date)
                              : r,
                          ),
                        );
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
                                        { ...rr, parcelType: normalized, feesManual: false },
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
                              { ...r, parcelType: matched.name, feesManual: false },
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
                  <td>
                    <input
                      id={`ledger-pc-${row.id}`}
                      data-ledger-field="true"
                      inputMode="numeric"
                      value={row.parcelCount}
                      disabled={locked}
                      onFocus={() => setActiveRowId(row.id)}
                      onKeyDown={focusNext}
                      onBlur={() => recalcTariffFeesForRowId(row.id)}
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
                      onBlur={() => recalcTariffFeesForRowId(row.id)}
                      onChange={(e) => updateRow(row.id, 'weightKg', e.target.value)}
                    />
                  </td>
                  <td>
                    <SmartPartyInput
                      data-ledger-field="true"
                      value={row.sender}
                      onChange={(v) => updateRow(row.id, 'sender', v)}
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
                  <td><input data-ledger-field="true" inputMode="decimal" value={row.fees} disabled={locked} onFocus={() => setActiveRowId(row.id)} onKeyDown={focusNext} onChange={(e) => updateRow(row.id, 'fees', e.target.value)} /></td>
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
