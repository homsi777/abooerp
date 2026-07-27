# WEB BROWSER MODE — DIAGNOSTIC REPORT (Electron/Desktop Safe)

Project: AbooERP / Almiya‑HSahin Shipping ERP  
Date: 2026-05-23  
Scope: **Diagnostic report only** (no code changes, no migrations, no refactors).

This report explains what is required to add a correct **Web Browser / VPS mode** while preserving the existing **Electron Desktop / LAN mode** and its local PostgreSQL workflow.

If something cannot be proven from code inspection, it is marked as **Unclear — requires verification.**

---

## 1) Executive Summary

The project currently behaves as a **Desktop-first** app:
- The frontend is a Vite React SPA that assumes it may be running inside Electron and may have `window.runtime`.
- The frontend’s API base defaults to `http://localhost:4010/api/v1` unless overridden by `VITE_API_BASE_URL`, Electron runtime config, or localStorage LAN settings ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4), [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L75-L99)).
- The backend is an Express server that is optimized for localhost/LAN + Electron. It also applies a strict CORS allowlist that currently **does not include the VPS browser origin** and can fail browser requests while curl works ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L95-L119)).

To support a true Web Browser / VPS mode **without breaking Electron**, the system needs:
1) A safe dual-mode API base resolver design (Electron config + browser `/api/v1`),  
2) A deliberate strategy for browser-safe runtime dependencies (`window.runtime` absent),  
3) A browser-safe licensing and login UX that shows real backend errors,  
4) VPS-compatible server CORS policy and/or same-origin strategy behind Nginx,  
5) A clear choice for “device authorization” (LAN-only vs web) so browser users can login without an Electron machineId.

---

## 2) Current Deployment State (Given)

VPS:
- External URL: `http://65.21.136.217:2730/#/login`
- Provider mapping: external `2730` → internal Nginx `3000`
- Nginx serves frontend from: `/var/www/abooerp/frontend`
- Nginx proxies: `/api/ → http://127.0.0.1:4010/api/`
- Backend listens: `0.0.0.0:4010`
- PostgreSQL: `127.0.0.1:5432`, db: `almiya_hsahin`
- Migrations up to: `077_transfer_service_fee_v3.sql`

---

## 3) What Works Now

- Backend health endpoint exists: `GET /api/health` ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L148-L150))
- LAN health exists: `GET /api/v1/system/lan-health` ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L152-L168))
- Login endpoint exists: `POST /api/v1/auth/login` ([authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts#L95-L111))
- License activation exists: `POST /api/v1/license/activate` ([licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts#L82-L131))

Known working curl examples (from the task description):

```bash
curl -X POST http://65.21.136.217:2730/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

```bash
curl -X POST http://65.21.136.217:2730/api/v1/license/activate \
  -H "Content-Type: application/json" \
  -d '{"licenseCode":"A3K7-Q9X2-R4M8-B6N5"}'
```

---

## 4) What Fails Now

Browser mode symptoms described:
- The browser UI still fails (activation/login blocked) even though backend and proxy are healthy.
- The browser may show:
  - `POST /api/v1/license/activate 500 Internal Server Error`
  - UI message: `تعذّر الاتصال بالسيرفر — تأكد من تشغيل الخادم والمحاولة مجدداً`

Important UI gating behavior:
- Login is disabled until a license is activated because `loginDisabled = ... || !licenseActive` ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L210-L212)).
- Therefore **if activation fails**, the user cannot proceed to login from the UI even if `/auth/login` works.

---

## 5) Root Cause Analysis (Evidence-Based)

This section lists the most probable causes that explain “curl works but browser UI fails”.

### 5.1 CORS allowlist blocks VPS origin (very likely)

The backend applies CORS with a strict allowlist:
- Allowed static origins include localhost dev and Electron only ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L95-L103)).
- It also allows private LAN ranges like `192.168.*` etc ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L104-L116)).
- It does **not** include `http://65.21.136.217:2730`.
- When a browser calls the backend through Nginx, it will send an `Origin` header like `http://65.21.136.217:2730`, and the CORS callback throws an error:
  - `callback(new Error(\`CORS: origin '${origin}' not allowed\`))` ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L116-L117)).

Why curl can succeed while browser fails:
- Curl calls typically do not send `Origin`, so CORS middleware allows it (`if (!origin) return callback(null, true)` [app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L108-L109)).
- Browser always sends `Origin` for fetch calls, so it can be rejected.

**Result**: browser sees a failed request (often reported as 500 or as a CORS error depending on browser/network tools).

### 5.2 API base URL defaults to localhost (very likely unless explicitly set)

Renderer default API base:
- `API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010/api/v1'` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4)).

