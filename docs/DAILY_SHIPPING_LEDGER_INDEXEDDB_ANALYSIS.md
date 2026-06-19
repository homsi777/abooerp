# Daily Shipping Ledger IndexedDB Readiness Analysis

Date: 2026-06-19  
Scope: analysis/report only. No IndexedDB implementation, no code changes, no migrations.

## 1. Project Architecture Overview

### Frontend

- Framework: React 19 with Vite and TypeScript.
- Routing: `react-router-dom` in `src/App.tsx`.
- Main daily-entry route:
  - `/shipment-entry` redirects to `/shipment-quick-ledger`.
  - `/shipment-quick-ledger` renders `src/pages/ShipmentQuickLedger.tsx`.
- UI state is mostly local React state and refs inside `ShipmentQuickLedger.tsx`.
- Shared frontend helpers used by this section live under:
  - `src/lib/api/httpClient.ts`
  - `src/lib/api/phase15Gateway.ts`
  - `src/lib/shipping/*`
  - `src/components/shipping/*`
  - `src/components/SmartPartyInput.tsx`
  - `src/components/AutocompleteInput.tsx`

### Backend

- Framework: Express 5 with TypeScript.
- Backend entry/composition: `server/src/app.ts`.
- Server route base: most APIs are mounted under `/api/v1`.
- Daily ledger route mount: `app.use('/api/v1/daily-ledger', createDailyLedgerRouter(...))`.
- Backend layering:
  - routes: `server/src/routes/*`
  - services: `server/src/services/*`
  - repositories: `server/src/repositories/*`
  - database pool/migrations: `server/src/db/*`
  - auth/middleware: `server/src/auth/*`, `server/src/middleware/*`

### PostgreSQL Access Layer

- Database driver: `pg`.
- Pool: `server/src/db/pool.ts`.
- Access style: direct SQL through repositories/services, not Prisma.
- Transaction style:
  - manual `client = await pool.connect()`
  - `begin` / `commit` / `rollback`
  - used in daily ledger upsert, session cancel, row transfer, shipment posting, and financial posting.

### Authentication / Session Flow

- Frontend stores access/refresh tokens through `src/context/authStorage.ts`.
- `AuthProvider` configures `httpClient` with:
  - `Authorization: Bearer <token>`
  - `x-branch-id` for active branch
  - refresh-on-401 behavior
- Backend `requestContextMiddleware` verifies JWT access tokens, checks `auth_sessions`, loads user context through `loadUserContextByUserId`, validates active branch scope, and attaches:
  - `requestUserContext`
  - `requestScope`
  - `requestContext`
- Authorization uses `requirePermissions`.
- Daily ledger is protected mainly by:
  - `shipments.read`
  - `shipments.write`
  - action permissions such as `daily_ledger.post_shipments`, `daily_ledger.delete_rows`, `daily_ledger.transfer.create`, `daily_ledger.session.cancel`.

### Browser to Backend Communication

- `httpClient` resolves API base URL as:
  - `VITE_API_BASE_URL` if set
  - Electron: `http://localhost:4010/api/v1` or LAN runtime config/localStorage
  - Web: `/api/v1`
- All write requests (`POST`, `PUT`, `DELETE`) get an `x-idempotency-key` header generated client-side.
- Important finding: daily ledger routes do not currently use `requireIdempotencyKey`, so the header is sent but not consumed for `/daily-ledger/*`. Other routes such as `/shipments` do use the idempotency middleware.

## 2. Daily Shipping Ledger / Daily Shipment Entry Module

### Frontend Files

- `src/pages/ShipmentQuickLedger.tsx`
  - Main UI, local row model, reference loading, autosave, batch save/post, delete, transfer, print/export.
- `src/lib/shipping/dailyLedgerTypes.ts`
  - `RemoteDailyLedgerRow`, `DailyLedgerEditingScope`, `DailyLedgerQueryScope`.
- `src/lib/shipping/dailyLedgerScope.ts`
  - paged fetch helpers for `/daily-ledger/rows`.
- `src/lib/shipping/dailyLedgerQueryParams.ts`
  - query parameter construction and scope helpers.
- `src/lib/shipping/dailyLedgerTotals.ts`
  - totals from remote rows.
- `src/lib/shipping/dailyLedgerPrintable.ts`
  - filtering/sorting/deduping printable rows.
- `src/lib/shipping/dailyLedgerRowFilter.ts`
  - local/remote row filtering and output preparation.
- `src/lib/shipping/ledgerTariffPricing.ts`
  - auto tariff merge and USD/weight parsing.
