import { contextBridge, ipcRenderer } from 'electron';

const allowedInvokeChannels = new Set([
  'runtime:get-env',
  'runtime:get-version',
  'runtime:get-config',
  'runtime:get-session-status',
  'runtime:set-session-token',
  'runtime:get-active-branch',
  'runtime:set-active-branch',
  'runtime:get-machine-id',
  'runtime:get-lan-addresses',
  'runtime:get-server-mode',
  'runtime:test-lan-server',
  'fs:read-config',
  'fs:write-config',
  'fs:enable-local-packaged-server',
  'printer:list',
  'printer:get-default',
  'printer:print',
  'pdf:export',
  'backup:get-config',
  'backup:open-directory',
  'backup:select-restore-file',
  'diagnostics:health-check',
  'diagnostics:get-logs',
  'diagnostics:get-version-meta',
  'diagnostics:append-log',
  'system-settings:list',
  'system-settings:get',
  'system-settings:set',
]);

function invokeAllowed<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!allowedInvokeChannels.has(channel)) {
    return Promise.reject(new Error(`IPC channel '${channel}' is not allowed.`));
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const runtimeBridge = {
  getEnv: () => invokeAllowed('runtime:get-env'),
  getVersion: () => invokeAllowed('runtime:get-version'),
  getConfig: () => invokeAllowed('runtime:get-config'),
  getSessionStatus: () => invokeAllowed('runtime:get-session-status'),
  setSessionToken: (token: string | null) => invokeAllowed('runtime:set-session-token', token),
  getActiveBranch: () => invokeAllowed('runtime:get-active-branch'),
  setActiveBranch: (branchId: string | null) => invokeAllowed('runtime:set-active-branch', branchId),
  getMachineId: () => invokeAllowed('runtime:get-machine-id'),
  getLanAddresses: () => invokeAllowed<string[]>('runtime:get-lan-addresses'),
  getServerMode: () => invokeAllowed<string>('runtime:get-server-mode'),
  testLanServer: (ip: string, port: number) => invokeAllowed<{ ok: boolean; data?: unknown; error?: string }>('runtime:test-lan-server', ip, port),
};

const diagnosticsRuntime = {
  healthCheck: () => invokeAllowed('diagnostics:health-check'),
  getLogs: () => invokeAllowed('diagnostics:get-logs'),
  getVersionMeta: () => invokeAllowed('diagnostics:get-version-meta'),
  appendLog: (payload: { level?: 'info' | 'warn' | 'error'; message: string; metadata?: Record<string, unknown> }) =>
    invokeAllowed('diagnostics:append-log', payload),
};

const systemSettingsRuntime = {
  list: (payload?: { authToken?: string; branchId?: string | null }) => invokeAllowed('system-settings:list', payload),
  get: (payload: { key: string; authToken?: string; branchId?: string | null }) => invokeAllowed('system-settings:get', payload),
  set: (payload: { key: string; value: unknown; authToken: string; branchId?: string | null }) =>
    invokeAllowed('system-settings:set', payload),
};

const printerRuntime = {
  list: () => invokeAllowed('printer:list'),
  getDefault: () => invokeAllowed('printer:get-default'),
  print: (payload: unknown) => invokeAllowed('printer:print', payload),
};

const pdfRuntime = {
  exportPdf: (payload: unknown) => invokeAllowed('pdf:export', payload),
};

const backupRuntime = {
  getConfig: () => invokeAllowed('backup:get-config'),
  openDirectory: () => invokeAllowed('backup:open-directory'),
  selectRestoreFile: () => invokeAllowed('backup:select-restore-file'),
};

const filesystemRuntime = {
  readConfig: () => invokeAllowed('fs:read-config'),
  writeConfig: (payload: {
    backendResolutionMode?: 'localhost' | 'manual_lan' | 'auto_lan';
    manualLanHost?: string;
    backendPort?: number;
    featureFlags?: Record<string, boolean>;
  }) => invokeAllowed('fs:write-config', payload),
  enableLocalPackagedServer: () => invokeAllowed<{ success: boolean }>('fs:enable-local-packaged-server'),
};

contextBridge.exposeInMainWorld('runtime', runtimeBridge);
contextBridge.exposeInMainWorld('diagnosticsRuntime', diagnosticsRuntime);
contextBridge.exposeInMainWorld('systemSettingsRuntime', systemSettingsRuntime);
contextBridge.exposeInMainWorld('printerRuntime', printerRuntime);
contextBridge.exposeInMainWorld('pdfRuntime', pdfRuntime);
contextBridge.exposeInMainWorld('backupRuntime', backupRuntime);

// Backward compatibility aliases
contextBridge.exposeInMainWorld('fs', filesystemRuntime);
contextBridge.exposeInMainWorld('printer', printerRuntime);
