import { httpClient } from '../api/httpClient';

export type QuickLedgerLogLevel = 'info' | 'warn' | 'error' | 'success';

export type QuickLedgerLogEntry = {
  id: string;
  at: string;
  level: QuickLedgerLogLevel;
  phase: string;
  message: string;
  batchId?: string;
  rowLabel?: string;
  receiptNo?: string;
  destination?: string;
  details?: Record<string, unknown>;
};

const STORAGE_KEY = 'quickLedger.log.v1';
const MAX_ENTRIES = 800;

function loadStoredEntries(): QuickLedgerLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QuickLedgerLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistEntries(entries: QuickLedgerLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore quota errors */
  }
}

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatEntryLine(entry: QuickLedgerLogEntry): string {
  const parts = [
    entry.at,
    entry.level.toUpperCase(),
    entry.phase,
    entry.rowLabel ? `row=${entry.rowLabel}` : '',
    entry.receiptNo ? `receipt=${entry.receiptNo}` : '',
    entry.message,
  ].filter(Boolean);
  const details =
    entry.details && Object.keys(entry.details).length
      ? ` | ${JSON.stringify(entry.details)}`
      : '';
  return `${parts.join(' ')}${details}`;
}

class QuickLedgerLogger {
  private entries: QuickLedgerLogEntry[] = loadStoredEntries();

  private currentBatchId: string | null = null;

  getEntries(): QuickLedgerLogEntry[] {
    return [...this.entries];
  }

  getCurrentBatchId(): string | null {
    return this.currentBatchId;
  }

  startBatch(context: Record<string, unknown>): string {
    this.currentBatchId = createId();
    this.log('info', 'batch', 'بدء عملية حفظ دفتر الشحن', {
      batchId: this.currentBatchId,
      details: context,
    });
    return this.currentBatchId;
  }

  endBatch(outcome: 'success' | 'failed' | 'partial', message: string, details?: Record<string, unknown>) {
    const level: QuickLedgerLogLevel =
      outcome === 'success' ? 'success' : outcome === 'partial' ? 'warn' : 'error';
    this.log(level, 'batch', message, { details: { ...(details ?? {}), outcome } });
    this.currentBatchId = null;
  }

  log(
    level: QuickLedgerLogLevel,
    phase: string,
    message: string,
    context?: {
      batchId?: string;
      rowLabel?: string;
      receiptNo?: string;
      destination?: string;
      details?: Record<string, unknown>;
    },
  ) {
    const entry: QuickLedgerLogEntry = {
      id: createId(),
      at: new Date().toISOString(),
      level,
      phase,
      message,
      batchId: context?.batchId ?? this.currentBatchId ?? undefined,
      rowLabel: context?.rowLabel,
      receiptNo: context?.receiptNo,
      destination: context?.destination,
      details: context?.details,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    persistEntries(this.entries);
    void this.flushToServer([entry]);
    return entry;
  }

  clear() {
    this.entries = [];
    this.currentBatchId = null;
    persistEntries([]);
  }

  exportText(): string {
    const header = [
      '=== سجل دفتر الشحن اليومي ===',
      `exportedAt=${new Date().toISOString()}`,
      `entries=${this.entries.length}`,
      '',
    ].join('\n');
    return `${header}${this.entries.map(formatEntryLine).join('\n')}\n`;
  }

  download(filename?: string) {
    const blob = new Blob([this.exportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      filename ?? `quick-ledger-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async flushToServer(entries: QuickLedgerLogEntry[]) {
    try {
      await httpClient.post('/daily-ledger/client-logs', { entries });
    } catch {
      /* local log remains available even if server write fails */
    }
  }
}

export const quickLedgerLog = new QuickLedgerLogger();

export type SaveProgressItemStatus =
  | 'pending'
  | 'running'
  | 'saved'
  | 'posted'
  | 'skipped'
  | 'error';

export type SaveProgressItem = {
  key: string;
  rowLabel: string;
  receiptNo: string;
  destination: string;
  status: SaveProgressItemStatus;
  message?: string;
};

export type SaveProgressPhase =
  | 'idle'
  | 'preparing'
  | 'validating'
  | 'upserting'
  | 'posting'
  | 'done'
  | 'failed';

export type SaveProgressState = {
  open: boolean;
  phase: SaveProgressPhase;
  phaseLabel: string;
  items: SaveProgressItem[];
  completedCount: number;
  totalCount: number;
  startedAt: string;
  finishedAt?: string;
  batchId: string;
  summary?: string;
  alreadyPostedCount?: number;
};

export function createInitialSaveProgress(): SaveProgressState {
  return {
    open: false,
    phase: 'idle',
    phaseLabel: '',
    items: [],
    completedCount: 0,
    totalCount: 0,
    startedAt: '',
    batchId: '',
  };
}

export function rowProgressLabel(row: { id: number; serverRowNo?: number }) {
  return String(row.serverRowNo ?? row.id);
}

export function buildSaveProgressItems(
  rows: Array<{ id: number; serverRowNo?: number; receiptNo: string; destination: string }>,
): SaveProgressItem[] {
  return rows.map((row) => ({
    key: String(row.id),
    rowLabel: rowProgressLabel(row),
    receiptNo: row.receiptNo.trim(),
    destination: row.destination.trim(),
    status: 'pending',
  }));
}

export function applySaveProgressItemPatch(
  prev: SaveProgressState,
  key: string,
  patch: Partial<SaveProgressItem>,
): SaveProgressState {
  const items = prev.items.map((item) => (item.key === key ? { ...item, ...patch } : item));
  const completedCount = items.filter((item) =>
    ['saved', 'posted', 'skipped', 'error'].includes(item.status),
  ).length;
  return { ...prev, items, completedCount };
}

export type FailedSaveRowMap = Record<number, string>;

export function failedRowsStorageKey(ledgerDate: string, lineLabel: string) {
  return `quickLedger.failedRows.${ledgerDate}.${lineLabel}`;
}

export function loadFailedSaveRows(ledgerDate: string, lineLabel: string): FailedSaveRowMap {
  try {
    const raw = sessionStorage.getItem(failedRowsStorageKey(ledgerDate, lineLabel));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: FailedSaveRowMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value) out[Number(key)] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistFailedSaveRows(
  ledgerDate: string,
  lineLabel: string,
  map: FailedSaveRowMap,
) {
  try {
    const serialized: Record<string, string> = {};
    for (const [rowId, message] of Object.entries(map)) {
      if (message) serialized[String(rowId)] = message;
    }
    const storageKey = failedRowsStorageKey(ledgerDate, lineLabel);
    if (!Object.keys(serialized).length) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(serialized));
  } catch {
    /* ignore quota errors */
  }
}

export function failedRowsFromProgressItems(items: SaveProgressItem[]): FailedSaveRowMap {
  const out: FailedSaveRowMap = {};
  for (const item of items) {
    if (item.status === 'error') {
      out[Number(item.key)] = item.message ?? 'خطأ في الحفظ';
    }
  }
  return out;
}

export function pruneFailedSaveRows(
  map: FailedSaveRowMap,
  postedRowIds: Set<number>,
): FailedSaveRowMap {
  const next: FailedSaveRowMap = { ...map };
  for (const rowId of postedRowIds) {
    delete next[rowId];
  }
  return next;
}