If a browser production build does not set `VITE_API_BASE_URL`, the SPA will try to call `http://localhost:4010/api/v1/...` from the user’s PC, which is wrong in VPS mode.

### 5.3 localStorage can override the API base forever (likely)

The frontend can persist a LAN override in localStorage:
- Key: `lan.apiBaseUrl` (plus `lan.serverIp`, `lan.connectionMode`) ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L6-L10)).
- `resolveApiBaseUrl()` uses localStorage `lan.apiBaseUrl` as priority #2 (even in browser) ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L88-L96)).

If a user previously ran LAN mode and stored `lan.apiBaseUrl=http://localhost:4010/api/v1` (or any internal/private IP), browser mode can remain “stuck” on the wrong base URL until localStorage is cleared.

### 5.4 License UI error handling hides real backend cause (very likely)

The activation modal assumes Axios-style errors:
- It checks `err?.response?.data?.code` ([ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx#L108-L114)).

But `httpClient` throws only `new Error(payload?.error ?? ...)` and does not attach `response.data` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L191-L193)).

This means:
- Even if backend returns a clear error like `INVALID_LICENSE_CODE` (HTTP 400), the UI will usually show the generic “cannot connect” message, masking the true issue.

### 5.5 Device authorization (LAN-only protection) can break web login (unclear for your current Nginx config)

Backend login always runs device authorization check before auth:
- `await checkDeviceAuthorization(req);` ([authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts#L95-L111)).

Device check logic:
- If request IP is not local, it requires `x-device-id` header and checks approval; otherwise it returns 403 `DEVICE_NOT_REGISTERED` etc ([authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts#L45-L71)).
- It resolves IP using `x-forwarded-for` first ([authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts#L28-L33)).

In a pure browser web mode:
- `window.runtime.getMachineId()` does not exist, so the frontend does not send `x-device-id` headers (they are injected only when runtime exists [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L59-L73)).

Therefore: **If Nginx forwards real client IP in `x-forwarded-for`, web logins could be blocked.**  
This is **Unclear — requires verification** because it depends on your Nginx `proxy_set_header X-Forwarded-For ...` config and where curl was executed from.

---

## 6) Electron Mode Requirements (Must Preserve)

Electron mode must remain working exactly as today:
- `npm run electron:dev`
- May use local backend at `http://localhost:4010/api/v1`
- Uses `window.runtime` bridge:
  - `getConfig()` → runtime config / apiBaseUrl ([runtimeConfig.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/electron/ipc/runtimeConfig.ts#L22-L36))
  - `getMachineId()` → persistent machine identity ([runtimeConfig.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/electron/ipc/runtimeConfig.ts#L320-L342))
  - `setSessionToken()` used after login ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L258-L259))
  - `setActiveBranch()` used after login ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L259-L260))
- Uses runtime headers automatically:
  - `x-electron-runtime`, `x-runtime-mode`, `x-runtime-version`, `x-device-id` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L59-L73))
- Keeps local PostgreSQL workflow and packaging behavior.

---

## 7) Web Browser Mode Requirements (New)

Web browser mode must:
- Work in Chrome/Edge without Electron.
- Not require `window.runtime`.
- Use relative API base by default: **`/api/v1`** (served behind Nginx).
- Not require `localhost:4010` on the user’s machine.
- Support:
  - `/api/v1/auth/branches`
  - `/api/v1/license/activate`
  - `/api/v1/auth/login`
  - refresh token and `/auth/me` restore
- Be robust against stale localStorage LAN settings.
- Show accurate backend errors (not generic “cannot connect”).

---

## 8) API Base URL Analysis

### 8.1 Where API base is decided (all sources)

Primary resolver: `resolveApiBaseUrl()` in [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L75-L99)

Priority order today:
1) Electron runtime config when `runtimeMode === 'lan_node'` and `cfg.apiBaseUrl` exists ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L77-L83))
2) `localStorage['lan.apiBaseUrl']` if present ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L88-L90))
3) If no runtime: `VITE_API_BASE_URL` else default `http://localhost:4010/api/v1` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L91-L98))

