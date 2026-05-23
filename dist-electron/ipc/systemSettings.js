import { ipcMain } from 'electron';
import { loadRuntimeConfig } from './runtimeConfig.js';
const CHANNEL_SYSTEM_LIST = 'system-settings:list';
const CHANNEL_SYSTEM_GET = 'system-settings:get';
const CHANNEL_SYSTEM_SET = 'system-settings:set';
async function requestWithOptionalAuth(path, init) {
    const runtime = await loadRuntimeConfig();
    const target = `${runtime.apiBaseUrl}${path}`;
    return fetch(target, init);
}
export function registerSystemSettingsIpc() {
    ipcMain.removeHandler(CHANNEL_SYSTEM_LIST);
    ipcMain.removeHandler(CHANNEL_SYSTEM_GET);
    ipcMain.removeHandler(CHANNEL_SYSTEM_SET);
    ipcMain.handle(CHANNEL_SYSTEM_LIST, async (_event, payload) => {
        const response = await requestWithOptionalAuth('/system-settings', {
            headers: {
                ...(payload?.authToken ? { Authorization: `Bearer ${payload.authToken}` } : {}),
                ...(payload?.branchId ? { 'x-branch-id': payload.branchId } : {}),
            },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
            throw new Error(body?.error || 'Cannot load system settings.');
        }
        return body.data;
    });
    ipcMain.handle(CHANNEL_SYSTEM_GET, async (_event, payload) => {
        const response = await requestWithOptionalAuth(`/system-settings/${encodeURIComponent(payload.key)}`, {
            headers: {
                ...(payload?.authToken ? { Authorization: `Bearer ${payload.authToken}` } : {}),
                ...(payload?.branchId ? { 'x-branch-id': payload.branchId } : {}),
            },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
            throw new Error(body?.error || `Cannot load setting '${payload.key}'.`);
        }
        return body.data;
    });
    ipcMain.handle(CHANNEL_SYSTEM_SET, async (_event, payload) => {
        const response = await requestWithOptionalAuth(`/system-settings/${encodeURIComponent(payload.key)}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${payload.authToken}`,
                ...(payload?.branchId ? { 'x-branch-id': payload.branchId } : {}),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ value: payload.value }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
            throw new Error(body?.error || `Cannot update setting '${payload.key}'.`);
        }
        return body.data;
    });
}
