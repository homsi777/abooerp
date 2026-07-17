import { app, ipcMain } from 'electron';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { loadDesktopSecrets, saveDesktopSecrets } from '../security/desktopSecrets.js';
import { loadRuntimeConfig, resolveMachineId } from './runtimeConfig.js';
const LOCAL_DATABASE = 'almiya_hsahin_offline';
function loopbackOnly(value) {
    const entries = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    return entries.length > 0 && entries.every((entry) => ['localhost', '127.0.0.1', '::1'].includes(entry));
}
export function registerDesktopSetupIpc() {
    ipcMain.handle('desktop-setup:get-status', async () => ({
        configured: Boolean(loadDesktopSecrets()?.postgresPassword),
        database: LOCAL_DATABASE,
    }));
    ipcMain.handle('desktop-setup:configure-postgres', async (_event, payload) => {
        const password = String(payload?.password ?? '');
        if (password.length < 8 || password.length > 256) {
            return { success: false, error: 'POSTGRES_PASSWORD_LENGTH_INVALID' };
        }
        const admin = new pg.Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 5000 });
        try {
            await admin.connect();
            const settings = await admin.query(`select current_setting('listen_addresses') listen_addresses`);
            if (!loopbackOnly(settings.rows[0]?.listen_addresses ?? '')) {
                return { success: false, error: 'POSTGRES_NOT_LOOPBACK_ONLY' };
            }
            const existing = await admin.query(`select 1 from pg_database where datname=$1`, [LOCAL_DATABASE]);
            let runtimeUser = 'postgres';
            let runtimePassword = password;
            if (!existing.rowCount) {
                const machineId = await resolveMachineId();
                const role = `almiya_device_${machineId.replace(/[^a-f0-9]/gi, '').slice(0, 12).toLowerCase()}`;
                if (!/^almiya_device_[a-f0-9]{12}$/.test(role))
                    return { success: false, error: 'DEVICE_DATABASE_ROLE_INVALID' };
                runtimePassword = randomBytes(32).toString('base64url');
                const quotedPassword = (await admin.query(`select quote_literal($1) value`, [runtimePassword])).rows[0].value;
                const roleExists = await admin.query(`select 1 from pg_roles where rolname=$1`, [role]);
                if (roleExists.rowCount)
                    await admin.query(`alter role "${role}" login createdb password ${quotedPassword}`);
                else
                    await admin.query(`create role "${role}" login createdb password ${quotedPassword}`);
                await admin.query(`create database ${LOCAL_DATABASE} owner "${role}"`);
                runtimeUser = role;
            }
            const previous = loadDesktopSecrets();
            saveDesktopSecrets({
                postgresPassword: runtimePassword,
                postgresUser: runtimeUser,
                backupKey: previous?.backupKey || randomBytes(32).toString('base64'),
                centralSyncDeviceId: previous?.centralSyncDeviceId,
                centralSyncDeviceToken: previous?.centralSyncDeviceToken,
            });
            return { success: true, database: LOCAL_DATABASE };
        }
        catch {
            return { success: false, error: 'POSTGRES_CONNECTION_FAILED' };
        }
        finally {
            await admin.end().catch(() => undefined);
        }
    });
    ipcMain.handle('desktop-setup:list-central-branches', async () => {
        try {
            const runtime = await loadRuntimeConfig();
            const base = String(runtime.centralSyncApiBaseUrl || '').replace(/\/$/, '');
            const response = await fetch(`${base}/auth/branches`, { signal: AbortSignal.timeout(10000) });
            const body = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(body?.data))
                return { success: false, error: 'CENTRAL_BRANCHES_UNAVAILABLE', branches: [] };
            return { success: true, branches: body.data.map((branch) => ({ id: String(branch.id), code: String(branch.code ?? ''), name: String(branch.name ?? '') })) };
        }
        catch {
            return { success: false, error: 'CENTRAL_BRANCHES_UNAVAILABLE', branches: [] };
        }
    });
    ipcMain.handle('desktop-setup:activate-sync', async (_event, payload) => {
        const username = String(payload?.username ?? '').trim();
        const password = String(payload?.password ?? '');
        const branchId = String(payload?.branchId ?? '');
        if (!username || !password || !/^[0-9a-f-]{36}$/i.test(branchId))
            return { success: false, error: 'CENTRAL_CREDENTIALS_REQUIRED' };
        try {
            const runtime = await loadRuntimeConfig();
            const base = String(runtime.centralSyncApiBaseUrl || '').replace(/\/$/, '');
            const machineId = await resolveMachineId();
            const commonHeaders = { 'content-type': 'application/json', 'x-device-id': machineId, 'x-electron-runtime': '1' };
            const registration = await fetch(`${base}/system/register-device`, {
                method: 'POST', headers: commonHeaders, signal: AbortSignal.timeout(12000),
                body: JSON.stringify({ machineId, deviceName: runtime.deviceName, osType: `Windows ${process.getSystemVersion()}` }),
            });
            const registrationBody = await registration.json().catch(() => null);
            if (registration.status === 202 || String(registrationBody?.error ?? '').includes('PENDING'))
                return { success: false, error: 'DEVICE_PENDING_APPROVAL' };
            if (!registration.ok)
                return { success: false, error: String(registrationBody?.error ?? 'DEVICE_REGISTRATION_FAILED') };
            const login = await fetch(`${base}/auth/login`, {
                method: 'POST', headers: commonHeaders, signal: AbortSignal.timeout(12000),
                body: JSON.stringify({ username, password, branchId }),
            });
            const loginBody = await login.json().catch(() => null);
            const accessToken = String(loginBody?.data?.session?.accessToken ?? '');
            if (!login.ok || !accessToken)
                return { success: false, error: 'CENTRAL_LOGIN_FAILED' };
            const activation = await fetch(`${base}/sync/device-activate`, {
                method: 'POST', signal: AbortSignal.timeout(12000),
                headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, 'x-device-id': machineId, 'x-electron-runtime': '1', 'x-branch-id': branchId },
                body: JSON.stringify({ machineId, deviceName: runtime.deviceName, branchId, appVersion: app.getVersion(), schemaVersion: runtime.schemaVersion }),
            });
            const activationBody = await activation.json().catch(() => null);
            if (activation.status === 202 || String(activationBody?.error ?? '').includes('PENDING'))
                return { success: false, error: 'SYNC_DEVICE_PENDING_APPROVAL' };
            const deviceId = String(activationBody?.data?.deviceId ?? '');
            const deviceToken = String(activationBody?.data?.deviceToken ?? '');
            if (!activation.ok || !deviceId || !deviceToken)
                return { success: false, error: String(activationBody?.error ?? 'SYNC_ACTIVATION_FAILED') };
            const secrets = loadDesktopSecrets();
            if (!secrets)
                return { success: false, error: 'POSTGRES_CREDENTIALS_REQUIRED' };
            saveDesktopSecrets({ ...secrets, centralSyncDeviceId: deviceId, centralSyncDeviceToken: deviceToken });
            return { success: true, deviceId };
        }
        catch {
            return { success: false, error: 'CENTRAL_CONNECTION_FAILED' };
        }
    });
}