Additional mismatch: realtime connects using a different base derivation:
- `const apiBase = localStorage.getItem('lan.apiBaseUrl') ?? (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010/api/v1');` ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L266-L268))
- It does **not** call `resolveApiBaseUrl()`, so SSE may connect to a different host than normal API calls.

### 8.2 Direct answers (as required)

1) Default API base URL: `VITE_API_BASE_URL` or fallback `http://localhost:4010/api/v1` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4)).  
2) Is it hardcoded to localhost? Yes (as fallback).  
3) More than one file? Yes: base appears in [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4) and separately in [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L266-L268).  
4) Does localStorage override it? Yes (`lan.apiBaseUrl`).  
5) Does `lan.apiBaseUrl` override it? Yes (priority #2).  
6) Does Electron runtime config override it? Yes, for `runtimeMode === 'lan_node'`.  
7) Does `VITE_API_BASE_URL` override it? Yes, it is the default base unless overridden by runtime/localStorage.  
8) Browser mode when `window.runtime` undefined: uses localStorage `lan.apiBaseUrl` if set; else uses `VITE_API_BASE_URL` else localhost fallback.  
9) Electron mode when runtime exists: uses config `apiBaseUrl` and sends runtime headers.  
10) Safest dual-mode design: see “Recommended Architecture”.

---

## 9) License Activation Analysis

### 9.1 UI request payload (actual code)

Activation modal sends:
- Endpoint: `POST /license/activate` via `httpClient`
- Body:
  - `licenseCode: keyValue`
  - `machineId: machineId || undefined` (from `window.runtime.getMachineId()` if exists)
([ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx#L89-L97))

License expired modal uses the same pattern (also includes `machineId` if runtime exists). See [LicenseExpiredModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/layout/LicenseExpiredModal.tsx).

### 9.2 Backend request expectations

Backend schema:
- `licenseCode` is trimmed/uppercased; must be `TEST1` or `XXXX-XXXX-XXXX-XXXX`
- `machineId` optional string  
([licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts#L52-L61))

Backend activation stores the activation in `license_activations` using UPSERT (`on conflict (company_id, license_code) do update ...`) so re-activation should be safe ([licenseRepository.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/repositories/licenseRepository.ts#L43-L85)).

### 9.3 Why curl activation can succeed but UI activation fails

Evidence-based possibilities:
1) **CORS rejection** for browser origin (curl has no Origin, browser has Origin) — see Root Cause 5.1.  
2) **Wrong API base** in the browser (localhost fallback or stale `lan.apiBaseUrl`) — see Root Cause 5.2/5.3.  
3) **UI shows misleading message** even for real server errors due to `httpClient` error shape mismatch — see Root Cause 5.4.  

Not supported by evidence:
- Backend does not require machineId (`machineId` is optional) ([licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts#L60-L61)), so missing runtime machineId alone should not break activation.
- Duplicate activation should not cause 500 due to UPSERT ([licenseRepository.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/repositories/licenseRepository.ts#L59-L83)).

### 9.4 Payload comparison: UI vs working curl

Working curl payload:
```json
{ "licenseCode": "A3K7-Q9X2-R4M8-B6N5" }
```

UI payload (browser without runtime):
```json
{ "licenseCode": "A3K7-Q9X2-R4M8-B6N5" }
```

UI payload (electron):
```json
{ "licenseCode": "A3K7-Q9X2-R4M8-B6N5", "machineId": "..." }
```

Therefore: **payload difference is not the likely reason**. The problem is likely API base/CORS/runtime gating rather than payload.

---

## 10) Login Flow Analysis

### 10.1 What UI calls

Before login:
- `GET /auth/branches` to load branches ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L138-L145))
- Performs a device handshake call only if runtime machineId exists:
  - `POST /system/register-device` ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L45-L78))
  - If runtime machineId is missing, handshake returns `'ok'` and UI continues ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L52-L56))

Login:
- `POST /auth/login` with `{ username, password, branchId? }` ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L250-L256))

