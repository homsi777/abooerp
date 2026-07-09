import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  CalendarDays,
  FileDown,
  MapPin,
  Package,
  Printer,
  Receipt,
  Truck,
  X,
} from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  buildLedgerRowsQueryScope,
  fetchAllDailyLedgerRows,
} from '../../lib/shipping/dailyLedgerScope';
import { dedupeDailyLedgerRowsById } from '../../lib/shipping/dailyLedgerPrintable';
import { filterRemoteRowsBySearch, sortRemoteRowsChronological } from '../../lib/shipping/dailyLedgerRowFilter';
import type { DailyLedgerDispatchDefinition } from '../../lib/shipping/dailyLedgerDispatchGateway';
import type { RemoteDailyLedgerRow } from '../../lib/shipping/dailyLedgerTypes';
import {
  ALL_DRIVERS_PRINT_KEY,
  buildCatalogDriverOptions,
  buildDestinationSummaries,
  buildDispatchSummaries,
  filterRowsForPrintHub,
  type PrintHubMode,
} from '../../lib/shipping/quickLedgerPrintHub';
import type { Branch, Driver, Vehicle } from '../../types';

export type QuickLedgerPrintHubOpenOptions = {
  mode?: PrintHubMode;
  sessionOnly?: boolean;
};

export type QuickLedgerPrintHubHandle = {
  open: (options?: QuickLedgerPrintHubOpenOptions) => void;
};

export type QuickLedgerPrintHubMeta = {
  mode: PrintHubMode | 'session';
  scope: 'destination' | 'dispatch' | 'receipts' | 'session';
  scopeLabel: string;
  title: string;
  driverLabel: string;
  destinationLabel: string;
  activeSearch: string;
  selectedDriver?: Driver;
  ledgerDate: string;
  lineLabel: string;
};

