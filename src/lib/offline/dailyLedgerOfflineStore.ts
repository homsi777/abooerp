import { OFFLINE_STORES, createOfflineId, openOfflineDb, withOfflineStore } from './indexedDb';

export type DailyLedgerDraftStatus = 'draft' | 'pending_sync' | 'synced' | 'failed' | 'conflict';

export type DailyLedgerDraftRecord = {
  clientRowId: string;
  serverRowId?: string | null;
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
  sessionId?: string | null;
  rowNo: number;
  receiptNo?: string;
  payload: Record<string, unknown>;
  status: DailyLedgerDraftStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
};

export type DailyLedgerSyncAuditRecord = {
  id: string;
  eventType: string;
  clientRowId?: string;
  serverRowId?: string | null;
  message: string;
  createdAt: string;
};

export type DailyLedgerDraftContext = {
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
  sessionId?: string | null;
};

export async function isDailyLedgerOfflineStoreAvailable(): Promise<boolean> {
  return Boolean(await openOfflineDb());
}

export async function putDailyLedgerDraft(record: DailyLedgerDraftRecord): Promise<void> {
  await withOfflineStore<IDBValidKey>(
    OFFLINE_STORES.dailyLedgerDrafts,
    'readwrite',
    (store) => store.put(record),
  );
}

export async function markDailyLedgerDraftSynced(
  clientRowId: string,
  serverRowId?: string | null,
): Promise<void> {
  await withOfflineStore<void>(OFFLINE_STORES.dailyLedgerDrafts, 'readwrite', (store) => {
    const getRequest = store.get(clientRowId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result as DailyLedgerDraftRecord | undefined;
      if (!existing) return;
      store.put({
        ...existing,
        serverRowId: serverRowId ?? existing.serverRowId ?? null,
        status: 'synced',
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
    };
  });
}

export async function markDailyLedgerDraftPending(
  clientRowId: string,
  message?: string,
): Promise<void> {
  await withOfflineStore<void>(OFFLINE_STORES.dailyLedgerDrafts, 'readwrite', (store) => {
    const getRequest = store.get(clientRowId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result as DailyLedgerDraftRecord | undefined;
      if (!existing) return;
      store.put({
        ...existing,
        status: 'pending_sync',
        lastError: message ?? existing.lastError ?? null,
        updatedAt: new Date().toISOString(),
      });
    };
  });
}

export async function listDailyLedgerDrafts(
  context: DailyLedgerDraftContext,
): Promise<DailyLedgerDraftRecord[]> {
  const db = await openOfflineDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.dailyLedgerDrafts, 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.dailyLedgerDrafts);
    const index = store.index('context');
    const request = index.getAll(IDBKeyRange.only([context.branchId, context.ledgerDate, context.lineLabel]));
    request.onsuccess = () => {
      const rows = (request.result as DailyLedgerDraftRecord[]).filter(
        (row) => !context.sessionId || !row.sessionId || row.sessionId === context.sessionId,
      );
      resolve(rows.sort((a, b) => a.rowNo - b.rowNo || a.updatedAt.localeCompare(b.updatedAt)));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function countPendingDailyLedgerDrafts(context?: Partial<DailyLedgerDraftContext>): Promise<number> {
  const db = await openOfflineDb();
  if (!db) return 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.dailyLedgerDrafts, 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.dailyLedgerDrafts);
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = request.result as DailyLedgerDraftRecord[];
      resolve(
        rows.filter((row) => {
          if (row.status === 'synced') return false;
          if (context?.branchId && row.branchId !== context.branchId) return false;
          if (context?.ledgerDate && row.ledgerDate !== context.ledgerDate) return false;
          if (context?.lineLabel && row.lineLabel !== context.lineLabel) return false;
          if (context?.sessionId && row.sessionId && row.sessionId !== context.sessionId) return false;
          return true;
        }).length,
      );
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addDailyLedgerSyncAudit(
  record: Omit<DailyLedgerSyncAuditRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): Promise<void> {
  const audit: DailyLedgerSyncAuditRecord = {
    id: record.id ?? createOfflineId('audit'),
    eventType: record.eventType,
    clientRowId: record.clientRowId,
    serverRowId: record.serverRowId,
    message: record.message,
    createdAt: record.createdAt ?? new Date().toISOString(),
  };
  await withOfflineStore<IDBValidKey>(
    OFFLINE_STORES.dailyLedgerSyncAudit,
    'readwrite',
    (store) => store.put(audit),
  );
}