After login:
- Stores tokens in `sessionStorage` keys `auth.accessToken`, `auth.refreshToken` ([authStorage.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/authStorage.ts#L1-L35))
- Stores branch in `localStorage` `auth.activeBranchId` ([authStorage.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/authStorage.ts#L43-L53))
- Electron mode additionally calls:
  - `runtime.setSessionToken(accessToken)` ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L258-L259))
  - `runtime.setActiveBranch(branchId)` ([AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L259-L260))

### 10.2 Does UI depend on license activation first?

Yes: login is disabled unless `licenseActive` is true (stored in `localStorage['app.license']`) ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L99-L101), [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L210-L212)).

Therefore browser cannot login from UI if activation cannot succeed.

---

## 11) Runtime Dependency Analysis

### 11.1 Runtime usage table (required)

| File | Runtime Usage | Purpose | Safe in Browser? | Recommendation |
|------|---------------|---------|------------------|----------------|
| [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | `runtime.getConfig()`, `runtime.getMachineId()` | Resolve API base and attach runtime headers | Safe (guarded) | Keep guarded; in web mode ensure base does not fall back to localhost. |
| [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx) | `runtime.setSessionToken()`, `runtime.setActiveBranch()`, `runtime.getActiveBranch()` | Persist session/branch inside Electron | Safe (guarded) | Keep guarded; add browser-safe equivalents only if needed. |
| [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx) | `runtime.getMachineId()` | Device registration/heartbeat | Safe (guarded) | Web mode should skip device registration entirely (already skips if no machineId). |
| [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx) | `runtime.getMachineId()` | Optional machineId in activation payload | Safe (guarded) | Web mode can omit machineId. Keep guarded. |
| [LicenseExpiredModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/layout/LicenseExpiredModal.tsx) | `runtime.getMachineId()` | Optional machineId in activation payload | Safe (guarded) | Same as above. |
| [Layout.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/layouts/Layout.tsx) | `runtime.getConfig()`, `runtime.getLanAddresses()` | Display network status; help LAN setup | Safe (guarded) | Keep guarded; in web mode show server URL mode instead of LAN mode. |
| [DeviceLoginBootstrap.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/DeviceLoginBootstrap.tsx) | runtime presence checks | Login bootstrap behavior | Unclear | Verify if bootstrap blocks browser mode; likely should be disabled in web builds. |

### 11.2 Electron headers usage (required)

Electron-only headers are generated by `readRuntimeHeaders()` in [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L59-L73):
- `x-electron-runtime: 1`
- `x-runtime-mode: <cfg.runtimeMode>`
- `x-runtime-version: ...`
- `x-device-id: <machineId>`

Browser mode does not send these headers (no runtime), which must be acceptable in web mode.

---

## 12) LocalStorage and Cached Config Analysis

### 12.1 Can `lan.apiBaseUrl` store `http://localhost:4010/api/v1`?

Yes. `saveLanConnection(serverIp, port)` writes `http://{serverIp}:{port}/api/v1` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L12-L18)).

### 12.2 Can browser keep using old values after code changes?

Yes. `resolveApiBaseUrl()` reads localStorage at runtime and will keep using stale values until cleared ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L88-L90)).

### 12.3 Recommended debug reset commands (do not implement; manual test only)

Run in the browser console when testing web mode:

