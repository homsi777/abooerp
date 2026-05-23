import { rememberOwnCorrelationFromFetchResponse } from '../realtime/ownWriteCorrelation';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010/api/v1';

// ── LAN connection storage (localStorage persists across sessions) ────────────
export const LAN_STORAGE = {
  API_BASE_URL: 'lan.apiBaseUrl',
  SERVER_IP: 'lan.serverIp',
  CONNECTION_MODE: 'lan.connectionMode',
} as const;

export function saveLanConnection(serverIp: string, port = 4010): void {
  const apiBaseUrl = `http://${serverIp}:${port}/api/v1`;
  localStorage.setItem(LAN_STORAGE.API_BASE_URL, apiBaseUrl);
  localStorage.setItem(LAN_STORAGE.SERVER_IP, serverIp);
  localStorage.setItem(LAN_STORAGE.CONNECTION_MODE, 'local');
  localStorage.setItem('lan.serverPort', String(port));
}

export function getLanPort(): number {
  return Number(localStorage.getItem('lan.serverPort') ?? 4010) || 4010;
}

export function clearLanConnection(): void {
  localStorage.removeItem(LAN_STORAGE.API_BASE_URL);
  localStorage.removeItem(LAN_STORAGE.SERVER_IP);
  localStorage.removeItem(LAN_STORAGE.CONNECTION_MODE);
}

export function getLanState(): { mode: string; serverIp: string; apiBaseUrl: string } {
  return {
    mode: localStorage.getItem(LAN_STORAGE.CONNECTION_MODE) ?? 'default',
    serverIp: localStorage.getItem(LAN_STORAGE.SERVER_IP) ?? '',
    apiBaseUrl: localStorage.getItem(LAN_STORAGE.API_BASE_URL) ?? '',
  };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type UnauthorizedHandler = (message?: string) => 'retry' | void | Promise<'retry' | void>;
type ForbiddenHandler = (message?: string) => void | Promise<void>;
type ConflictHandler = (message?: string) => void | Promise<void>;

let authTokenGetter: (() => string | null) | undefined;
let activeBranchGetter: (() => string | null) | undefined;
let unauthorizedHandler: UnauthorizedHandler | undefined;
let forbiddenHandler: ForbiddenHandler | undefined;
let conflictHandler: ConflictHandler | undefined;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

async function readRuntimeHeaders(): Promise<Record<string, string>> {
  const runtime = (window as any)?.runtime;
  if (!runtime?.getConfig || !runtime?.getMachineId) return {};
  try {
    const [cfg, machineId] = await Promise.all([runtime.getConfig(), runtime.getMachineId()]);
    return {
      'x-electron-runtime': '1',
      'x-runtime-mode': String(cfg?.runtimeMode || ''),
      'x-runtime-version': String((window as any)?.diagnosticsRuntime ? (await (window as any).diagnosticsRuntime.getVersionMeta())?.runtimeVersion || '' : ''),
      'x-device-id': String(machineId || ''),
    };
  } catch {
    return { 'x-electron-runtime': '1' };
  }
}

async function resolveApiBaseUrl(): Promise<string> {
  const runtime = (window as any)?.runtime;
  // 1. Electron packaged: إن كان الجهاز مضبوطاً كعقدة LAN، عنوان السيرفر في runtime.json هو المصدر الموثوق (حتى لو تُرك localStorage فارغاً).
  if (runtime?.getConfig) {
    try {
      const cfg = await runtime.getConfig();
      if (String(cfg?.runtimeMode ?? '') === 'lan_node' && cfg?.apiBaseUrl) {
        return String(cfg.apiBaseUrl);
      }
    } catch {
      /* fall through */
    }
  }
  // 2. يدوي من واجهة الاتصال (localStorage)
  const lanUrl = localStorage.getItem(LAN_STORAGE.API_BASE_URL);
  if (lanUrl) return lanUrl;
  // 3. بقية إعدادات Electron أو الافتراضي
  if (!runtime?.getConfig) return API_BASE_URL;
  try {
    const cfg = await runtime.getConfig();
    return String(cfg?.apiBaseUrl || API_BASE_URL);
  } catch {
    return API_BASE_URL;
  }
}

export function getResolvedApiBaseUrl(): Promise<string> {
  return resolveApiBaseUrl();
}

export function configureHttpClientAuth(config: {
  getAccessToken: () => string | null;
  getActiveBranchId?: () => string | null;
  onUnauthorized: UnauthorizedHandler;
  onForbidden?: ForbiddenHandler;
  onConflict?: ConflictHandler;
}) {
  authTokenGetter = config.getAccessToken;
  activeBranchGetter = config.getActiveBranchId;
  unauthorizedHandler = config.onUnauthorized;
  forbiddenHandler = config.onForbidden;
  conflictHandler = config.onConflict;
}

async function request<T>(path: string, method: HttpMethod, body?: unknown, retryingAfterAuth = false, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  Object.assign(headers, await readRuntimeHeaders());
  const token = authTokenGetter?.();
  // Logout must not send a bad/expired bearer: requestContext would return 401 before the route runs.
  const skipAuthHeader =
    path.startsWith('/auth/login') || path.startsWith('/auth/refresh') || path.startsWith('/auth/logout');
  if (token && !skipAuthHeader) {
    headers.Authorization = `Bearer ${token}`;
  }
  const activeBranchId = activeBranchGetter?.();
  // /auth/me must resolve scope from the JWT's branch first; sending a stale
  // x-branch-id here can lock session restore to the wrong branch vs login.
  const skipBranchHeaderForPath = path === '/auth/me';
  if (!skipBranchHeaderForPath && activeBranchId && uuidRegex.test(activeBranchId)) {
    headers['x-branch-id'] = activeBranchId;
  }
  const writeMethod = method === 'POST' || method === 'PUT' || method === 'DELETE';
  if (writeMethod && !skipAuthHeader) {
    headers['x-idempotency-key'] = idempotencyKey ?? createIdempotencyKey();
  }

  const executeFetch = () =>
    resolveApiBaseUrl().then((baseUrl) =>
      fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      })
    );

  let response: Response;
  try {
    response = await executeFetch();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    response = await executeFetch().catch(() => {
      throw error;
    });
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (
    response.status === 401 &&
    unauthorizedHandler &&
    !retryingAfterAuth &&
    !path.startsWith('/auth/login') &&
    !path.startsWith('/auth/refresh') &&
    !path.startsWith('/auth/logout')
  ) {
    const action = await unauthorizedHandler(payload?.error);
    if (action === 'retry') {
      return request<T>(path, method, body, true, headers['x-idempotency-key']);
    }
  }
  if (response.status === 403 && forbiddenHandler) {
    await forbiddenHandler(payload?.error);
  }
  if (response.status === 409) {
    const conflictMsg = payload?.error ?? 'تم تعديل هذه البيانات من جهاز آخر. يرجى تحديث الصفحة.';
    if (conflictHandler) await conflictHandler(conflictMsg);
    throw new Error(conflictMsg);
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }
  if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && response.ok) {
    rememberOwnCorrelationFromFetchResponse(response);
  }
  return payload.data as T;
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path, 'GET'),
  post: <T>(path: string, body: unknown) => request<T>(path, 'POST', body),
  put: <T>(path: string, body: unknown) => request<T>(path, 'PUT', body),
  delete: <T>(path: string) => request<T>(path, 'DELETE'),
};

export { API_BASE_URL };