type QuickLedgerPrintHubProps = {
  ledgerDate: string;
  lineLabel: string;
  lineOptions: string[];
  branches: Branch[];
  canPickBranch: boolean;
  preferredBranchId: string | null;
  lockedBranchId: string | null;
  canViewAllBranches: boolean;
  includeLoaded: boolean;
  searchQuick: string;
  catalogAgents: Array<{ id: number; code: string; name: string; governorate?: string; city?: string; area?: string }>;
  remoteRowsRaw: RemoteDailyLedgerRow[];
  drivers: Driver[];
  vehicles: Vehicle[];
  dispatchDefinitions: DailyLedgerDispatchDefinition[];
  activeSessionId: string | null;
  activeSessionLabel?: string;
  canExportPdf: boolean;
  canPickFutureDate: boolean;
  canPickHistoricalDate: boolean;
  todayIso: string;
  currentTripDriverId?: number;
  disabled?: boolean;
  onPrintShipments: (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => Promise<void>;
  onPrintReceipts: (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => Promise<void>;
  onExportDestinationPdf?: (input: {
    rows: RemoteDailyLedgerRow[];
    destinations: string[];
    driverKey: string;
    ledgerDate: string;
    lineLabel: string;
  }) => Promise<void>;
  onToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  onPreparePrint?: () => void;
};

function resolveBranchBackendId(branch: Branch | undefined): string | null {
  if (!branch) return null;
  return getBackendIdFromSynthetic(branch.id) ?? null;
}

function normalizeLabel(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

const QuickLedgerPrintHub = forwardRef<QuickLedgerPrintHubHandle, QuickLedgerPrintHubProps>(
  function QuickLedgerPrintHub(
    {
      ledgerDate,
      lineLabel,
      lineOptions,
      branches,
      canPickBranch,
      preferredBranchId,
      lockedBranchId,
      canViewAllBranches,
      includeLoaded,
      searchQuick,
      catalogAgents,
      remoteRowsRaw,
      drivers,
      vehicles,
      dispatchDefinitions,
      activeSessionId,
      activeSessionLabel,
      canExportPdf,
      canPickFutureDate,
      canPickHistoricalDate,
      todayIso,
      currentTripDriverId = 0,
      disabled = false,
      onPrintShipments,
      onPrintReceipts,
      onExportDestinationPdf,
      onToast,
      onPreparePrint,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<PrintHubMode>('destination');
    const [sessionOnly, setSessionOnly] = useState(false);
    const [selectedDate, setSelectedDate] = useState(ledgerDate);
    const [selectedLine, setSelectedLine] = useState(lineLabel);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [baseRows, setBaseRows] = useState<RemoteDailyLedgerRow[]>([]);
    const [driverKey, setDriverKey] = useState(ALL_DRIVERS_PRINT_KEY);
    const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
    const [selectedDispatchIds, setSelectedDispatchIds] = useState<string[]>([]);
    const [destinationSearch, setDestinationSearch] = useState('');

    const branchOptions = useMemo(
      () =>
        branches
          .map((branch) => ({
            branch,
            backendId: resolveBranchBackendId(branch),
          }))
          .filter((item): item is { branch: Branch; backendId: string } => Boolean(item.backendId)),
      [branches],
    );

    useEffect(() => {
      const fallbackBranchId =
        lockedBranchId ||
        preferredBranchId ||
        branchOptions[0]?.backendId ||
        '';
      setSelectedBranchId((prev) => {
        if (lockedBranchId) return lockedBranchId;
        if (canViewAllBranches && !preferredBranchId) return prev || '';
        if (prev && branchOptions.some((item) => item.backendId === prev)) return prev;
        return fallbackBranchId;
      });
    }, [branchOptions, canViewAllBranches, lockedBranchId, preferredBranchId]);

    useEffect(() => {
      setSelectedLine((prev) => {
        const next = lineLabel.trim() || prev;
        if (next) return next;
        return lineOptions[0] ?? '';
      });
    }, [lineLabel, lineOptions]);

    useEffect(() => {
      if (open) setSelectedDate(ledgerDate || selectedDate);
    }, [ledgerDate, open]);

    const selectedBranchName = useMemo(() => {
      const hit = branchOptions.find((item) => item.backendId === selectedBranchId);
      return hit?.branch.name ?? '—';
    }, [branchOptions, selectedBranchId]);

    const scopeBlockedReason = useMemo(() => {
      if (!selectedDate) return 'اختر التاريخ من شاشة الدفتر أو من النافذة أدناه.';
      if (!canViewAllBranches) {
        if (!selectedBranchId) return 'اختر الفرع من القائمة أدناه.';
        if (!selectedLine.trim()) return 'اختر الخط (مصدر البضاعة) من القائمة أدناه.';
      }
      return null;
    }, [canViewAllBranches, selectedBranchId, selectedDate, selectedLine]);

    const loadRows = async () => {
      if (scopeBlockedReason) return;
      setLoading(true);
      try {
        const viewAll = canViewAllBranches && !selectedBranchId;
        const line = normalizeLabel(selectedLine);
        const queryScope = buildLedgerRowsQueryScope(
          selectedBranchId || preferredBranchId || '',
          selectedDate,
          line,
          includeLoaded,
          {
            managerViewAllBranches: viewAll,
            allLines: viewAll || !line,
          },
        );
        const fetched = await fetchAllDailyLedgerRows(queryScope);
        const searchFiltered = filterRemoteRowsBySearch(fetched, searchQuick, catalogAgents);
        const sameDayAsScreen = selectedDate === ledgerDate;
        const merged =
          searchQuick.trim() && sameDayAsScreen
            ? dedupeDailyLedgerRowsById([...remoteRowsRaw, ...searchFiltered])
            : searchFiltered;
        const printableRows = sortRemoteRowsChronological(merged);
        setBaseRows(printableRows);

        const destinations = buildDestinationSummaries(printableRows);
        setSelectedDestinations(destinations.map((item) => item.destination));

        const tripDriverBackendId = currentTripDriverId
          ? getBackendIdFromSynthetic(currentTripDriverId) ?? null
          : null;
        const preferredKey = tripDriverBackendId ? `id:${tripDriverBackendId}` : ALL_DRIVERS_PRINT_KEY;
        const catalogOptions = buildCatalogDriverOptions(drivers, printableRows, (id) =>
          getBackendIdFromSynthetic(id) ?? null,
        );
        const hasPreferred = catalogOptions.some((item) => item.key === preferredKey);
        setDriverKey(hasPreferred ? preferredKey : ALL_DRIVERS_PRINT_KEY);

        const dispatchSummaries = buildDispatchSummaries(
          dispatchDefinitions,
          printableRows,
          viewAll ? null : selectedBranchId,
        );
        setSelectedDispatchIds(dispatchSummaries.map((item) => item.id));
      } catch (error) {
        setBaseRows([]);
        setSelectedDestinations([]);
        setSelectedDispatchIds([]);
        setDriverKey(ALL_DRIVERS_PRINT_KEY);
        onToast(error instanceof Error ? error.message : 'تعذر تحميل أسطر الدفتر للطباعة', 'error');
      } finally {
        setLoading(false);
      }
    };

    useImperativeHandle(ref, () => ({
      open: (options) => {
        setMode(options?.mode ?? 'destination');
        setSessionOnly(Boolean(options?.sessionOnly));
        setOpen(true);
        onPreparePrint?.();
      },
    }));

    useEffect(() => {
      if (!open) return;
      void loadRows();
    }, [open, selectedDate, selectedLine, selectedBranchId, includeLoaded, searchQuick]);

    const destinationSummaries = useMemo(() => buildDestinationSummaries(baseRows), [baseRows]);
    const driverOptions = useMemo(
      () =>
        buildCatalogDriverOptions(drivers, baseRows, (id) => getBackendIdFromSynthetic(id) ?? null),
      [baseRows, drivers],
    );
    const dispatchSummaries = useMemo(
      () =>
        buildDispatchSummaries(
          dispatchDefinitions,
          baseRows,
          canViewAllBranches && !selectedBranchId ? null : selectedBranchId,
        ),
      [baseRows, canViewAllBranches, dispatchDefinitions, selectedBranchId],
    );

    const filteredDestinationList = useMemo(() => {
      const query = destinationSearch.trim().toLowerCase();
      if (!query) return destinationSummaries;
      return destinationSummaries.filter((item) => item.destination.toLowerCase().includes(query));
    }, [destinationSearch, destinationSummaries]);

    const selectedDriver = useMemo(() => {
      if (driverKey === ALL_DRIVERS_PRINT_KEY) return undefined;
      if (driverKey.startsWith('id:')) {
        const backendId = driverKey.slice(3);
        return drivers.find((driver) => getBackendIdFromSynthetic(driver.id) === backendId);
      }
      if (driverKey.startsWith('label:')) {
        const label = driverKey.slice(6);
        return drivers.find((driver) => normalizeLabel(driver.name) === label);
      }
      return undefined;
    }, [driverKey, drivers]);

    const driverBackendId = selectedDriver ? getBackendIdFromSynthetic(selectedDriver.id) ?? undefined : undefined;
    const vehicleIdsForDriver = useMemo(() => {
      if (!driverBackendId) return undefined;
      const normalizedDriverId = driverBackendId.trim().toLowerCase();
      const vehicleIds = new Set<string>();
      for (const vehicle of vehicles) {
        const vehicleDriverBackendId = vehicle.driverId ? getBackendIdFromSynthetic(vehicle.driverId) : undefined;
        if (!vehicleDriverBackendId || vehicleDriverBackendId.toLowerCase() !== normalizedDriverId) continue;
        const vehicleBackendId = getBackendIdFromSynthetic(vehicle.id);
        if (vehicleBackendId) vehicleIds.add(vehicleBackendId.toLowerCase());
      }
      return vehicleIds;
    }, [driverBackendId, vehicles]);

    const buildFilteredRows = (input: {
      destinations?: string[];
      dispatchIds?: string[];
      forceSession?: boolean;
    }) =>
      filterRowsForPrintHub(baseRows, {
        searchQuery: searchQuick,
        agents: catalogAgents,
        driverKey: driverBackendId ? undefined : driverKey,
        driverBackendId,
        driverName: selectedDriver?.name,
        vehicleIdsForDriver,
        selectedDestinations: input.destinations,
        selectedDispatchIds: input.dispatchIds,
        sessionId: input.forceSession || sessionOnly ? activeSessionId : null,
      });

    const previewDestinationRows = useMemo(
      () =>
        buildFilteredRows({
          destinations: selectedDestinations,
          forceSession: sessionOnly,
        }),
      [
        baseRows,
        driverKey,
        driverBackendId,
        selectedDriver,
        selectedDestinations,
        sessionOnly,
        activeSessionId,
        searchQuick,
      ],
    );

    const previewDispatchRows = useMemo(
      () =>
        buildFilteredRows({
          dispatchIds: selectedDispatchIds,
          forceSession: sessionOnly,
        }),
      [baseRows, driverKey, driverBackendId, selectedDispatchIds, sessionOnly, activeSessionId, searchQuick],
    );

    const previewReceiptRows = useMemo(
      () =>
        buildFilteredRows({
          destinations: selectedDestinations,
          forceSession: sessionOnly,
        }),
      [
        baseRows,
        driverKey,
        driverBackendId,
        selectedDestinations,
        sessionOnly,
        activeSessionId,
        searchQuick,
      ],
    );

    const buildMeta = (
      rows: RemoteDailyLedgerRow[],
      hubMode: QuickLedgerPrintHubMeta['mode'],
      scope: QuickLedgerPrintHubMeta['scope'],
      scopeLabel: string,
      title: string,
    ): QuickLedgerPrintHubMeta => {
      const destinations = [...new Set(rows.map((row) => normalizeLabel(row.destination)).filter(Boolean))];
      const destinationLabel =
        destinations.length === 1
          ? destinations[0]
          : destinations.length > 1
            ? `${destinations.length} وجهات`
            : '—';
      const driverNames = [...new Set(rows.map((row) => normalizeLabel(row.driver_label)).filter(Boolean))];
      const driverLabel =
        selectedDriver?.name ??
        (driverNames.length === 1 ? driverNames[0] : driverNames.length > 1 ? `كل السائقين (${driverNames.length})` : scopeLabel);

      return {
        mode: hubMode,
        scope,
        scopeLabel,
        title,
        driverLabel,
        destinationLabel,
        activeSearch: searchQuick.trim(),
        selectedDriver,
        ledgerDate: selectedDate,
        lineLabel: selectedLine.trim() || lineLabel,
      };
    };

    const toggleDestination = (destination: string) => {
      setSelectedDestinations((prev) =>
        prev.includes(destination)
          ? prev.filter((item) => item !== destination)
          : [...prev, destination].sort((a, b) => a.localeCompare(b, 'ar')),
      );
    };

    const toggleDispatch = (dispatchId: string) => {
      setSelectedDispatchIds((prev) =>
        prev.includes(dispatchId) ? prev.filter((item) => item !== dispatchId) : [...prev, dispatchId],
      );
    };

    const runShipments = async () => {
      if (busy || loading) return;
      const rows =
        mode === 'dispatch'
          ? previewDispatchRows
          : previewDestinationRows;
      if (!rows.length) {
        onToast('لا توجد أسطر مطابقة لمعايير الطباعة', 'info');
        return;
      }
      if (mode === 'dispatch' && !selectedDispatchIds.length) {
        onToast('يرجى تحديد إرسالية واحدة على الأقل', 'error');
        return;
      }
      if (mode === 'destination' && !selectedDestinations.length) {
        onToast('يرجى تحديد وجهة واحدة على الأقل', 'error');
        return;
      }

      const scopeLabel =
        sessionOnly && activeSessionLabel
          ? activeSessionLabel
          : mode === 'dispatch'
            ? `إرساليات: ${selectedDispatchIds.length}`
            : mode === 'destination'
              ? `جهات: ${selectedDestinations.length}`
              : 'طباعة';
      const title =
        searchQuick.trim()
          ? `دفتر الشحن — ${searchQuick.trim()}`
          : sessionOnly
            ? `دفتر الشحن — ${activeSessionLabel ?? 'الإرسالية الحالية'}`
            : mode === 'dispatch'
              ? `دفتر الشحن — حسب الإرسالية`
              : `دفتر الشحن — حسب الجهة`;

      setBusy(true);
      try {
        await onPrintShipments(
          rows,
          buildMeta(rows, sessionOnly ? 'session' : mode, sessionOnly ? 'session' : mode, scopeLabel, title),
        );
        setOpen(false);
        setSessionOnly(false);
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'تعذر تنفيذ طباعة الشحنات', 'error');
      } finally {
        setBusy(false);
      }
    };

    const runReceipts = async () => {
      if (busy || loading) return;
      if (!selectedDestinations.length) {
        onToast('يرجى تحديد وجهة واحدة على الأقل', 'error');
        return;
      }
      const rows = previewReceiptRows;
      if (!rows.length) {
        onToast('لا توجد أسطر مطابقة لطباعة الإيصالات', 'info');
        return;
      }
      const scopeLabel = sessionOnly && activeSessionLabel
        ? activeSessionLabel
        : `إيصالات — ${selectedDestinations.length} وجهة`;
      const title = searchQuick.trim()
        ? `إيصالات — ${searchQuick.trim()}`
        : sessionOnly
          ? `إيصالات — ${activeSessionLabel ?? 'الإرسالية الحالية'}`
          : 'إيصالات — دفتر الشحن';

      setBusy(true);
      try {
        await onPrintReceipts(
          rows,
          buildMeta(rows, sessionOnly ? 'session' : 'receipts', sessionOnly ? 'session' : 'receipts', scopeLabel, title),
        );
        setOpen(false);
        setSessionOnly(false);
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'تعذر تنفيذ طباعة الإيصالات', 'error');
      } finally {
        setBusy(false);
      }
    };

    const runPdfExport = async () => {
      if (!onExportDestinationPdf || busy || loading) return;
      if (!selectedDestinations.length) {
        onToast('يرجى تحديد وجهة واحدة على الأقل', 'error');
        return;
      }
      const rows = previewDestinationRows;
      if (!rows.length) {
        onToast('لا توجد أسطر متاحة للتصدير', 'info');
        return;
      }
      setBusy(true);
      try {
        await onExportDestinationPdf({
          rows: baseRows,
          destinations: selectedDestinations,
          driverKey,
          ledgerDate: selectedDate,
          lineLabel:
            canViewAllBranches && !selectedBranchId
              ? 'كل الفروع'
              : normalizeLabel(selectedLine) || lineLabel,
        });
        setOpen(false);
        setSessionOnly(false);
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'تعذر تصدير ملفات PDF', 'error');
      } finally {
        setBusy(false);
      }
    };

    const previewRows =
      mode === 'dispatch' ? previewDispatchRows : mode === 'receipts' ? previewReceiptRows : previewDestinationRows;

    const previewPieces = previewRows.reduce((sum, row) => sum + (Number(row.parcel_count) || 0), 0);

    const showDestinationPicker = mode === 'destination' || mode === 'receipts';

    const destinationPickerPanel = showDestinationPicker ? (
      <section className="quick-ledger-print-hub-panel">
        <div className="quick-ledger-print-hub-panel-head">
          <h3>{mode === 'receipts' ? 'اختر الجهات للإيصالات' : 'اختر الجهات'}</h3>
          <div className="quick-ledger-print-hub-panel-actions">
            <button
              type="button"
              disabled={!destinationSummaries.length || busy || loading}
              onClick={() => setSelectedDestinations(destinationSummaries.map((item) => item.destination))}
            >
              تحديد الكل
            </button>
            <button
              type="button"
              disabled={!selectedDestinations.length || busy || loading}
              onClick={() => setSelectedDestinations([])}
            >
              إلغاء الكل
            </button>
            {mode === 'destination' ? (
              <button type="button" disabled={busy || loading} onClick={() => void loadRows()}>
                {loading ? 'تحديث...' : 'تحديث'}
              </button>
            ) : null}
          </div>
        </div>

        <label className="quick-ledger-print-hub-field">
          <span>تصفية السائق (اختياري)</span>
          <select
            className="quick-ledger-print-hub-input"
            value={driverKey}
            disabled={busy || loading || !drivers.length}
            onChange={(e) => setDriverKey(e.target.value)}
          >
            <option value={ALL_DRIVERS_PRINT_KEY}>كل السائقين</option>
            {driverOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
                {option.rowsCount > 0 ? ` (${option.rowsCount})` : ''}
              </option>
            ))}
          </select>
        </label>

        <input
          className="quick-ledger-print-hub-input quick-ledger-print-hub-destination-search"
          placeholder="بحث في الوجهات..."
          value={destinationSearch}
          disabled={busy || loading}
          onChange={(e) => setDestinationSearch(e.target.value)}
        />

        <div className="quick-ledger-print-hub-destination-list">
          {loading ? (
            <div className="quick-ledger-print-hub-empty">جاري تحميل الوجهات...</div>
          ) : filteredDestinationList.length === 0 ? (
            <div className="quick-ledger-print-hub-empty">لا توجد وجهات في هذا النطاق</div>
          ) : (
            filteredDestinationList.map((item) => (
              <label key={item.destination} className="quick-ledger-print-hub-destination-item">
                <input
                  type="checkbox"
                  checked={selectedDestinations.includes(item.destination)}
                  disabled={busy || loading}
                  onChange={() => toggleDestination(item.destination)}
                />
                <span className="quick-ledger-print-hub-destination-name">{item.destination}</span>
                <span className="quick-ledger-print-hub-destination-count">{item.rowsCount} سطر</span>
              </label>
            ))
          )}
        </div>

        {mode === 'receipts' ? (
          <div className="quick-ledger-print-hub-receipts-summary">
            <Receipt size={18} />
            <div>
              <strong>{previewReceiptRows.length}</strong> إيصال جاهز للطباعة
              {selectedDestinations.length ? (
                <span> — {selectedDestinations.length} وجهة محددة</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    ) : null;

    return (
      <>
        <button
          type="button"
          className="quick-ledger-print-hub-open-btn"
          disabled={disabled}
          title="طباعة كشف الشحن، حسب الجهة أو الإرسالية، أو إيصالات محمود"
          onClick={() => {
            setSessionOnly(false);
            setMode('destination');
            setOpen(true);
            onPreparePrint?.();
          }}
        >
          <Printer size={16} aria-hidden />
          طباعة وتصدير
        </button>

        {open ? (
          <div
            className="quick-ledger-print-hub-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-ledger-print-hub-title"
            onClick={() => {
              if (busy) return;
              setOpen(false);
              setSessionOnly(false);
            }}
          >
            <div className="quick-ledger-print-hub-dialog" dir="rtl" onClick={(event) => event.stopPropagation()}>
              <header className="quick-ledger-print-hub-dialog-hero">
                <div className="quick-ledger-print-hub-dialog-hero-text">
                  <span className="quick-ledger-print-hub-dialog-eyebrow">دفتر الشحن اليومي</span>
                  <h2 id="quick-ledger-print-hub-title">طباعة وتصدير</h2>
                  <p>
                    اختر طريقة الطباعة: حسب الجهة، حسب الإرسالية المعرّفة، أو إيصالات محمود المطبوعة مسبقاً.
                  </p>
                </div>
                <button
                  type="button"
                  className="quick-ledger-print-hub-dialog-close"
                  aria-label="إغلاق"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setSessionOnly(false);
                  }}
                >
                  <X size={20} />
                </button>
              </header>

              <div className="quick-ledger-print-hub-dialog-body">
                {sessionOnly && activeSessionLabel ? (
                  <div className="quick-ledger-print-hub-session-banner" role="status">
                    <Truck size={16} aria-hidden />
                    طباعة الإرسالية الحالية فقط: <strong>{activeSessionLabel}</strong>
                  </div>
                ) : null}

                <section className="quick-ledger-print-hub-context-card">
                  <h3>نطاق البيانات</h3>
                  <div className="quick-ledger-print-hub-context-grid">
                    <label className="quick-ledger-print-hub-field">
                      <span><CalendarDays size={14} aria-hidden /> التاريخ</span>
                      <input
                        className="quick-ledger-print-hub-input"
                        type="date"
                        value={selectedDate}
                        max={canPickFutureDate ? undefined : todayIso}
                        min={canPickHistoricalDate ? undefined : todayIso}
                        disabled={busy || loading}
                        onChange={(e) => setSelectedDate(e.target.value)}
                      />
                    </label>
                    <label className="quick-ledger-print-hub-field">
                      <span><MapPin size={14} aria-hidden /> الخط (مصدر البضاعة)</span>
                      <select
                        className="quick-ledger-print-hub-input"
                        value={selectedLine}
                        disabled={canViewAllBranches && !selectedBranchId ? true : !lineOptions.length || busy || loading}
                        onChange={(e) => setSelectedLine(e.target.value)}
                      >
                        <option value="">{canViewAllBranches && !selectedBranchId ? 'كل الخطوط' : 'اختر الخط...'}</option>
                        {lineOptions.map((line) => (
                          <option key={line} value={line}>
                            {line}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="quick-ledger-print-hub-field">
                      <span>الفرع</span>
                      {canPickBranch ? (
                        <select
                          className="quick-ledger-print-hub-input"
                          value={selectedBranchId}
                          disabled={busy || loading}
                          onChange={(e) => setSelectedBranchId(e.target.value)}
                        >
                        {canViewAllBranches ? (
                          <option value="">كل الفروع</option>
                        ) : (
                          <option value="">اختر الفرع...</option>
                        )}
                          {branchOptions.map(({ branch, backendId }) => (
                            <option key={backendId} value={backendId}>
                              {branch.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="quick-ledger-print-hub-input" value={selectedBranchName} readOnly />
                      )}
                    </label>
                  </div>
                  {searchQuick.trim() ? (
                    <p className="quick-ledger-print-hub-search-hint">
                      البحث النشط <strong>«{searchQuick.trim()}»</strong> — يُطبَّق على الأسطر المعروضة والمطبوعة.
                    </p>
                  ) : null}
                  {scopeBlockedReason ? (
                    <p className="quick-ledger-print-hub-blocked" role="status">
                      {scopeBlockedReason}
                    </p>
                  ) : null}
                </section>

                <div className="quick-ledger-print-hub-mode-tabs" role="tablist" aria-label="طرق الطباعة">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'destination'}
                    className={`quick-ledger-print-hub-mode-tab${mode === 'destination' ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() => setMode('destination')}
                  >
                    <MapPin size={18} />
                    <span>حسب الجهة</span>
                    <small>كشف شحن لوجهات محددة</small>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'dispatch'}
                    className={`quick-ledger-print-hub-mode-tab${mode === 'dispatch' ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() => setMode('dispatch')}
                  >
                    <Truck size={18} />
                    <span>حسب الإرسالية</span>
                    <small>من التعريفات #1، #2…</small>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'receipts'}
                    className={`quick-ledger-print-hub-mode-tab${mode === 'receipts' ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() => setMode('receipts')}
                  >
                    <Receipt size={18} />
                    <span>إيصالات</span>
                    <small>محمود المطبوع مسبقاً</small>
                  </button>
                </div>

                <div className="quick-ledger-print-hub-preview-strip" role="status">
                  <span><Package size={14} /> الأسطر: <strong>{previewRows.length}</strong></span>
                  <span>الطرود: <strong>{previewPieces}</strong></span>
                  {loading ? <span className="quick-ledger-print-hub-loading-label">جاري التحميل...</span> : null}
                </div>

                {destinationPickerPanel}

                {mode === 'dispatch' ? (
                  <section className="quick-ledger-print-hub-panel">
                    <div className="quick-ledger-print-hub-panel-head">
                      <h3>اختر الإرساليات المعرّفة</h3>
                      <div className="quick-ledger-print-hub-panel-actions">
                        <button
                          type="button"
                          disabled={!dispatchSummaries.length || busy || loading}
                          onClick={() => setSelectedDispatchIds(dispatchSummaries.map((item) => item.id))}
                        >
                          تحديد الكل
                        </button>
                        <button
                          type="button"
                          disabled={!selectedDispatchIds.length || busy || loading}
                          onClick={() => setSelectedDispatchIds([])}
                        >
                          إلغاء الكل
                        </button>
                      </div>
                    </div>

                    {dispatchSummaries.length === 0 ? (
                      <div className="quick-ledger-print-hub-empty quick-ledger-print-hub-empty-warn">
                        <Truck size={20} />
                        <p>لا توجد إرساليات معرّفة لهذا التاريخ والخط.</p>
                        <span>استخدم زر «تعريف إرساليات اليوم» من شريط الأدوات أولاً.</span>
                      </div>
                    ) : (
                      <div className="quick-ledger-print-hub-dispatch-grid">
                        {dispatchSummaries.map((item) => (
                          <label
                            key={item.id}
                            className={`quick-ledger-print-hub-dispatch-card${selectedDispatchIds.includes(item.id) ? ' is-selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDispatchIds.includes(item.id)}
                              disabled={busy || loading}
                              onChange={() => toggleDispatch(item.id)}
                            />
                            <span className="quick-ledger-print-hub-dispatch-no">#{item.dispatchNo}</span>
                            <span className="quick-ledger-print-hub-dispatch-driver">{item.driverLabel}</span>
                            <span className="quick-ledger-print-hub-dispatch-vehicle">{item.vehicleLabel}</span>
                            {item.tripNo ? (
                              <span className="quick-ledger-print-hub-dispatch-trip">رحلة {item.tripNo}</span>
                            ) : null}
                            <span className="quick-ledger-print-hub-dispatch-count">{item.rowsCount} سطر</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

              </div>

              <footer className="quick-ledger-print-hub-dialog-footer">
                <button
                  type="button"
                  className="quick-ledger-print-hub-footer-btn"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setSessionOnly(false);
                  }}
                >
                  إلغاء
                </button>
                {mode === 'destination' ? (
                  <>
                    {canExportPdf && onExportDestinationPdf ? (
                      <button
                        type="button"
                        className="quick-ledger-print-hub-footer-btn quick-ledger-print-hub-footer-secondary"
                        disabled={busy || loading || !selectedDestinations.length}
                        onClick={() => void runPdfExport()}
                      >
                        <FileDown size={16} />
                        {busy ? 'جاري التصدير...' : `تصدير PDF (${selectedDestinations.length})`}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="quick-ledger-print-hub-footer-btn quick-ledger-print-hub-footer-primary"
                      disabled={busy || loading || !selectedDestinations.length}
                      onClick={() => void runShipments()}
                    >
                      <Printer size={16} />
                      {busy ? 'جاري الطباعة...' : 'طباعة كشف الشحن'}
                    </button>
                  </>
                ) : null}
                {mode === 'dispatch' ? (
                  <button
                    type="button"
                    className="quick-ledger-print-hub-footer-btn quick-ledger-print-hub-footer-primary"
                    disabled={busy || loading || !selectedDispatchIds.length || !dispatchSummaries.length}
                    onClick={() => void runShipments()}
                  >
                    <Printer size={16} />
                    {busy ? 'جاري الطباعة...' : 'طباعة كشف الشحن'}
                  </button>
                ) : null}
                {mode === 'receipts' ? (
                  <button
                    type="button"
                    className="quick-ledger-print-hub-footer-btn quick-ledger-print-hub-footer-primary"
                    disabled={busy || loading || !selectedDestinations.length || !previewReceiptRows.length}
                    onClick={() => void runReceipts()}
                  >
                    <Receipt size={16} />
                    {busy ? 'جاري الطباعة...' : 'طباعة الإيصالات'}
                  </button>
                ) : null}
              </footer>
            </div>
          </div>
        ) : null}
      </>
    );
  },
);

export default QuickLedgerPrintHub;