```js
localStorage.removeItem('lan.apiBaseUrl')
localStorage.removeItem('lan.serverIp')
localStorage.removeItem('lan.connectionMode')
localStorage.removeItem('lan.serverPort')
localStorage.removeItem('app.license')
localStorage.removeItem('auth.activeBranchId')
sessionStorage.clear()
location.reload()
```

Note: `lan.serverPort` is written but not cleared by `clearLanConnection()` ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L17-L28)).

### 12.4 Should web mode ignore `lan.apiBaseUrl`?

Yes, in a safe design web mode should ignore LAN localStorage overrides unless the user explicitly enables “LAN mode” in a browser. Otherwise a random cached LAN override can break VPS mode.

---

## 13) Backend License Route Analysis

There is **no `server/src/services/licenseService.ts`** in this project. License logic lives in:
- Router: [licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts)
- Repository: [licenseRepository.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/repositories/licenseRepository.ts)

Backend activation error behavior:
- Invalid license code throws `HttpError(400, 'INVALID_LICENSE_CODE')` ([licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts#L87-L89)).
- Global handler returns `{ success:false, error: error.message }` for `HttpError` without a `code` field ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L232-L235)).

Frontend activation UI currently expects `err.response.data.code`, so it will not display the real reason.

---

## 14) Recommended Architecture (Dual Mode)

### 14.1 Runtime mode concept

Introduce an explicit runtime “app mode” concept (web vs electron) without changing the existing Electron behavior:
- **Electron Desktop mode**:
  - Uses `window.runtime.getConfig().apiBaseUrl` (or localhost fallback) and uses machineId headers.
- **Web Browser mode**:
  - Uses a safe default: **`/api/v1`** (relative).
  - Avoids LAN localStorage overrides by default.
  - Does not require runtime headers.

### 14.2 API base resolver policy (target design)

Resolver order (minimal risk):
1) If `import.meta.env.VITE_API_BASE_URL` is set:
   - Use it (for controlled builds).
2) Else if `window.runtime.getConfig()` exists:
   - Use `cfg.apiBaseUrl` (Electron behavior preserved).
3) Else:
   - Use `/api/v1` (web browser mode default).

Do **not** use `http://localhost:4010/api/v1` as a default in production web builds.

### 14.3 Nginx compatibility

Relative `/api/v1` is the safest because it:
- Works with `:2730` now and domain later
- Works with HTTPS later
- Avoids CORS complexity by staying same-origin
- Avoids exposing backend port `4010`

---

## 15) Minimal Safe Fix Plan (Do Not Implement Here)

This plan is ordered to minimize risk to Electron mode.

| Step | Change | Files | Risk | Notes |
|------|--------|-------|------|------|
| 1 | Decide “web mode vs LAN mode” strategy | (design) | Medium | Must confirm whether web users should be treated as LAN devices or not. |
| 2 | Fix backend CORS for VPS origin OR remove CORS restrictions for same-origin web mode | [app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L95-L119) | Medium | Explains curl vs browser difference. |
| 3 | Implement safe API base resolver for web mode default `/api/v1` | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | Medium | Preserve Electron order and LAN behavior. |
| 4 | In web mode, ignore `lan.apiBaseUrl` unless user explicitly chooses LAN connection | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) + UI | Medium | Prevent sticky cached LAN settings from breaking VPS. |
| 5 | Fix license activation UI error handling to show real backend message | [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx), [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | Low | Use backend `payload.error` string; stop Axios-only assumptions. |
| 6 | Confirm login device authorization policy for web mode | [authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts) | High | Current device gate can block browser users. |
| 7 | Align realtime base with resolved API base | [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L266-L268) | Low | SSE should use the same base as `httpClient`. |
| 8 | Add a “Reset browser config” button for support | UI only | Low | Clears lan.* / app.license / auth.* keys for troubleshooting. |

---

## 16) Risk Assessment

| Risk | Impact | Applies To | Mitigation |
|------|--------|------------|------------|
| CORS rejecting VPS origin | Browser cannot call API even though backend is healthy | Web mode | Allow VPS origin or enforce same-origin strategy correctly. |
| Default API base = localhost | Browser points to user PC, not VPS | Web mode | Use `/api/v1` default for web. |
| Stale localStorage LAN settings | Web mode unpredictably uses old LAN address | Web mode | Ignore LAN overrides in web unless explicitly enabled; add reset UX. |
| Device authorization requiring `x-device-id` | Browser login blocked | Web mode | Decide policy: disable for web or define browser device identity strategy. |
| Breaking Electron | Production desktop workflow broken | Electron mode | Keep priority to `window.runtime` config; do not remove existing runtime behavior. |

---

## 17) Final Recommendation

1) Treat the current VPS issue as primarily **frontend/runtime compatibility + backend CORS policy**, not a DB/network outage.  
2) Implement web mode by:
   - Using `/api/v1` as default API base (browser)
   - Preserving runtime config as the source of truth for Electron
   - Fixing CORS to allow the VPS browser origin (or ensuring same-origin calls work without CORS rejection)
   - Making license activation show real backend errors to avoid false “server down” messages