- `src/lib/shipping/agentDestinationResolve.ts`
  - agent/destination matching.
- `src/lib/shipping/quickLedgerLog.ts`
  - localStorage save log plus best-effort `/daily-ledger/client-logs`.
- `src/lib/shipping/mahmoudPreprintedReceiptPrint.ts`
  - preprinted receipt mapping/HTML.
- `src/components/shipping/QuickLedgerSaveProgressDialog.tsx`
- `src/components/shipping/QuickLedgerAgentHelpDialog.tsx`
- `src/components/shipping/VehicleTripReportDialog.tsx`
- `src/components/SmartPartyInput.tsx`
- `src/components/AutocompleteInput.tsx`
- `src/lib/api/httpClient.ts`
- `src/lib/api/phase15Gateway.ts`
- `src/lib/api/syntheticEntityId.ts`

### Backend Files

- `server/src/routes/dailyLedgerRoutes.ts`
  - main daily ledger API.
- `server/src/services/dailyLedgerService.ts`
  - thin service wrapper plus sync behavior for already-posted rows.
- `server/src/services/dailyLedgerShipmentPostingService.ts`
  - converts ledger rows into confirmed shipments and triggers financial posting.
- `server/src/services/dailyLedgerTransferService.ts`
  - validates and confirms moving ledger rows between sessions/drivers/vehicles.
- `server/src/repositories/dailyLedgerRepository.ts`
  - list/upsert/mark posted/delete/cancel/print SQL.
- `server/src/services/quickLedgerLogService.ts`
  - server-side client log append.
- `server/src/utils/dailyLedgerAccess.ts`
  - role/action scoping for daily ledger.
- `server/src/utils/dailyLedgerDriverMatch.ts`
- `server/src/utils/agentDestination.ts`
- `server/src/utils/agentValidation.ts`
- `server/src/utils/shipmentFinancialBreakdown.ts`
- `server/src/services/shipmentService.ts`
- `server/src/services/shipmentFinancialPostingService.ts`
- `server/src/repositories/shipmentRepository.ts`
- `server/src/repositories/financeRepository.ts`
- `server/src/repositories/agentRepository.ts`
- `server/src/routes/shipmentRoutes.ts`
- reference routes via `server/src/modules/referenceModules.ts`.

### Migration Files Directly Related

- `074_daily_shipment_ledger.sql`
  - creates `daily_ledger_sessions` and `daily_ledger_rows`.
- `086_daily_ledger_driver_vehicle.sql`
  - adds `driver_id`, `vehicle_id`, and changes session uniqueness to include driver.
- `088_daily_ledger_receipt_no_index.sql`
  - normalized receipt number index.
- `092_daily_ledger_row_transfers.sql`
  - transfer audit tables and row transfer metadata.
- `093_daily_ledger_print_tracking.sql`
  - print events and reprint flags.
- `095_daily_ledger_backfill_driver_id.sql`
- `096_daily_ledger_sessions_branch_date_line_index.sql`
- `097_daily_ledger_future_dates.sql`
- `098_daily_ledger_view_all_entries.sql`
- `099_shipment_auditor_role.sql`
- `100_shipment_auditor_ledger_buttons_fix.sql`
- `101_shipment_auditor_view_all_entries.sql`
- `104_shipment_effective_date.sql`
- `105_daily_ledger_session_cancel.sql`
- `073_shipment_loaded_pieces.sql`
- `075_shipment_agent_commission_snapshot.sql`
- `082_shipment_transfer_service_fee_component.sql`
- `083_ledger_collect_tariff_accounting.sql`
- `084_agent_commission_shipping_price_base.sql`
- `085_agent_prepaid_shipping_trust_fix.sql`

## 3. Current Workflow

### Page Open

1. User navigates to `/shipment-quick-ledger`.
2. `RequireAuth` and `RequirePermission permission="shipments.write"` must pass.
3. `ShipmentQuickLedger` initializes one blank row and default trip state.
4. It loads reference data in parallel:
   - branches: `phase15Gateway.branches.getAll()` -> `/branches`
   - cities: `/cities`
   - goods types: `/goods-types`
   - senders/receivers: `/senders-receivers`
   - drivers: `/drivers`
   - vehicles: `/vehicles`
   - tariffs: `/tariffs` best effort
5. It loads agents:
   - agent users: `/agent-portal/profile`
   - non-agent users: `/agents?includeInactive=false`
