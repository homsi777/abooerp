import { app, ipcMain } from 'electron';
import { loadRuntimeConfig } from './runtimeConfig.js';
const CHANNEL_RUNTIME_HEALTHCHECK = 'diagnostics:health-check';
const CHANNEL_RUNTIME_LOGS = 'diagnostics:get-logs';
const CHANNEL_RUNTIME_VERSION_META = 'diagnostics:get-version-meta';
const CHANNEL_RUNTIME_APPEND_LOG = 'diagnostics:append-log';
const logs = [];
export function appendRuntimeLog(level, message, metadata) {
    logs.push({
        at: new Date().toISOString(),
        level,
        message,
        metadata,
    });
    if (logs.length > 500)
        logs.shift();
}
async function runHealthCheck() {
    const runtime = await loadRuntimeConfig();
    const target = runtime.apiBaseUrl.replace(/\/api\/v1$/, '/api/health');
    const startedAt = Date.now();
    try {
        const response = await fetch(target, {
            headers: {
                'x-electron-runtime': '1',
                'x-runtime-mode': runtime.runtimeMode,
            },
        });
        const latencyMs = Date.now() - startedAt;
        const ok = response.ok;
        appendRuntimeLog(ok ? 'info' : 'warn', 'backend_health_check', {
            target,
            status: response.status,
            latencyMs,
        });
        return {
            ok,
            target,
            status: response.status,
            latencyMs,
            offline: !ok,
            runtimeMode: runtime.runtimeMode,
        };
    }
    catch (error) {
        const latencyMs = Date.now() - startedAt;
        appendRuntimeLog('error', 'backend_health_check_failed', {
            target,
            latencyMs,
            reason: error?.message || 'unknown',
        });
        return {
            ok: false,
            target,
            status: 0,
            latencyMs,
            offline: true,
            runtimeMode: runtime.runtimeMode,
        };
    }
}
export function registerDiagnosticsIpc() {
    ipcMain.removeHandler(CHANNEL_RUNTIME_HEALTHCHECK);
    ipcMain.removeHandler(CHANNEL_RUNTIME_LOGS);
    ipcMain.removeHandler(CHANNEL_RUNTIME_VERSION_META);
    ipcMain.removeHandler(CHANNEL_RUNTIME_APPEND_LOG);
    ipcMain.handle(CHANNEL_RUNTIME_HEALTHCHECK, async () => runHealthCheck());
    ipcMain.handle(CHANNEL_RUNTIME_LOGS, async () => logs.slice(-200));
    ipcMain.handle(CHANNEL_RUNTIME_VERSION_META, async () => {
        const runtime = await loadRuntimeConfig();
        return {
            appVersion: app.getVersion(),
            runtimeVersion: process.versions.electron,
            schemaVersion: runtime.schemaVersion,
            nodeVersion: process.versions.node,
            chromeVersion: process.versions.chrome,
        };
    });
    ipcMain.handle(CHANNEL_RUNTIME_APPEND_LOG, async (_event, payload) => {
        appendRuntimeLog(payload.level || 'info', payload.message, payload.metadata);
        return { success: true };
    });
}