3) Decide and document device authorization for web users (LAN-only feature vs web-ready feature).

---

## 18) Final Diagnosis (Required)

1) Can Web Browser mode be added without breaking Electron mode?  
Yes. The architecture already supports runtime-based overrides; it needs a safe browser default and a strict separation of assumptions.

2) What is the exact reason browser activation/login fails now?  
Most likely a combination of:
- **CORS origin rejection** for `http://65.21.136.217:2730` ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L95-L119)), and/or
- **Wrong API base** caused by localhost fallback or persisted `lan.apiBaseUrl` override ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4), [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L88-L96)).
If the backend returns real errors, the UI likely hides them due to error parsing mismatch ([ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx#L108-L114), [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L191-L193)).

3) Which files must be changed in the future implementation task?  
- Frontend: [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts), [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx), [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx), [LicenseExpiredModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/layout/LicenseExpiredModal.tsx), [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx)  
- Backend: [app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts) (CORS), possibly [authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts) (device gate policy for web)

4) What is the safest implementation order?  
Start with CORS + API base resolver + error visibility, then confirm device authorization policy, then align realtime, then add UX reset tools.

5) What must not be changed?  
Electron runtime bridge behavior, local PostgreSQL workflow, packaging workflow, and runtime-based LAN resolution logic ([runtimeConfig.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/electron/ipc/runtimeConfig.ts)).

6) Is this a VPS/network problem or frontend runtime compatibility problem?  
Evidence strongly points to **frontend/browser compatibility + server CORS policy**, not a backend outage.

7) Is the backend currently healthy?  
Yes. Health endpoints and curl requests succeed (per known facts).

8) Is Nginx proxy currently healthy?  
Likely yes (curl through `/api/v1/...` succeeds), but browser still fails due to CORS/API base/runtime assumptions.

9) What is the next implementation task?  
Implement “Web Browser mode runtime support” with:
- safe API base resolver,
- VPS origin CORS strategy,
- browser-safe license/login UX,
- explicit device authorization policy for web.

---

## 19) Required Tables

### Table 1 — Current Working / Failing Checks

