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
function invokeAllowed(channel, ...args) {
    if (!allowedInvokeChannels.has(channel)) {
        return Promise.reject(new Error(`IPC channel '${channel}' is not allowed.`));
    }
    return ipcRenderer.invoke(channel, ...args);
}
const runtimeBridge = {
    getEnv: () => invokeAllowed('runtime:get-env'),
    getVersion: () => invokeAllowed('runtime:get-version'),
    getConfig: () => invokeAllowed('runtime:get-config'),
    getSessionStatus: () => invokeAllowed('runtime:get-session-status'),
    setSessionToken: (token) => invokeAllowed('runtime:set-session-token', token),
    getActiveBranch: () => invokeAllowed('runtime:get-active-branch'),
    setActiveBranch: (branchId) => invokeAllowed('runtime:set-active-branch', branchId),
    getMachineId: () => invokeAllowed('runtime:get-machine-id'),
    getLanAddresses: () => invokeAllowed('runtime:get-lan-addresses'),
    getServerMode: () => invokeAllowed('runtime:get-server-mode'),
    testLanServer: (ip, port) => invokeAllowed('runtime:test-lan-server', ip, port),
};
const diagnosticsRuntime = {
    healthCheck: () => invokeAllowed('diagnostics:health-check'),
    getLogs: () => invokeAllowed('diagnostics:get-logs'),
    getVersionMeta: () => invokeAllowed('diagnostics:get-version-meta'),
    appendLog: (payload) => invokeAllowed('diagnostics:append-log', payload),
};
const systemSettingsRuntime = {
    list: (payload) => invokeAllowed('system-settings:list', payload),
    get: (payload) => invokeAllowed('system-settings:get', payload),
    set: (payload) => invokeAllowed('system-settings:set', payload),
};
const printerRuntime = {
    list: () => invokeAllowed('printer:list'),
    getDefault: () => invokeAllowed('printer:get-default'),
    print: (payload) => invokeAllowed('printer:print', payload),
};
const pdfRuntime = {
    exportPdf: (payload) => invokeAllowed('pdf:export', payload),
};
const backupRuntime = {
    getConfig: () => invokeAllowed('backup:get-config'),
    openDirectory: () => invokeAllowed('backup:open-directory'),
    selectRestoreFile: () => invokeAllowed('backup:select-restore-file'),
};
const filesystemRuntime = {
    readConfig: () => invokeAllowed('fs:read-config'),
    writeConfig: (payload) => invokeAllowed('fs:write-config', payload),
    enableLocalPackagedServer: () => invokeAllowed('fs:enable-local-packaged-server'),
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