6. Once branch/date/line are available, it loads ledger rows through `loadRemoteRows()` / `fetchAllDailyLedgerRows()` -> `GET /daily-ledger/rows`.

### Reference Data

Reference data is server-backed. There is no IndexedDB cache now.

Safe reference candidates for future offline cache:

- branches
- cities
- goods types
- active drivers
- active vehicles
- active agents
- tariff rules
- local user permissions/branch context as a read-only snapshot

Not safe to treat as authoritative offline:

- shipment numbers already posted in `shipments`
- current ledger rows from other users/devices
- accounting movement state
- cashbox/voucher balances
- delivery/manifest loaded state

### New Row Creation

- The page maintains a local `LedgerRow[]`.
- A trailing empty row is appended when a row becomes savable.
- `ROW_SAVE_DEBOUNCE_MS = 280`.
- Changing most fields queues autosave.
- Receipt number is special: save is delayed until blur/Enter because duplicate detection is tied to committing receipt input.

### Autosave / Row Upsert

- `saveRowToServer(displayRowId)` posts to `POST /daily-ledger/rows/upsert`.
- It sends:
  - branch/date/line/origin/trip
  - row id if already saved
  - row number
  - driver/vehicle labels and ids
  - receipt/destination/parcel/sender/receiver/money/notes
- Backend behavior:
  - starts a transaction
  - normalizes collect/prepaid so both are not active at the same time
  - resolves existing row by `rowId` or receipt in the same ledger scope
  - checks receipt duplication in scope
  - finds/creates driver session
  - inserts/updates `daily_ledger_rows`
  - marks session reprint-required if already printed
  - commits
- If row is already posted to a shipment and not loaded, `DailyLedgerService.upsertRow()` tries to sync the posted shipment from the ledger row.

### Batch Save / Posting Shipments

The save button runs `saveRows()`:

1. Requires active branch and active session.
2. Flushes pending row autosaves.
3. Builds rows for active session only.
4. Filters complete, unposted rows.
5. Validates:
   - duplicate receipt in batch
   - duplicate against already posted rows
   - duplicate against unposted rows
   - driver exists
6. Upserts any missing ledger rows one by one.
7. Calls `POST /daily-ledger/rows/post-shipments` with `branchId`, `ledgerDate`, `lineLabel`, `sessionId`, and row ids.
8. Backend posts pending rows one by one.

Posting behavior in `DailyLedgerShipmentPostingService`:

- Loads pending rows.
- Skips rows missing required fields.
- For each postable row:
  - if already posted, sync/update existing shipment
  - ensures sender/receiver records exist
  - ensures goods type exists
  - resolves agent by destination
  - detects account customer by exact sender/receiver name
  - checks if shipment with same `shipment_no` exists
  - creates or links shipment
  - triggers financial posting through `ShipmentFinancialPostingService`
  - marks ledger row `posted_shipment_id` and `posted_at`

Important: posting is not a single all-or-nothing batch. It loops rows and collects `posted`, `skipped`, and `errors`.

### Edits

- Edits to unposted rows update the ledger row.
- Edits to posted but not loaded rows can sync into the linked shipment.
- Loaded rows are blocked from upsert/update in repository SQL (`r.loaded_at is null`).

### Deletes

- UI delete mode calls `POST /daily-ledger/rows/delete`.
- Requires `daily_ledger.delete_rows`.
- Backend soft-deletes rows (`deleted_at = now()`).
- Loaded rows are blocked.
- Scoped operators may be restricted to their own created rows.

### Session Cancel

- UI calls `POST /daily-ledger/sessions/cancel`.
- Requires `daily_ledger.session.cancel` or transfer permission.
- Backend moves rows from a driver/vehicle session into the "no driver" pool session, then soft-deletes the original session.
- Loaded rows block cancellation.

### Transfers

- Validate: `POST /daily-ledger/transfer/validate`
- Confirm: `POST /daily-ledger/transfer/confirm`
- Backend validates deleted/loaded/cancelled/delivered rows and money presence.
- Confirm runs in one transaction, creates/updates target session, moves row ids, records `daily_ledger_row_transfers` and `daily_ledger_row_transfer_items`, and marks affected printed sessions for reprint.

### Totals

- Frontend totals are computed locally from `LedgerRow[]` and remote rows using helpers such as `computeTotalsFromRemoteRows`, `remoteRowCollectionUsd`, and local `useMemo` aggregations.
- Backend also stores per-row financial fields but does not expose a dedicated daily-ledger totals endpoint for this page.

### Error Display