| Check | Result | Evidence | Notes |
|------|--------|----------|-------|
| Backend health through `/api` | Works | `GET /api/health` ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L148-L150)) | Curl ok, browser should be ok if CORS allows. |
| Login curl through `/api` | Works (reported) | Backend route exists ([authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts#L95-L111)) | Curl likely run from VPS or without Origin. |
| License curl through `/api` | Works (reported) | Backend route exists ([licenseRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/licenseRoutes.ts#L82-L131)) | Curl has no Origin. |
| Browser login page opens | Works | Frontend served by Nginx | UI can load, but API calls can fail. |
| Browser activation fails | Fails | UI depends on activation before login ([Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L210-L212)) | Likely CORS/API base/localStorage. |
| Old localhost API issue | Known failure mode | Default base uses localhost ([httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L1-L4)) | Must be removed for web builds. |
| Current 500 issue | Likely | CORS throws error on origin not allowed ([app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts#L116-L117)) | Explains “500 in browser but curl ok”. |

### Table 2 — Files Responsible

| File | Responsibility | Browser Risk | Electron Risk | Recommendation |
|------|----------------|--------------|---------------|----------------|
| [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | API base resolver + runtime headers | High | Medium | Add web-safe default `/api/v1`; ignore stale LAN overrides in web. |
| [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx) | Login/refresh/session restore + realtime connect | Medium | Low | Use same resolved base for realtime as for httpClient. |
| [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx) | License gating + device handshake + branches preload | High | Low | Ensure web mode can activate license and login without runtime. |
| [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx) | License activation UI | High | Low | Show real backend errors; do not assume Axios error shape. |
| [LicenseExpiredModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/layout/LicenseExpiredModal.tsx) | License renewal UI | High | Low | Same as activation modal. |
| [app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts) | CORS policy + error handler | High | Low | Add VPS origin / domain allow; avoid rejecting same-origin web calls. |
| [authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts) | Device authorization gate | High | Low | Decide policy for web mode (LAN-only vs web). |

### Table 3 — API Base Decisions

| Runtime | Current API Base | Correct API Base | Source of Value | Notes |
|---------|------------------|------------------|-----------------|-------|
| Electron dev | `VITE_API_BASE_URL` or `http://localhost:4010/api/v1` | `http://localhost:4010/api/v1` | Vite env / default | OK for dev. |
| Electron packaged | `cfg.apiBaseUrl` | `cfg.apiBaseUrl` | Electron runtime config | Must remain. |
| Browser via IP:2730 | Often wrong unless configured | `/api/v1` | Browser default | Must not use localhost. |
| Browser via domain later | Often wrong unless configured | `/api/v1` | Browser default | Works with HTTPS and no CORS. |
| Local dev browser | `http://localhost:4010/api/v1` | `http://localhost:4010/api/v1` | Vite env / default | OK for local dev. |

### Table 4 — Runtime Usage

| Runtime Feature | Used In | Required For Electron? | Required For Browser? | Recommendation |
|----------------|---------|------------------------|-----------------------|----------------|
| `runtime.getConfig()` | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L75-L99), [Layout.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/layouts/Layout.tsx) | Yes | No | Guard and fall back. |
| `runtime.getMachineId()` | [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L52-L56), [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx#L89-L97) | Yes | No | In web, omit. |
| `runtime.setSessionToken()` | [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L258-L259) | Yes | No | No-op in web. |
| `runtime.setActiveBranch()` | [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx#L259-L260) | Yes | No | No-op in web. |
| Electron headers | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts#L59-L73) | Yes | No | Must be optional. |
| Device heartbeat | [Login.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/pages/Login.tsx#L147-L165) | Yes (LAN ops) | No | Skip in web. |

### Table 5 — Proposed Fix Plan

| Step | Change | Files | Risk | Notes |
|------|--------|-------|------|-------|
| 1 | Add VPS/browser origin allow strategy | [app.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/app.ts) | Medium | Explains browser 500 vs curl. |
| 2 | Add web-safe API base resolver default `/api/v1` | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | Medium | Preserve Electron precedence. |
| 3 | Ignore stale LAN overrides in web mode by default | [httpClient.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/lib/api/httpClient.ts) | Medium | Prevent sticky misconfig. |
| 4 | Fix activation error reporting | [ActivationModal.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/components/login/ActivationModal.tsx) | Low | Show true backend error. |
| 5 | Decide device authorization for web | [authRoutes.ts](file:///c:/Users/Homsi/Desktop/almiya-hsahin/server/src/routes/authRoutes.ts) | High | Web users do not have `x-device-id`. |
| 6 | Align realtime base with resolved API base | [AuthProvider.tsx](file:///c:/Users/Homsi/Desktop/almiya-hsahin/src/context/AuthProvider.tsx) | Low | SSE should match normal API. |

