export const OFFLINE_DB_NAME = 'abooerp_offline';
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORES = {
  dailyLedgerDrafts: 'daily_ledger_drafts',
  dailyLedgerSyncAudit: 'daily_ledger_sync_audit',
} as const;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORES.dailyLedgerDrafts)) {
        const drafts = db.createObjectStore(OFFLINE_STORES.dailyLedgerDrafts, { keyPath: 'clientRowId' });
        drafts.createIndex('context', ['branchId', 'ledgerDate', 'lineLabel'], { unique: false });
        drafts.createIndex('status', 'status', { unique: false });
        drafts.createIndex('serverRowId', 'serverRowId', { unique: false });
        drafts.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.dailyLedgerSyncAudit)) {
        const audit = db.createObjectStore(OFFLINE_STORES.dailyLedgerSyncAudit, { keyPath: 'id' });
        audit.createIndex('createdAt', 'createdAt', { unique: false });
        audit.createIndex('eventType', 'eventType', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[offline] IndexedDB unavailable', request.error);
      resolve(null);
    };
    request.onblocked = () => {
      console.warn('[offline] IndexedDB upgrade blocked');
      resolve(null);
    };
  });

  return dbPromise;
}

export async function withOfflineStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<IDBRequest<T> | T> | T,
): Promise<T | null> {
  const db = await openOfflineDb();
  if (!db) return null;

  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let settled = false;

    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    tx.onerror = () => {
      if (settled) return;
      settled = true;
      reject(tx.error);
    };
    tx.onabort = () => {
      if (settled) return;
      settled = true;
      reject(tx.error);
    };

    Promise.resolve(run(store))
      .then((result) => {
        if (result && typeof result === 'object' && 'onsuccess' in result && 'onerror' in result) {
          const request = result as IDBRequest<T>;
          request.onsuccess = () => finish(request.result);
          request.onerror = () => reject(request.error);
          return;
        }
        tx.oncomplete = () => finish((result as T) ?? null);
      })
      .catch(reject);
  });
}

export function createOfflineId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