- Frontend uses `useToast` for immediate errors.
- Batch save uses `QuickLedgerSaveProgressDialog`.
- `quickLedgerLog` stores local logs in `localStorage` and best-effort sends log entries to `/daily-ledger/client-logs`.
- Server responses use `{ success: false, error }` and Express error middleware.

## 4. Data Model and Database Impact

### `daily_ledger_sessions`

- Primary key: `id uuid`.
- Required:
  - `company_id`
  - `branch_id`
  - `ledger_date`
  - `line_label`
  - `origin_label`
- Important FKs:
  - `company_id -> companies(id)`
  - `branch_id -> branches(id)`
  - `driver_id -> drivers(id)` after migration 086
  - `vehicle_id -> vehicles(id)` after migration 086
  - `created_by`, `updated_by`, `printed_by -> users(id)`
- Unique active session:
  - `(company_id, branch_id, ledger_date, line_label, coalesce(driver_id, zero_uuid)) where deleted_at is null`
- Important fields:
  - trip/vehicle/driver labels
  - `printed_at`, `last_printed_at`, `print_count`
  - `reprint_required`, `reprint_reason`
  - `deleted_at`
- Financial sensitivity: session itself is operational; row posting creates shipment/accounting impact.

### `daily_ledger_rows`

- Primary key: `id uuid`.
- Required:
  - `session_id`
  - `row_no`
  - `destination`, `parcel_type`, `sender_name`, `receiver_name` default to empty strings
  - money columns default to `0`
- Important FKs:
  - `session_id -> daily_ledger_sessions(id)`
  - `posted_shipment_id -> shipments(id)`
  - `loaded_manifest_id -> manifests(id)`
  - `created_by`, `updated_by -> users(id)`
  - transfer columns to transfer/session tables after migration 092
- Unique active row:
  - `(session_id, row_no) where deleted_at is null`
- Receipt protection:
  - `idx_daily_ledger_rows_receipt_no_norm` is an index on `lower(trim(receipt_no))`, not a unique constraint.
  - Uniqueness is enforced in repository logic inside ledger scope.
- Financially sensitive columns:
  - `collect_amount_usd`
  - `prepaid_amount_usd`
  - `hawala_amount_usd`
  - `fees_amount_usd`
  - `transfer_service_fee_usd`
  - `posted_shipment_id`
  - `posted_at`
  - `loaded_at`
- Important timestamps:
  - `created_at`
  - `updated_at`
  - `deleted_at`

### `shipments`

- Primary key: `id uuid`.
- Important unique constraint:
  - `shipment_no text not null unique`.
- Required core fields:
  - `sender_id`
  - `receiver_id`
  - `branch_id`
  - `destination_city`
  - `pieces_count`
  - `status`
  - `original_amount`
  - `original_currency`
  - `exchange_rate_to_usd`
- Daily ledger impact:
  - posting a ledger row creates/updates a confirmed shipment with `shipment_no = receipt_no`.
  - `effective_date` is set from `daily_ledger_sessions.ledger_date`.
  - ledger rows link back through `daily_ledger_rows.posted_shipment_id`.
- Financially sensitive columns include:
  - `freight_charge`
  - `transfer_fee`
  - `prepaid_amount`
  - `hawala_amount`
  - `transfer_service_fee`
  - `discount_amount`
  - `financial_status`
  - `payment_status`
  - `paid_amount`
  - `remaining_amount`
  - `financial_responsibility_type`
  - `financial_responsibility_id`
  - agent commission snapshot columns.

### `party_financial_movements`

- Primary key: `id uuid`.
- Important uniqueness:
  - legacy unique `(voucher_type, voucher_id, party_type, party_id)`.
  - unique shipment component index on `(shipment_id, movement_type, party_type, party_id)` for non-reversal shipment components.
- Daily ledger impact:
  - created by shipment financial posting, not by row upsert.
  - may include `shipment_shipping_fee`, `sender_collection_trust`, `loading_dues`, `general_collection`, `shipment_hawala_trust`, `shipment_transfer_service_fee`.
- Sensitive:
  - `direction`
  - `original_amount`
  - `base_amount_usd`
  - `is_reversal`
  - `posted_at`

### Voucher / Cashbox Tables

Relevant but not directly created by basic daily ledger UNPAID posting unless a payment/cashbox path is used:

- `receipt_vouchers`
- `payment_vouchers`
- `cashbox_transactions`
- `cashboxes`

Daily ledger shipment posting uses financial responsibility and generally posts party movements for unpaid shipments. Cashbox/voucher operations are higher risk for offline retry and should remain online-only unless specifically redesigned.

