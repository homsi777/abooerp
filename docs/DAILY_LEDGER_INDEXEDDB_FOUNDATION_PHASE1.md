# Daily Ledger IndexedDB Foundation Phase 1

Date: 2026-06-19

## Scope

Implemented a frontend-only IndexedDB foundation for the daily shipping ledger.

This phase did not add a real sync engine, did not replay queued operations to the cloud, did not change backend APIs, did not modify database migrations or schema, and did not change shipment posting, accounting, cashbox, voucher, transfer, or financial posting behavior.

No UI redesign was made. The only visible UI addition is a small cloud/offline status bar on the existing daily ledger page.

## Changed Files

- `src/lib/offline/indexedDb.ts`
- `src/lib/offline/dailyLedgerOfflineStore.ts`
- `src/lib/offline/useCloudConnectionStatus.ts`
- `src/pages/ShipmentQuickLedger.tsx`
- `src/index.css`
- `docs/DAILY_LEDGER_INDEXEDDB_FOUNDATION_PHASE1.md`

## IndexedDB Stores

Database name: `abooerp_offline`

Version: `1`

Stores added:

- `daily_ledger_drafts`
- `daily_ledger_sync_audit`

### `daily_ledger_drafts`

Key: `clientRowId`

Main fields:

- `clientRowId`
- `serverRowId`
- `branchId`
- `ledgerDate`
- `lineLabel`
- `sessionId`
- `rowNo`
- `receiptNo`
- `payload`
- `status`
- `createdAt`
- `updatedAt`
- `lastError`

Supported statuses:

- `draft`
- `pending_sync`
- `synced`
- `failed`
- `conflict`

### `daily_ledger_sync_audit`

Key: `id`

Main fields:

- `id`
- `eventType`
- `clientRowId`
- `serverRowId`
- `message`
- `createdAt`

## Cloud Status Behavior

The daily ledger now checks cloud/API availability using:

- `navigator.onLine`
- a lightweight `GET /api/health` check derived from the configured API base URL
- browser `online`, `offline`, and `focus` events
- a restrained polling interval of 30 seconds

Supported states:

- `checking`
- `online`
- `offline`

The page displays the requested Arabic messages:

- Online: `متصل بالسحابة — الحفظ يعمل مباشرة.`
- Checking: `جاري فحص الاتصال بالسحابة...`
- Offline: `غير متصل بالسحابة — يمكنك متابعة إدخال الشحنات، وسيتم حفظها على هذا الجهاز ومزامنتها لاحقاً عند عودة الاتصال.`
- Pending drafts: `يوجد {count} صف بانتظار المزامنة.`

Offline/pending wording uses `مزامنة` and does not imply shipment posting.

## Draft Persistence Behavior

Editable non-empty ledger rows are persisted locally for the active ledger context.

The implementation avoids persisting empty trailing placeholder rows.

Rows already loaded on a manifest or already posted to a shipment are not saved as editable local drafts.

When cloud save succeeds, the matching local draft is marked `synced` and linked to the returned server row id.

When cloud save fails or the app is offline, the matching local draft remains `pending_sync` with the last error where available.

On page/context load, local drafts are restored after server rows are loaded. Restore matching avoids duplicates by checking:

1. `serverRowId`
2. normalized receipt number in the same context
3. `clientRowId`

When rows are restored, the user sees:

`تم استعادة {count} صف محفوظ محلياً على هذا الجهاز.`

## Offline Guards

While offline, the page still allows local row editing and local draft persistence.

The following server-writing operations are blocked or disabled while offline:

- saving/posting shipments to the cloud
- transfer mode confirmation
- session cancel
- deleting rows that already exist on the server
- print audit recording request

Local-only unsynced row editing remains available.

## Intentionally Not Implemented

This phase intentionally does not implement:

- real sync/replay to backend
- automatic shipment posting after reconnect
- offline transfer confirmation
- offline session cancel
- offline delete replay for server rows
- offline print audit replay
- backend idempotency changes
- backend batch sync endpoint
- schema or migration changes
- conflict resolution UI
- financial/accounting offline behavior

## Limitations

- Drafts are local to the current browser/device.
- The implementation stores draft state only; it does not synchronize pending drafts back to the server.
- Conflicts such as duplicate receipts, permission changes, deleted rows, loaded rows, or changed sessions are not resolved in this phase.
- Posting shipments remains an online-only user action.
- The current local context uses available branch/date/line/session information. A future sync phase should add stronger client session identity and server-side idempotency mapping.

## Validation

### Backend Typecheck

Command:

```bash
npm run server:check
```

Result: passed.

### Frontend Build

Command:

```bash
npm run build
```

Result: passed.

Notes:

- Vite build completed successfully.
- Existing chunk-size warnings appeared.
- Generated `dist` changes from the build were reverted so build artifacts are not part of this phase.

### Daily Ledger Helper Tests

Command:

```bash
npm run test:daily-ledger-helpers
```

Result: passed.

Command:

```bash
npm run test:daily-ledger-row-filter
```

Result: passed.

Command:

```bash
npm run test:daily-ledger-access
```

Result: passed.

## Next Phase

Recommended next phase:

1. Add a backend-supported idempotent daily-ledger draft sync endpoint.
2. Persist a server-recognized `clientRowId` or idempotency mapping.
3. Add row-level conflict results for receipt conflicts and stale server rows.
4. Add a user-controlled `sync pending drafts` action.
5. Keep shipment posting as a separate explicit online action after draft sync succeeds.
