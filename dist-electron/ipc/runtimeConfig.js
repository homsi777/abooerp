import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { app, ipcMain } from 'electron';
function getLocalLanAddressesElectron() {
    const addresses = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const iface of list ?? []) {
            if (!iface || iface.family !== 'IPv4' || iface.internal)
                continue;
            const ip = iface.address;
            if (ip.startsWith('127.') || ip.startsWith('169.254.'))
                continue;
            if (ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
                addresses.push(ip);
            }
        }
    }
    return addresses;
}
const CHANNEL_ENV = 'runtime:get-env';
const CHANNEL_VERSION = 'runtime:get-version';
const CHANNEL_GET_RUNTIME_CONFIG = 'runtime:get-config';
const CHANNEL_GET_SESSION_STATUS = 'runtime:get-session-status';
const CHANNEL_SET_SESSION_TOKEN = 'runtime:set-session-token';
const CHANNEL_GET_MACHINE_ID = 'runtime:get-machine-id';
const CHANNEL_GET_ACTIVE_BRANCH = 'runtime:get-active-branch';
const CHANNEL_SET_ACTIVE_BRANCH = 'runtime:set-active-branch';
function getEnvironment() {
    return app.isPackaged ? 'production' : 'development';
}
function getBundledRuntimePath() {
    return path.resolve(app.getAppPath(), 'config', 'runtime.json');
}
function getUserRuntimePath() {
    return path.resolve(app.getPath('userData'), 'runtime.json');
}
function getUserSessionPath() {
    return path.resolve(app.getPath('userData'), 'auth-session.json');
}
async function readJsonConfig(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed;
    }
    catch {
        return null;
    }
}
function getDefaultRuntimeConfig() {
    return {
        apiBaseUrl: 'http://127.0.0.1:4010/api/v1',
        environment: getEnvironment(),
        runtimeMode: app.isPackaged ? 'local_production' : 'development',
        backendResolutionMode: 'localhost',
        manualLanHost: '',
        backendPort: 4010,
        schemaVersion: '033',
        deviceName: os.hostname() || 'desktop-node',
        featureFlags: {
            desktopMode: true,
        },
    };
}
function buildApiUrl(host, port) {
    return `http://${host}:${port}/api/v1`;
}
async function isHealthyApiBase(apiBaseUrl) {
    try {
        const response = await fetch(apiBaseUrl.replace(/\/api\/v1$/, '/api/health'));
        return response.ok;
    }
    catch {
        return false;
    }
}
async function autoDetectLanApiBase(port) {
    const interfaces = os.networkInterfaces();
    const candidates = new Set();
    for (const list of Object.values(interfaces)) {
        for (const iface of list || []) {
            if (!iface || iface.family !== 'IPv4' || iface.internal)
                continue;
            candidates.add(iface.address);
        }
    }
    for (const ip of candidates) {
        const candidate = buildApiUrl(ip, port);
        if (await isHealthyApiBase(candidate)) {
            return candidate;
        }
    }
    return null;
}
async function resolveApiBaseUrl(config) {
    if (config.backendResolutionMode === 'localhost') {
        return buildApiUrl('127.0.0.1', config.backendPort);
    }
    if (config.backendResolutionMode === 'manual_lan') {
        const manualHost = String(config.manualLanHost || '').trim();
        if (manualHost) {
            const candidate = buildApiUrl(manualHost, config.backendPort);
            if (await isHealthyApiBase(candidate))
                return candidate;
        }
        return buildApiUrl('127.0.0.1', config.backendPort);
    }
    const detected = await autoDetectLanApiBase(config.backendPort);
    return detected ?? buildApiUrl('127.0.0.1', config.backendPort);
}
function normalizeRuntimeMode(config) {
    if (!app.isPackaged)
        return 'development';
    if (config.backendResolutionMode === 'auto_lan' || config.backendResolutionMode === 'manual_lan') {
        return 'lan_node';
    }
    return 'local_production';
}
const RUNTIME_CONFIG_SNAPSHOT_TTL_MS = 2000;
const deviceNameBySessionKey = new Map();
let runtimeConfigSnapshot = null;
let loadRuntimeConfigInFlight = null;
function deviceNameCacheKey(apiBase, accessToken) {
    return `${apiBase}\n${accessToken}`;
}
export function invalidateRuntimeConfigSnapshot() {
    runtimeConfigSnapshot = null;
    deviceNameBySessionKey.clear();
}
async function resolveDeviceNameFromSystemSettings(config) {
    const state = await readStoredSessionState();
    const accessToken = state.accessToken || null;
    if (!accessToken) {
        return config.deviceName;
    }
    const key = deviceNameCacheKey(config.apiBaseUrl, accessToken);
    if (deviceNameBySessionKey.has(key)) {
        return deviceNameBySessionKey.get(key);
    }
    try {
        const response = await fetch(`${config.apiBaseUrl}/system-settings/runtime.deviceName`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(state.activeBranchId ? { 'x-branch-id': state.activeBranchId } : {}),
                'x-electron-runtime': '1',
            },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success === false) {
            deviceNameBySessionKey.set(key, config.deviceName);
            return config.deviceName;
        }
        const value = String(payload?.data?.value ?? '').trim();
        const resolved = value || config.deviceName;
        deviceNameBySessionKey.set(key, resolved);
        return resolved;
    }
    catch {
        deviceNameBySessionKey.set(key, config.deviceName);
        return config.deviceName;
    }
}
async function buildRuntimeConfig() {
    const defaults = getDefaultRuntimeConfig();
    const userConfig = await readJsonConfig(getUserRuntimePath());
    const bundledConfig = await readJsonConfig(getBundledRuntimePath());
    const merged = {
        ...defaults,
        ...(bundledConfig || {}),
        ...(userConfig || {}),
        environment: getEnvironment(),
        featureFlags: {
            ...defaults.featureFlags,
            ...(bundledConfig?.featureFlags || {}),
            ...(userConfig?.featureFlags || {}),
        },
    };
    merged.runtimeMode = normalizeRuntimeMode(merged);
    merged.apiBaseUrl = await resolveApiBaseUrl(merged);
    merged.deviceName = await resolveDeviceNameFromSystemSettings(merged);
    return merged;
}
export async function loadRuntimeConfig() {
    if (runtimeConfigSnapshot && Date.now() - runtimeConfigSnapshot.at < RUNTIME_CONFIG_SNAPSHOT_TTL_MS) {
        return runtimeConfigSnapshot.config;
    }
    if (loadRuntimeConfigInFlight) {
        return loadRuntimeConfigInFlight;
    }
    loadRuntimeConfigInFlight = (async () => {
        const config = await buildRuntimeConfig();
        runtimeConfigSnapshot = { config, at: Date.now() };
        return config;
    })().finally(() => {
        loadRuntimeConfigInFlight = null;
    });
    return loadRuntimeConfigInFlight;
}
async function readStoredSessionState() {
    try {
        const raw = await fs.readFile(getUserSessionPath(), 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed || {};
    }
    catch {
        return {};
    }
}
async function writeStoredSessionState(next) {
    if (!next.accessToken && !next.activeBranchId) {
        try {
            await fs.unlink(getUserSessionPath());
        }
        catch {
            // Ignore missing file.
        }
        invalidateRuntimeConfigSnapshot();
        return;
    }
    await fs.writeFile(getUserSessionPath(), JSON.stringify(next, null, 2), 'utf-8');
    invalidateRuntimeConfigSnapshot();
}
async function writeStoredSessionToken(token) {
    const current = await readStoredSessionState();
    await writeStoredSessionState({
        ...current,
        accessToken: token,
    });
}
/** Called once on every app boot to guarantee no stale session survives a restart. */
export async function clearStoredSession() {
    await writeStoredSessionState({ accessToken: null, activeBranchId: null });
}
async function writeStoredActiveBranch(branchId) {
    const current = await readStoredSessionState();
    await writeStoredSessionState({
        ...current,
        activeBranchId: branchId,
    });
}
export async function resolveSessionStatus() {
    const config = await loadRuntimeConfig();
    const state = await readStoredSessionState();
    const accessToken = state.accessToken || null;
    const activeBranchId = state.activeBranchId || null;
    if (!accessToken) {
        return { authenticated: false };
    }
    try {
        const response = await fetch(`${config.apiBaseUrl}/auth/me`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(activeBranchId ? { 'x-branch-id': activeBranchId } : {}),
            },
        });
        if (!response.ok) {
            return { authenticated: false };
        }
        const payload = await response.json();
        if (payload?.success !== true) {
            return { authenticated: false };
        }
        return {
            authenticated: true,
            user: payload.data,
            activeBranchId,
        };
    }
    catch {
        return { authenticated: false };
    }
}
function machineIdentity() {
    const source = `${app.getPath('userData')}::${process.platform}::${process.arch}::fallback`;
    return crypto.createHash('sha256').update(source).digest('hex');
}
function getDeviceIdentityPath() {
    return path.resolve(app.getPath('userData'), 'device-identity.json');
}
async function readPersistedMachineId() {
    try {
        const raw = await fs.readFile(getDeviceIdentityPath(), 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed.machineId || null;
    }
    catch {
        return null;
    }
}
export async function resolveMachineId() {
    const existing = await readPersistedMachineId();
    if (existing)
        return existing;
    const machineId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : machineIdentity();
    await fs.mkdir(path.dirname(getDeviceIdentityPath()), { recursive: true });
    await fs.writeFile(getDeviceIdentityPath(), JSON.stringify({ machineId }, null, 2), 'utf-8');
    return machineId;
}
export function registerRuntimeConfigIpc() {
    ipcMain.removeHandler(CHANNEL_ENV);
    ipcMain.removeHandler(CHANNEL_VERSION);
    ipcMain.removeHandler(CHANNEL_GET_RUNTIME_CONFIG);
    ipcMain.removeHandler(CHANNEL_GET_SESSION_STATUS);
    ipcMain.removeHandler(CHANNEL_SET_SESSION_TOKEN);
    ipcMain.removeHandler(CHANNEL_GET_MACHINE_ID);
    ipcMain.removeHandler(CHANNEL_GET_ACTIVE_BRANCH);
    ipcMain.removeHandler(CHANNEL_SET_ACTIVE_BRANCH);
    ipcMain.handle(CHANNEL_ENV, () => getEnvironment());
    ipcMain.handle(CHANNEL_VERSION, () => app.getVersion());
    ipcMain.handle(CHANNEL_GET_RUNTIME_CONFIG, async () => loadRuntimeConfig());
    ipcMain.handle(CHANNEL_GET_SESSION_STATUS, async () => resolveSessionStatus());
    ipcMain.handle(CHANNEL_SET_SESSION_TOKEN, async (_event, token) => {
        await writeStoredSessionToken(token);
        return { success: true };
    });
    ipcMain.handle(CHANNEL_GET_MACHINE_ID, async () => resolveMachineId());
    ipcMain.handle(CHANNEL_GET_ACTIVE_BRANCH, async () => {
        const state = await readStoredSessionState();
        return state.activeBranchId || null;
    });
    ipcMain.handle(CHANNEL_SET_ACTIVE_BRANCH, async (_event, branchId) => {
        await writeStoredActiveBranch(branchId);
        return { success: true };
    });
    ipcMain.removeHandler('runtime:get-lan-addresses');
    ipcMain.handle('runtime:get-lan-addresses', () => getLocalLanAddressesElectron());
    ipcMain.removeHandler('runtime:get-server-mode');
    ipcMain.handle('runtime:get-server-mode', async () => {
        const config = await loadRuntimeConfig();
        return config.runtimeMode;
    });
    ipcMain.removeHandler('runtime:test-lan-server');
    ipcMain.handle('runtime:test-lan-server', async (_event, ip, port) => {
        try {
            const url = `http://${ip}:${port}/api/v1/system/lan-health`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok)
                return { ok: false, error: `HTTP ${res.status}` };
            const json = await res.json();
            return { ok: true, data: json };
        }
        catch (e) {
            return { ok: false, error: e?.message ?? 'timeout' };
        }
    });
}