### `daily_ledger_row_transfers`

- Primary key: `id uuid`.
- Tracks moving rows between sessions/drivers/vehicles.
- Important fields:
  - `transfer_no`
  - `source_session_id`
  - `target_session_id`
  - old/new driver/vehicle/date
  - `reason`
  - counts/weight
  - `status`
  - `transferred_by`
  - `transferred_at`

### `daily_ledger_row_transfer_items`

- Primary key: `id uuid`.
- Links a transfer operation to each moved row.
- Important fields:
  - `transfer_id`
  - `row_id`
  - `shipment_id`
  - `receipt_no`
  - source/target sessions
  - `financial_posted`

### `daily_ledger_print_events`

- Primary key: `id uuid`.
- Records session print operations and clears `reprint_required` on sessions through repository logic.

### Temporary / Draft / Session Tables

- No dedicated server-side draft table for offline/local-only rows was found.
- Current draft state is browser React state.
- Local save logs use `localStorage`.
- Failed save rows use `sessionStorage`.
- No IndexedDB store exists now.

## 5. API Analysis

### `GET /api/v1/daily-ledger/rows`

- Permission: `shipments.read`.
- Query:
  - `branchId?`
  - `ledgerDate?`
  - `dateFrom?`
  - `dateTo?`
  - `lineLabel?`
  - `driverId?`
  - `vehicleId?`
  - `includeLoaded?`
  - `onlyWithData?`
  - `allBranches?`
  - `q?`
  - `limit?`
  - `offset?`
- Response: `RemoteDailyLedgerRow[]`.
- Idempotent: yes.
- Retry safety: safe.

### `POST /api/v1/daily-ledger/rows/upsert`

- Permission: `shipments.write`.
- Body shape:
  - `branchId`, `ledgerDate`, `lineLabel`, `rowNo`
  - optional `rowId`
  - trip/fleet labels and ids
  - receipt/destination/parcel/sender/receiver/money/notes
- Response: one `RemoteDailyLedgerRow`.
- Idempotent: partially by application logic if `rowId` is present or receipt resolves to an existing row in the same scope.
- Retry safety:
  - safer after a successful response is known because `rowId` is then stored client-side.
  - risky if the first request succeeded but response was lost and the retry uses a different `rowNo` or changed receipt/scope.
- Important: the generic `x-idempotency-key` header is not enforced on this route.
- Dangerous for offline retry: medium risk; needs stable client row ids or server idempotency key support.

### `POST /api/v1/daily-ledger/rows/post-shipments`

- Permission: `shipments.write` plus `daily_ledger.post_shipments` logic.
- Body:
  - `branchId`
  - `ledgerDate`
  - `lineLabel`
  - `sessionId?`
  - `rowIds?`
- Response:
  - `{ posted, skipped, errors }`
- Idempotent: partially.
  - Already posted rows can sync/update existing shipments.
  - Existing `shipments.shipment_no` can be reused/linked if not linked to another ledger row.
  - Financial posting rejects already posted financial states.
- Retry safety:
  - not safe as blind offline replay without row-level result reconciliation.
  - can produce partial success.
- Dangerous for offline retry: high.

### `POST /api/v1/daily-ledger/rows/:id/post`

- Permission: `shipments.write`.
- Body:
  - `shipmentId`
  - `expectedUpdatedAt?`
- Response: `{ ok }`.
- Current frontend use in `ShipmentQuickLedger.tsx`: no direct use found in inspected page.
- Idempotency: update can be repeated with same values but may fail if timestamp guard changes.

### `POST /api/v1/daily-ledger/rows/delete`

- Permission: `shipments.write` plus `daily_ledger.delete_rows`.
- Body:
  - `rowIds: uuid[]`
- Response:
  - `{ deletedIds, blockedIds }`
- Idempotent: soft-delete is mostly idempotent but a second call returns rows as blocked/not found.
- Offline retry risk: high if row was posted/loaded/changed after queueing.

### `POST /api/v1/daily-ledger/sessions/cancel`

- Permission: `shipments.write` plus cancel/transfer permission.
- Body:
  - `sessionId`
- Response:
  - `{ movedRowsCount, poolSessionId }`
- Idempotent: no. It moves rows and soft-deletes the source session in a transaction.
- Offline retry risk: very high.

### `POST /api/v1/daily-ledger/transfer/validate`

- Permission: `shipments.write` plus transfer permission.
- Body:
  - `rowIds`
