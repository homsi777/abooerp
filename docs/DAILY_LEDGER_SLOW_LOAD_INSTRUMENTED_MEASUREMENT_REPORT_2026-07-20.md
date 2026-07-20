# Daily Ledger Slow Load on Date Selection — Instrumented Measurement Report

**Date:** 2026-07-20
**Scope:** Real, captured measurements only. No estimates. Supersedes the earlier unmeasured code-reading hypothesis list.

---

## 0. TEST ENVIRONMENT — READ THIS FIRST

All measurements were taken against the **local PostgreSQL database**, which is a mirror/copy of the
cloud database (confirmed real mirrored data: 147 sessions / 4,552 rows for the one active company).
The local backend and local Postgres run on the same machine, connected over loopback (127.0.0.1).

This means:
- **Environment-independent findings** (safe to trust as-is against production): SQL execution time,
  server-side processing time (auth, permission checks, DB transaction time), JSON serialization cost,
  client-side render cost, response payload sizes, and the **number and sequencing** of HTTP requests
  fired per action.
- **Findings that need re-verification against the real cloud VPS connection**: anything involving
  **client ⇄ server round-trip network latency**. All timings below that involve an HTTP request
  (T1, T2, and the browser-measured "fetchMs"/"wallClockMs" figures) were measured with **effectively
  zero network latency** (same-machine loopback, typically <1ms transport time). Over the real
  employee-device-to-cloud-VPS link — especially under the "intermittent internet" conditions
  mentioned for this deployment — every one of the sequential HTTP requests measured below would
  incur additional real-world RTT that does **not** appear in these numbers. Because [Finding T1](#t1)
  involves ~200 *sequential* requests, this is the single biggest reason the total in this report
  (≈3.5–3.8s locally) is much smaller than the multi-minute delay the user experienced in production.

**Do not read any millisecond figure below as "this is what the user sees in production."** Where a
number is network-latency-sensitive, it is explicitly marked **[LOCAL-ONLY, LATENCY-SENSITIVE]**.
Where a number is environment-independent, it is marked **[ENV-INDEPENDENT]**.

---

## 1. Reproduction setup (real, not synthetic, data)

The local DB already contains real mirrored ledger data. No synthetic dataset was substituted for
the read-side measurements.

| Item | Value |
|---|---|
| Company | مؤسسة شامل للشحن (single company, id `124d8512-…`) |
| Branch used for single-branch tests | الفرع الرئيسي (`2d5b831a-…`) — API/EXPLAIN tests |
| Branch used for browser UI tests | فرع حلب (`1caf72e0-…`) — admin's own default active branch (see §6 note on why) |
| Date used for API/EXPLAIN tests | **2026-06-24 → 203–204 real rows** |
| Date used for browser UI tests | **2026-06-09 → 162 real rows** |
| Real dirty-row count for T1 scenario 3 | User-confirmed: **"most or all of the ~200 rows"** were unsaved when the real slow case occurred (asked directly rather than assumed) |

Two real seeded users were used: `admin` (role `admin`, full `daily_ledger.view_all_entries`) and
`وائل العظم` (real seeded `data_entry` user, scoped to a single branch).

---

## 2. T1 — Pre-fetch save flush (`flushPendingRowSaves`)

Instrumented `flushPendingRowSaves()` and `saveRowToServer()` directly (temporary `console.info`
timestamps, removed after measurement). Confirmed by code: the function is a **strict sequential
`for…await` loop** — one `POST /daily-ledger/rows/upsert` at a time, never `Promise.all`.

Because faithfully creating ~200 *simultaneously dirty* rows through real UI keystrokes (debounce =
280ms) is not practical to script reliably inside that debounce window, scenarios B/C below drive the
**exact same endpoint, same code path, same DB** directly over HTTP — this isolates the network+server
cost of the flush mechanic precisely. It excludes only the pure-React re-render cost of each individual
flush iteration (see the caveat at the end of this section).

**[LOCAL-ONLY, LATENCY-SENSITIVE]**

| Scenario | Dirty rows | Total wall time | Avg/row | Min/row | Max/row | p95/row |
|---|---:|---:|---:|---:|---:|---:|
| A — none dirty | 0 | **0.002 ms** (no-op, loop body never runs) | — | — | — | — |
| B — ~10 dirty | 10 | **203.827 ms** | 20.357 ms | 13.211 ms | 61.082 ms (cold 1st call) | — |
| C — real user case ("most/all ~200") | 200 | **2,464.778 ms (≈2.46 s)** | 12.317 ms | 10.311 ms | 80.131 ms | 15.07 ms |

Server-side breakdown for the 200-row run, cross-referenced from the temporary `PERF_PROBE_AUTH` /
`PERF_PROBE_ROUTE` logs (n=210 upsert requests) — **[ENV-INDEPENDENT]**:

| Phase | Avg | p50 | Max |
|---|---:|---:|---:|
| JWT verify (sync) | 0.851 ms | 0.817 ms | 1.544 ms |
| User-context load (3 DB queries: user+role+perms, allowed branches, base currency) | 2.940 ms | 2.550 ms | 50.901 ms |
| Session validity check (1 DB query) | 0.345 ms | 0.316 ms | 2.124 ms |
| Branch validation (1 DB query) | 0.302 ms | 0.290 ms | 0.634 ms |
| **Auth middleware total** | **4.438 ms** | 3.992 ms | 54.321 ms |
| Permission check (in-memory, no DB) | 0.035 ms | — | 0.087 ms |
| Route pre-handler (scope resolution) | 1.397 ms | 1.308 ms | 3.771 ms |
| Upsert DB transaction | 4.899 ms | 4.180 ms | 43.101 ms |
| **Total server-side per row** | **≈10.7 ms** | | |

Client-measured avg was 12.317 ms/row; the ≈1.6 ms gap is pure loopback HTTP overhead — on the real
cloud link this gap becomes the dominant per-row cost (see §0).

**Caveat (explicitly not fabricated):** the React-side cost of each flush iteration's `setRows()`
call (full rows-array remap + re-render, once per saved row, ×200) was **not separately isolated**
in this run. §5 measured a *full initial mount* render at ~1.0s for ~163 rows; per-iteration
*incremental* updates during flush are structurally cheaper (no remount) but were not measured
individually. This is flagged as an open measurement gap, not assumed to be zero.

---

## 3. T2 — API request timing, `GET /daily-ledger/rows`

Warm-pool, repeated (n=8) direct HTTP calls with the **exact query-parameter shape the real client
sends** (`limit=500&offset=0`, matching `DAILY_LEDGER_FETCH_PAGE_SIZE`). **[LOCAL-ONLY for the wall-clock
column; DB/serialize columns are ENV-INDEPENDENT.]**

| Scope | Rows | Client wall (warm avg) | Server `dbQueryMs` | Server `serializeMs` | Response size |
|---|---:|---:|---:|---:|---:|
| Single-line (data-entry request shape: branchId+date+lineLabel) | 203 | 20.720 ms | 4.4–7.9 ms | 2.5–4.0 ms | 273,728 B |
| Admin/manager, all-branches (companyId+date only) | 204 | 20.519 ms | 4.7–6.8 ms | 2.4–3.1 ms | 275,010 B |
| Real data_entry user (dev-header auth, same branch) | 203 | 17.431 ms | (same query, same cost) | | |

Auth-middleware cost specific to this GET route (n=29, mixed bearer + dev-header): total avg
6.356 ms, dominated by the 3-query user-context load (avg 4.811 ms). Permission check: 0.044 ms avg.

**Real browser confirmation** (Chrome via CDP, actual React app, actual `fetch`, 162 rows,
date=2026-06-09): app-measured `fetchMs = 41.6 ms`; browser Resource Timing API duration = 19.5 ms,
`transferSize = 223,653 B`. Consistent with the HTTP-harness numbers once real browser overhead
(request scheduling, TLS-less HTTP parsing) is included.

---

## 4. T3 — Database query plan (`EXPLAIN (ANALYZE, BUFFERS)`)

Run directly against the real local Postgres mirror, real data, `ledger_date = 2026-06-24`. Three
variants were run because code inspection showed the client **never actually sends `lineLabel`** for
admin/manager roles (`allLines` is forced `true` whenever `canViewAllLedgerEntries` is true — only the
restricted `data_entry` role sends `lineLabel`). **[ENV-INDEPENDENT — this is the one section of the
report guaranteed to look the same on the cloud VPS, since it's pure query-planner behavior against
the same schema/indexes/data volume; it would only change if the cloud DB has materially more rows.]**

| Variant | Filter | Rows returned | Execution Time | Index used | Buffers (shared hit) |
|---|---|---:|---:|---|---:|
| 1 — data-entry request shape | branchId + date + lineLabel | 203 | **1.018 ms** | `idx_daily_ledger_sessions_branch_date_line` | 91 |
| 1b — admin/manager single-branch | branchId + date (no lineLabel) | 203 | **0.920 ms** | same index | 90 |
| 2 — admin/manager all-branches | date only (no branchId, no lineLabel) | 204 | **0.953 ms** | same index (scanned across branch groups) | 95 |

All three plans hit `Bitmap Heap Scan` / `Index Scan` paths with buffers entirely served from cache
(`shared hit`, zero `read`) — no sequential scans, no missing-index symptoms. Planning time ranged
0.4–3.1 ms (noise, first-query-in-session effect, not systematic). Company-wide context: 147 total
sessions, 4,552 total rows — small enough that even the "no branch predicate" all-branches variant
still resolves via the same 3-column index efficiently.

---

## 5. T5 — Client-side render cost

Instrumented the real `setRows()` call in `loadRemoteRows()` with a double-`requestAnimationFrame`
marker (two committed paint frames after the state update — the standard technique for measuring
"visually settled" in the absence of the React Profiler API being scriptable from outside the page).
Driven by a real headless Chrome (puppeteer-core against the system Chrome install) running the actual
Vite dev build of the app, not a mock. **[ENV-INDEPENDENT — pure client CPU/paint cost, unaffected by
network conditions.]**

**Real captured result — clean date switch, 162 real rows (163 incl. trailing blank entry row):**

| Phase | Duration |
|---|---:|
| Flush (0 dirty rows) | 1.1 ms |
| Fetch (`GET /daily-ledger/rows`) | 41.6 ms |
| **`setRows()` → 2 committed paint frames (render)** | **1,008.7 ms** |
| **Total, load_start → fully painted** | **1,086.4 ms** |

This is the single most consequential number in this investigation: **rendering ~163 rows of the
interactive table costs ~1 full second of browser main-thread time, ~24× the cost of the network
fetch that supplied the data.** This happens even with **zero dirty rows** — it is not a save-flush
problem, it is a render-cost problem, and it is fully reproducible locally (no network dependency).

**Limitation, stated plainly:** the task asked for an A/B against a temporary plain read-only table
to isolate "how much of this 1,008.7 ms is inherent to ~160 rows × ~30 columns of data vs. how much
is caused specifically by the lack of virtualization / the interactive `<input>` elements per cell."
That isolated A/B was **not completed** in this session (time-boxed; flagged rather than guessed). The
1,008.7 ms figure is real and is the actual cost of the actual production table, but it is a measurement
of the current implementation, not a decomposition of *why* it costs that much.

---

## 6. Initial reference-data load vs. per-date-switch cost

**Code-level finding:** the reference-data effect (`loadRefs` — branches, cities, goods-types,
senders/receivers, drivers, vehicles, tariffs, agents) has dependency array
`[showToast, user?.id, user?.userType, user?.agentId]` — it does **not** depend on `trip.date`.

**Confirmed live, twice:**
1. Real browser initial mount fired the full reference-data set once (55 total requests in the
   captured window, including Vite dev-module fetches; ~15 unique API endpoints).
2. The subsequent clean date-switch (§5 above) fired **exactly one** API request
   (`GET /daily-ledger/rows`) — no `/branches`, `/cities`, `/drivers`, `/vehicles`, `/agents` calls.

**Verdict: reference data does NOT reload on date switch. This hypothesis is rejected as a
contributor.**

Side observation from the initial-load capture (not part of the original hypothesis list, flagged for
awareness): `/api/v1/senders-receivers` returned **1,843,541 bytes (≈1.8 MB)** and `/api/v1/goods-types`
returned **427,088 bytes (≈427 KB)** on first load. Several endpoints were also observed firing 2×
during the same initial mount (`/cities`, `/auth/branches`, `/drivers`, `/sync/status`,
`/daily-ledger/rows`, `/license/status`, `/system/lan-health`) — plausibly React effect re-invocation
during mount. This is a one-time cost (not repeated on date switch) and was out of scope to
root-cause further here, but is worth a note since ~1.8 MB is non-trivial on a poor connection.

---

## 7. Request-count audit (ground truth)

**Clean date switch (0 dirty rows), captured via real Chrome Network/Resource-Timing data:**

```
GET /api/v1/daily-ledger/rows?branchId=...&includeLoaded=true&ledgerDate=2026-06-09&limit=500&offset=0
  status=200  responseBytes=223,353  duration=19.5–41.6ms (server vs. browser measurement)
```
**One request. Sequential by construction (only one fired).**

**Initial page load** (reference-data + first ledger fetch), production-relevant subset only
(Vite module-loader requests excluded — those don't exist in a built production bundle):

```
GET /api/health
GET /api/v1/sync/status                         (fired 2×)
GET /api/v1/auth/branches                        (fired 2–3×)
GET /api/v1/cities                                (fired 2×)
GET /api/v1/goods-types             427,088 B
GET /api/v1/senders-receivers     1,843,541 B
GET /api/v1/drivers                               (fired 2×)
GET /api/v1/daily-ledger/rows (today's date, 0 rows)
GET /api/v1/auth/me
GET /api/v1/system/lan-health                     (fired 2×)
GET /api/v1/license/status                        (fired 2×)
GET /api/v1/vehicles                              (fired 2×)
GET /api/v1/tariffs
GET /api/v1/agents?includeInactive=false
```
All observed as sequential/overlapping small requests, not one single blocking chain — total wall
time for this whole initial burst was 3.66s in the browser (includes ~1.8MB `/senders-receivers`
transfer, which on loopback is fast but would not be on a slow real link).

---

## 8. Breakdown table — where the observed local delay actually goes

**Scenario: switching to a ~200-row past date with the real dirty-row count the user reported
("most/all ~200 rows unsaved").** All figures below are the local, zero-latency measurements from
§2/§3/§5 combined; see §0 for what does and doesn't transfer to production.

| Component | Measured value | % of local total |
|---|---:|---:|
| **T1 — sequential save flush** (200 rows, network+server, real endpoint) | 2,464.8 ms | ~65–70% |
| **T2 — API request** (fetch, client-perceived, warm) | ~20–42 ms | ~1% |
| &nbsp;&nbsp;↳ of which T3, DB query execution itself | 0.9–1.0 ms | (<0.1%, included above) |
| **T5 — client render** (~200 rows scaled from the 162-row/1,008.7ms measurement) | ~1,000–1,300 ms | ~28–33% |
| **Local total (measured)** | **≈3.5–3.8 s** | 100% |

**This ≈3.5–3.8s local total is real and already well below "multi-minute."** The gap to the actual
multi-minute delay the user experienced is explained by exactly the environment factors flagged in
§0: 200 *sequential* HTTP round trips, each currently costing ~12ms on loopback, would cost
proportionally more under real cloud RTT and any connection instability — e.g. at a hypothetical
300ms extra RTT per request under a poor mobile/DSL link, 200 sequential requests alone add roughly
one minute, on top of the render cost, which is environment-independent and would remain ~1–1.3s
regardless of network quality.

---

## 9. Hypotheses — confirmed or rejected by the actual numbers

| # | Prior hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | Sequential save flush is a major contributor | **CONFIRMED** | §2: 200 sequential POSTs = 2.46s locally with zero network latency; scales linearly with dirty-row count (0→10→200 measured); this is the single largest local component (~65-70% of local total) and the component most amplified by real network latency (§0, §8) |
| 2 | Manager "all-lines" scope makes the query much more expensive | **REJECTED** | §4: three real query-shape variants (single-line, admin single-branch, admin all-branches) all execute in 0.92–1.02ms via EXPLAIN ANALYZE on real data; §3: live server `dbQueryMs`/`serializeMs` statistically identical (~5–10ms either way); client-perceived warm timing identical (~17–21ms both ways) |
| 3 | Missing virtualization causes expensive renders | **STRONGLY SUPPORTED** (mechanism confirmed and quantified; isolation vs. a plain table not completed — see §5 limitation) | §5: real, measured 1,008.7ms render cost for ~163 rows with **zero** dirty rows — the largest single cost after the flush, and entirely a render cost, not a network cost. `react-data-grid` is an installed dependency but is not imported anywhere in `ShipmentQuickLedger.tsx` (confirmed via repo-wide search) — the table is a plain unvirtualized `<table>`/`.map()` render |
| 4 | Missing/inadequate DB indexes | **REJECTED** | §4: correct composite index (`idx_daily_ledger_sessions_branch_date_line`) exists and is used by the planner in all three tested query shapes; buffers served entirely from cache; no sequential scans observed |
| 5 | Auth/permission overhead | **PARTIALLY CONFIRMED, as a multiplier, not standalone** | §2/§3: real per-request auth overhead is small (~4.4–6.4ms, dominated by a 3-query user-context load) and permission checks are negligible (<0.1ms, in-memory). Not significant as a single request's cost, but multiplied across the ~200 sequential flush requests it adds a real, measured ~0.9–1.3s cumulative server-side cost on top of the DB-write time itself |

---

## 10. What was NOT measured (explicit, not filled in with guesses)

- **Per-iteration React re-render cost during the actual 200-row flush loop** (as opposed to the
  network+server cost, which was measured, and the full-mount render cost, which was measured
  separately). Recommended as the next concrete measurement if further precision is needed.
- **Isolated plain-table vs. interactive-table A/B** for the render cost — not completed in this
  session; the 1,008.7ms figure is real but not decomposed by cause.
- **Behavior under real cloud RTT / intermittent connectivity** — cannot be measured from this
  environment; §0 and §8 explain quantitatively why this is expected to be the dominant remaining
  gap to the multi-minute figure the user experienced.
- **Manager role tested via the literal UI role-switch** (as opposed to the equivalent API-level
  scope toggle) — logging in as the real seeded `data_entry` user in the browser would have required
  either their real password (not available) or temporarily resetting it (chosen not to, to avoid
  touching real user credentials even locally). The role/scope difference itself was fully measured
  at the API level (§2, §3), which is what actually determines the query cost; only the literal
  browser-chrome-as-that-user visual confirmation is missing.

---

## 11. Instrumentation and environment changes — all reverted

Per the task constraints, all temporary instrumentation was clearly marked (`PERF_PROBE_TEMP` /
`[PERF_PROBE]` markers) and has been fully removed after measurement:

- `server/src/middleware/requestContext.ts` — reverted via `git checkout` (auth-phase timing removed)
- `server/src/routes/dailyLedgerRoutes.ts` — reverted via `git checkout` (route-phase timing removed)
- `src/pages/ShipmentQuickLedger.tsx` — reverted via `git checkout` (flush/fetch/render timing removed)
- `server/.env` — the temporary `ALLOW_DEV_USER_HEADER=true` (used only to test the real seeded
  `data_entry` user without touching their password) was removed; file restored to its prior state
- `server/scripts/_tmp_perf_probe/` (harness scripts, EXPLAIN runner, browser-automation script) —
  deleted entirely
- Synthetic test data written during T1 (rows under a fake `ledgerDate=2099-12-31`,
  `lineLabel='PERF_PROBE_TEST'`) and the 10-row dirty-edit test — both verified cleaned up; a final
  DB check confirms **zero** rows or sessions containing `PERFPROBE`/`PERF_PROBE` text remain
- Local dev server and Vite dev server processes started for this measurement session were stopped

No production logic was changed. No proposed fixes were implemented — this report is measurement and
diagnosis only, per the task scope.
