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
  X,
} from 'lucide-react';
import { getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import {
  buildLedgerRowsQueryScope,
  fetchAllDailyLedgerRows,
} from '../../lib/shipping/dailyLedgerScope';
import { dedupeDailyLedgerRowsById } from '../../lib/shipping/dailyLedgerPrintable';
import { filterRemoteRowsBySearch, sortRemoteRowsChronological } from '../../lib/shipping/dailyLedgerRowFilter';
import type { RemoteDailyLedgerRow } from '../../lib/shipping/dailyLedgerTypes';
import {
  ALL_DRIVERS_PRINT_KEY,
  buildCatalogDriverOptions,
  buildDestinationSummaries,
  filterRowsForPrintHub,
  type PrintHubDriverSelection,
  type PrintHubMode,
} from '../../lib/shipping/quickLedgerPrintHub';
import type { Branch, Driver, Vehicle } from '../../types';

export type QuickLedgerPrintHubOpenOptions = {
  mode?: PrintHubMode;
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
  canExportPdf: boolean;
  canPickFutureDate: boolean;
  canPickHistoricalDate: boolean;
  todayIso: string;
  currentTripDriverId?: number;
  disabled?: boolean;
  onPrintShipments: (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => Promise<void>;
  onPrintReceipts: (rows: RemoteDailyLedgerRow[], meta: QuickLedgerPrintHubMeta) => Promise<void>;
  onExportDestinationPdf?: (
    rows: RemoteDailyLedgerRow[],
    meta: QuickLedgerPrintHubMeta,
  ) => Promise<void>;
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
    const [selectedDate, setSelectedDate] = useState(ledgerDate);
    const [selectedLine, setSelectedLine] = useState(lineLabel);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [baseRows, setBaseRows] = useState<RemoteDailyLedgerRow[]>([]);
    const [driverKey, setDriverKey] = useState(ALL_DRIVERS_PRINT_KEY);
    const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
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
        const preferredKey = tripDriverBackendId
          ? `id:${tripDriverBackendId.toLowerCase()}`
          : ALL_DRIVERS_PRINT_KEY;
        const catalogOptions = buildCatalogDriverOptions(
          drivers,
          printableRows,
          (id) => getBackendIdFromSynthetic(id) ?? null,
          (backendId) => buildVehicleIdsForDriverBackendId(backendId),
        );
        const hasPreferred = catalogOptions.some(
          (item) => item.key === preferredKey || item.key === `id:${tripDriverBackendId}`,
        );
        setDriverKey(hasPreferred ? preferredKey : ALL_DRIVERS_PRINT_KEY);
      } catch (error) {
        setBaseRows([]);
        setSelectedDestinations([]);
        setDriverKey(ALL_DRIVERS_PRINT_KEY);
        onToast(error instanceof Error ? error.message : 'تعذر تحميل أسطر الدفتر للطباعة', 'error');
      } finally {
        setLoading(false);
      }
    };

    useImperativeHandle(ref, () => ({
      open: (options) => {
        setMode(options?.mode ?? 'destination');
        setOpen(true);
        onPreparePrint?.();
      },
    }));

    useEffect(() => {
      if (!open) return;
      void loadRows();
    }, [open, selectedDate, selectedLine, selectedBranchId, includeLoaded, searchQuick]);

    const buildVehicleIdsForDriverBackendId = (driverBackendId: string) => {
      const normalizedDriverId = driverBackendId.trim().toLowerCase();
      const vehicleIds = new Set<string>();
      for (const vehicle of vehicles) {
        const vehicleDriverBackendId = vehicle.driverId ? getBackendIdFromSynthetic(vehicle.driverId) : undefined;
        if (!vehicleDriverBackendId || vehicleDriverBackendId.toLowerCase() !== normalizedDriverId) continue;
        const vehicleBackendId = getBackendIdFromSynthetic(vehicle.id);
        if (vehicleBackendId) vehicleIds.add(vehicleBackendId.toLowerCase());
      }
      return vehicleIds;
    };

    const driverOptions = useMemo(
      () =>
        buildCatalogDriverOptions(
          drivers,
          baseRows,
          (id) => getBackendIdFromSynthetic(id) ?? null,
          (backendId) => buildVehicleIdsForDriverBackendId(backendId),
        ),
      [baseRows, drivers, vehicles],
    );

    const selectedDriver = useMemo(() => {
      if (driverKey === ALL_DRIVERS_PRINT_KEY) return undefined;
      if (driverKey.startsWith('id:')) {
        const backendId = driverKey.slice(3).trim().toLowerCase();
        return drivers.find(
          (driver) => (getBackendIdFromSynthetic(driver.id) ?? '').toLowerCase() === backendId,
        );
      }
      if (driverKey.startsWith('label:')) {
        const label = driverKey.slice(6);
        return drivers.find((driver) => normalizeLabel(driver.name) === label);
      }
      return undefined;
    }, [driverKey, drivers]);

    const selectedDriverFilter = useMemo<PrintHubDriverSelection | null>(() => {
      if (driverKey === ALL_DRIVERS_PRINT_KEY) return null;
      const backendId = selectedDriver
        ? getBackendIdFromSynthetic(selectedDriver.id) ?? null
        : driverKey.startsWith('id:')
          ? driverKey.slice(3)
          : null;
      const vehicleIdsForDriver = backendId
        ? buildVehicleIdsForDriverBackendId(backendId)
        : undefined;
      return {
        backendId,
        name: selectedDriver?.name ?? (driverKey.startsWith('label:') ? driverKey.slice(6) : undefined),
        code: selectedDriver?.code,
        vehicleIdsForDriver,
      };
    }, [driverKey, selectedDriver, vehicles]);

    const driverScopedRows = useMemo(
      () =>
        selectedDriverFilter
          ? filterRowsForPrintHub(baseRows, {
              searchQuery: searchQuick,
              agents: catalogAgents,
              driverSelection: selectedDriverFilter,
            })
          : baseRows,
      [baseRows, catalogAgents, searchQuick, selectedDriverFilter],
    );

    const filteredDestinationSummaries = useMemo(
      () => buildDestinationSummaries(driverScopedRows),
      [driverScopedRows],
    );

    const filteredDestinationList = useMemo(() => {
      const query = destinationSearch.trim().toLowerCase();
      const source = filteredDestinationSummaries;
      if (!query) return source;
      return source.filter((item) => item.destination.toLowerCase().includes(query));
    }, [destinationSearch, filteredDestinationSummaries]);

    const buildFilteredRows = (input: { destinations?: string[] }) =>
      filterRowsForPrintHub(baseRows, {
        searchQuery: searchQuick,
        agents: catalogAgents,
        driverSelection: selectedDriverFilter,
        selectedDestinations: input.destinations,
      });

    const previewDestinationRows = useMemo(
      () =>
        buildFilteredRows({
          destinations: selectedDestinations,
        }),
      [baseRows, driverKey, selectedDriverFilter, selectedDestinations, searchQuick],
    );

    const previewReceiptRows = useMemo(
      () =>
        buildFilteredRows({
          destinations: selectedDestinations,
        }),
      [baseRows, driverKey, selectedDriverFilter, selectedDestinations, searchQuick],
    );

    const buildMeta = (
      rows: RemoteDailyLedgerRow[],
      hubMode: QuickLedgerPrintHubMeta['mode'],
      scope: QuickLedgerPrintHubMeta['scope'],
      scopeLabel: string,
      title: string,
    ): QuickLedgerPrintHubMeta => {
      const rowDestinations = [...new Set(rows.map((row) => normalizeLabel(row.destination)).filter(Boolean))];
      const orderedDestinations =
        selectedDestinations.length
          ? selectedDestinations.filter((destination) => rowDestinations.includes(destination))
          : rowDestinations.sort((a, b) => a.localeCompare(b, 'ar'));
      const destinationLabel = orderedDestinations.length ? orderedDestinations.join('، ') : '—';
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

    const runShipments = async () => {
      if (busy || loading) return;
      const rows = previewDestinationRows;
      if (!rows.length) {
        const driverLabel = selectedDriverFilter?.name || selectedDriverFilter?.code;
        onToast(
          driverLabel
            ? `لا توجد أسطر للسائق «${driverLabel}» ضمن الوجهات المحددة — جرّب «كل السائقين» أو وجهات أخرى`
            : 'لا توجد أسطر مطابقة لمعايير الطباعة',
          'info',
        );
        return;
      }
      if (!selectedDestinations.length) {
        onToast('يرجى تحديد وجهة واحدة على الأقل', 'error');
        return;
      }

      const scopeLabel = `جهات: ${selectedDestinations.length}`;
      const title = searchQuick.trim()
        ? `دفتر الشحن — ${searchQuick.trim()}`
        : 'دفتر الشحن — حسب الجهة';

      setBusy(true);
      try {
        await onPrintShipments(rows, buildMeta(rows, 'destination', 'destination', scopeLabel, title));
        setOpen(false);
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
      const scopeLabel = `إيصالات — ${selectedDestinations.length} وجهة`;
      const title = searchQuick.trim()
        ? `إيصالات — ${searchQuick.trim()}`
        : 'إيصالات — دفتر الشحن';

      setBusy(true);
      try {
        await onPrintReceipts(
          rows,
          buildMeta(rows, 'receipts', 'receipts', scopeLabel, title),
        );
        setOpen(false);
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
        const driverLabel = selectedDriverFilter?.name || selectedDriverFilter?.code;
        onToast(
          driverLabel
            ? `لا توجد أسطر للسائق «${driverLabel}» ضمن الوجهات المحددة — جرّب «كل السائقين» أو وجهات أخرى`
            : 'لا توجد أسطر متاحة للتصدير',
          'info',
        );
        return;
      }
      const scopeLabel = `جهات: ${selectedDestinations.length}`;
      const title = searchQuick.trim()
        ? `دفتر الشحن — ${searchQuick.trim()}`
        : 'دفتر الشحن — حسب الجهة';

      setBusy(true);
      try {
        await onExportDestinationPdf(
          rows,
          buildMeta(rows, 'destination', 'destination', scopeLabel, title),
        );
        setOpen(false);
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'تعذر تصدير ملفات PDF', 'error');
      } finally {
        setBusy(false);
      }
    };

    const previewRows = mode === 'receipts' ? previewReceiptRows : previewDestinationRows;

    const previewPieces = previewRows.reduce((sum, row) => sum + (Number(row.parcel_count) || 0), 0);

    const showDestinationPicker = mode === 'destination' || mode === 'receipts';

    const destinationPickerPanel = showDestinationPicker ? (
      <section className="quick-ledger-print-hub-panel">
        <div className="quick-ledger-print-hub-panel-head">
          <h3>{mode === 'receipts' ? 'اختر الجهات للإيصالات' : 'اختر الجهات'}</h3>
          <div className="quick-ledger-print-hub-panel-actions">
            <button
              type="button"
              disabled={!filteredDestinationSummaries.length || busy || loading}
              onClick={() => setSelectedDestinations(filteredDestinationSummaries.map((item) => item.destination))}
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
            value={driverOptions.some((item) => item.key === driverKey) ? driverKey : ALL_DRIVERS_PRINT_KEY}
            disabled={busy || loading}
            onChange={(e) => setDriverKey(e.target.value)}
          >
            <option value={ALL_DRIVERS_PRINT_KEY}>كل السائقين</option>
            {driverOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} ({option.rowsCount})
              </option>
            ))}
          </select>
          {!driverOptions.length && !loading ? (
            <p className="quick-ledger-print-hub-driver-empty-hint" role="status">
              لا يوجد سائقون في الكتالوج — أضف السائقين من الإعدادات أو اختر «كل السائقين».
            </p>
          ) : null}
          {selectedDriverFilter && driverScopedRows.length === 0 ? (
            <p className="quick-ledger-print-hub-driver-empty-hint" role="status">
              لا توجد أسطر لهذا السائق في النطاق الحالي — اختر «كل السائقين» أو غيّر التاريخ/الفرع.
            </p>
          ) : null}
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
            }}
          >
            <div className="quick-ledger-print-hub-dialog" dir="rtl" onClick={(event) => event.stopPropagation()}>
              <header className="quick-ledger-print-hub-dialog-hero">
                <div className="quick-ledger-print-hub-dialog-hero-text">
                  <span className="quick-ledger-print-hub-dialog-eyebrow">دفتر الشحن اليومي</span>
                  <h2 id="quick-ledger-print-hub-title">طباعة وتصدير</h2>
                  <p>
                    اختر طريقة الطباعة: حسب الجهة أو إيصالات محمود المطبوعة مسبقاً.
                  </p>
                </div>
                <button
                  type="button"
                  className="quick-ledger-print-hub-dialog-close"
                  aria-label="إغلاق"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  <X size={20} />
                </button>
              </header>

              <div className="quick-ledger-print-hub-dialog-body">
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

              </div>

              <footer className="quick-ledger-print-hub-dialog-footer">
                <button
                  type="button"
                  className="quick-ledger-print-hub-footer-btn"
                  disabled={busy}
                  onClick={() => setOpen(false)}
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