- Response:
  - `{ valid, summary, warnings, errors }`
- Idempotent: yes, read-only validation.
- Retry safety: safe.

### `POST /api/v1/daily-ledger/transfer/confirm`

- Permission: `shipments.write` plus transfer permission.
- Body:
  - `rowIds`
  - `target.ledgerDate`
  - `target.driverId?`
  - `target.vehicleId?`
  - `target.lineLabel?`
  - `target.notes?`
  - `reason`
- Response:
  - `{ transferId, transferNo, targetSessionId, sourceSessionIds, movedRowsCount, targetSummary, sourceSummaries }`
- Idempotent: no. Generates `transferNo`, moves rows, writes audit items.
- Offline retry risk: very high.

### `POST /api/v1/daily-ledger/print/record`

- Permission: `shipments.read`.
- Body:
  - `sessions[]`
  - `printType?`
  - `printScope?`
- Response:
  - `{ recorded }`
- Idempotent: no; increments `print_count` and inserts print events.
- Offline retry risk: medium/high. Replaying changes print audit.

### `POST /api/v1/daily-ledger/client-logs`

- Permission: `shipments.write`.
- Body:
  - up to 200 log entries.
- Response: append result from log service.
- Idempotent: unknown / needs confirmation. It accepts log entry ids but report did not verify database uniqueness for those ids.
- Offline retry risk: low business risk, possible duplicate logs.

### Supporting APIs Used By Page

- `GET /branches`
- `GET /cities`
- `GET /goods-types`
- `GET /senders-receivers`
- `GET /drivers`
- `GET /vehicles`
- `GET /tariffs`
- `GET /agents?includeInactive=false`
- `GET /agent-portal/profile`
- `GET /agents/lookup-by-destination`
- shipment update path through `phase15Gateway.shipments.update()` for background sync of posted rows.

## 6. Current Save Behavior and Risks

### If Internet Disconnects While Entering Rows

- Unsaved rows live only in React state.
- Some failure metadata/logs live in `sessionStorage`/`localStorage`, but row drafts themselves are not persisted as a durable local draft store.
- Browser refresh/crash can lose unsaved rows.
- Autosave failures show toast and log locally.

### If Internet Disconnects While Saving

- Autosave:
  - `httpClient` retries fetch once after 800ms.
  - if still failing, the row is not saved and the user sees an error.
- Batch save:
  - flushes row saves, then posts rows.
  - partial upsert/posting can happen because rows are processed one by one.

### Can Partial Save Happen?

Yes.

- Frontend upserts rows sequentially.
- Backend `postPendingShipments` posts each row and collects errors instead of wrapping the entire batch in a single transaction.
- A disconnect after some successful rows leaves mixed local/server state until reload.

### Can Duplicate Shipments Happen?

Protected partially.

- `shipments.shipment_no` is unique.
- Posting checks for existing shipment with same receipt/shipment number and links it if safe.
- However, offline replay without stable row identity can still create conflicts and user-facing 409s.

### Can Accounting Be Posted Twice?

Mostly protected for shipment component movements.

- `ShipmentFinancialPostingService` locks shipment and rejects already posted financial states.
- `party_financial_movements` has a unique component index for non-reversal shipment components.
- However, `POST /daily-ledger/rows/post-shipments` itself lacks route-level idempotency and is not a single atomic batch. Offline retry must reconcile per-row status.

### Can Shipment Numbers Duplicate?

Database protects `shipments.shipment_no` globally.

Daily ledger receipt numbers:

- have a normalized index but not a unique DB constraint.
- uniqueness is enforced in application logic within ledger scope.
- Offline clients can independently enter the same receipt number and only discover conflict during sync.

### Can Totals Become Inconsistent?

Temporary UI totals can differ from server truth during disconnect or partial posting. Persistent financial totals are derived from server rows/shipments/movements once sync completes.

### Are Transactions Used?

Yes, but at operation level:

- row upsert transaction
- session cancel transaction
- transfer confirm transaction
- shipment financial posting transaction
- sender/receiver/goods ensure transaction

No single transaction covers the entire frontend batch save.

### Client-Generated IDs?

- Current persisted IDs are server UUIDs.
- Frontend synthetic numeric ids are UI mappings and not stable persisted offline identifiers.
- `httpClient` creates request idempotency keys but daily ledger routes do not enforce them.

## 7. Offline Readiness Evaluation

Current readiness: not ready for safe IndexedDB offline support beyond local draft capture.

### Safe To Cache Locally

- reference data:
  - branches
  - cities
  - goods types
  - active agents
  - active drivers
  - active vehicles
  - tariffs
- current user auth/permission/branch snapshot for display and validation only.
- loaded remote ledger rows as read-only context with `fetchedAt` and server `updated_at`.

### Not Safe To Cache As Authoritative

- posted shipment state
- financial posting state
- cashbox balances
- voucher numbers
- transfer/cancel state
- loaded/manifest state
- receipt uniqueness across users/devices.

### Operations That Can Be Queued Later

Potentially queueable after backend support:

- draft row creation/update before posting
- row upsert with stable client row id and idempotency key
- client logs

Not queueable safely without more backend design:

- posting shipments
- session cancel
- transfer confirm
- delete of already synced rows
- print audit record
- shipment background sync/update
- any cashbox/voucher movement.

### Fields Needing Stable Client-Side UUIDs

Future local row store should add:

- `client_row_id`
- `client_session_id`
- `client_batch_id`
- `idempotency_key`
- `base_server_row_id` when editing a synced row
- `base_updated_at` for conflict detection

### Backend Endpoint Needs

- Daily ledger upsert should accept and persist/recognize client row UUID or idempotency key.
- Batch sync endpoint should accept multiple local operations and return per-row results.
- Posting should remain a separate online-confirmed step unless backend can provide an idempotent batch post protocol.

### Likely Conflicts After Reconnect

- same receipt number entered by another user
- row already posted/loaded/deleted
- session moved/cancelled while offline
- branch/date/driver session changed
- tariff changed while offline
- agent destination mapping changed
- user permission/branch scope changed

## 8. Recommended IndexedDB Future Plan

### Suggested Stores

- `ledger_drafts`
  - local rows keyed by `client_row_id`.
- `ledger_sessions`
  - local session metadata keyed by `client_session_id`.
- `sync_queue`
  - ordered offline operations.
- `reference_cache`
  - branches/cities/goods/agents/drivers/vehicles/tariffs.
- `server_row_cache`
  - last known server ledger rows with `updated_at`.
- `sync_conflicts`
  - unresolved conflicts.
- `sync_audit`
  - local audit trail for offline save/retry attempts.

### Suggested Local Statuses

- `draft`
- `pending_sync`
- `syncing`
- `synced`
- `failed`
- `conflict`

### Offline Queue Structure

Each operation should store:

- `operation_id`
- `operation_type`
- `client_row_id`
- `server_row_id?`
- `idempotency_key`
- `payload`
- `base_updated_at?`
- `created_at`
- `attempt_count`
- `last_error`
- `status`

### Sync Order

1. Refresh auth/session/branch permissions.
2. Refresh reference data.
3. Fetch current server rows for affected branch/date/line/session.
4. Detect obvious conflicts before writing.
5. Sync row upserts in deterministic row order.
6. Refresh server rows.
7. Let user explicitly run shipment posting online after draft sync succeeds.

### Batch Sync Endpoint Design

Recommended future endpoint:

- `POST /api/v1/daily-ledger/offline-sync`
- Body:
  - `clientBatchId`
  - `branchId`
  - `ledgerDate`
  - `lineLabel`
  - `clientSessionId`
  - `operations[]`
    - `clientRowId`
    - `serverRowId?`
    - `baseUpdatedAt?`
    - `idempotencyKey`
    - row payload
- Response:
  - `accepted[]`
  - `updated[]`
  - `conflicts[]`
  - `rejected[]`
  - current server row snapshot.

### Deduplication Strategy

- Server should store a mapping:
  - `(company_id, user_id, client_row_id)` -> `daily_ledger_rows.id`
  - or `(company_id, user_id, idempotency_key, route_key)` with reusable response/result.
- Receipt number conflicts should return structured conflict data, not only a message.

### Idempotency Strategy

- Apply `requireIdempotencyKey` or a stronger response-replay idempotency layer to daily ledger write endpoints.
- For row upsert, idempotency should be tied to operation id plus payload hash.
- For posting, use a separate `post_batch_id` and return stable per-row outcomes.

### UI Indicators

Without redesigning the current UI, future changes should add small state indicators only:

- offline indicator
- pending row marker
- syncing row marker
- failed/conflict row marker
- disabled post/transfer/cancel while offline
- "sync pending drafts" action

### Rollback / Retry

- Never auto-post shipments from offline queue without explicit online confirmation.
- Upserts can retry automatically with exponential backoff.
- Conflicts should stop the affected row only, not block unrelated rows.
- Deleting synced rows offline should be avoided; allow delete for local-only drafts.

### Audit Logging

- Keep local `sync_audit`.
- Upload logs after reconnect.
- Include:
  - user id
  - branch/date/line
  - client row id
  - server row id
  - idempotency key
  - old/new status
  - conflict reason.

## 9. Performance Notes

### Current 300 Rows/Day Fit

300 rows/day is realistic but the current page has risk areas:

- A large `ShipmentQuickLedger.tsx` manages many concerns in one component.
- Rendering is table-based with many inputs and derived `useMemo` calculations.
- Autosave per row can create many API calls during rapid entry.
- Batch save still performs row-by-row upserts before posting.
- `fetchAllDailyLedgerRows` pages by 500 up to 50,000 rows; good for avoiding one huge request, but repeated reloads can become expensive if filters are broad.

### Rendering Risks

- No table virtualization was found.
- 300 visible editable rows with many inputs can become heavy on lower-end machines.
- Search/sort/totals recompute over arrays; acceptable at 300 but should be watched if all-branches/date-range printing grows.

### API Count Risks

- Autosave can create one `POST /rows/upsert` per row edit.
- Batch save may upsert rows again and then post all pending rows.
- Agent lookup by destination and background shipment sync can add calls.

### Future Optimizations

- Keep the current design, but internally split hooks/services later.
- Add debounced bulk row sync endpoint for offline/online saves.
- Add row virtualization only if measured lag appears.
- Cache reference data with version timestamps.
- Add server-side totals endpoint if reports/totals become expensive.

## 10. Final Deliverable Notes

### Created File

- `docs/DAILY_SHIPPING_LEDGER_INDEXEDDB_ANALYSIS.md`

### Files Inspected

- `package.json`
- `src/App.tsx`
- `src/context/AuthProvider.tsx`
- `src/lib/api/httpClient.ts`
- `src/lib/api/phase15Gateway.ts`
- `src/pages/ShipmentQuickLedger.tsx`
- `src/lib/shipping/dailyLedgerTypes.ts`
- `src/lib/shipping/dailyLedgerScope.ts`
- `src/lib/shipping/quickLedgerLog.ts`
- `server/src/app.ts`
- `server/src/db/pool.ts`
- `server/src/routes/dailyLedgerRoutes.ts`
- `server/src/routes/shipmentRoutes.ts`
- `server/src/routes/authRoutes.ts`
- `server/src/services/dailyLedgerService.ts`
- `server/src/services/dailyLedgerShipmentPostingService.ts`
- `server/src/services/dailyLedgerTransferService.ts`
- `server/src/services/shipmentFinancialPostingService.ts`
- `server/src/repositories/dailyLedgerRepository.ts`
- `server/src/middleware/requestContext.ts`
- `server/src/middleware/authorization.ts`
- `server/src/middleware/idempotency.ts`
- `server/src/auth/userContext.ts`
- `server/src/db/migrations/001_initial_foundation.sql`
- `server/src/db/migrations/003_finance_binding_foundation.sql`
- `server/src/db/migrations/031_idempotency_keys_table.sql`
- `server/src/db/migrations/062_shipment_financial_breakdown_movements.sql`
- `server/src/db/migrations/074_daily_shipment_ledger.sql`
- `server/src/db/migrations/075_shipment_agent_commission_snapshot.sql`
- `server/src/db/migrations/082_shipment_transfer_service_fee_component.sql`
- `server/src/db/migrations/083_ledger_collect_tariff_accounting.sql`
- `server/src/db/migrations/084_agent_commission_shipping_price_base.sql`
- `server/src/db/migrations/085_agent_prepaid_shipping_trust_fix.sql`
- `server/src/db/migrations/086_daily_ledger_driver_vehicle.sql`
- `server/src/db/migrations/088_daily_ledger_receipt_no_index.sql`
- `server/src/db/migrations/092_daily_ledger_row_transfers.sql`
- `server/src/db/migrations/093_daily_ledger_print_tracking.sql`
- `server/src/db/migrations/104_shipment_effective_date.sql`
- `server/src/db/migrations/105_daily_ledger_session_cancel.sql`

### Validation Performed

- Read-only inspection commands only.
- `git status --short` was checked before writing the report and showed no existing working-tree changes.
- No typecheck/test/migration command was run because the task is documentation-only and asked to avoid modifying code/database/configuration.

### Change Boundary Confirmation

Only this Markdown report was added. No application code, database migration, configuration, UI, dependency, or deployment file was modified.
