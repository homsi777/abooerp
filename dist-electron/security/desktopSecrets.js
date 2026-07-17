import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
function secretPath() { return path.join(app.getPath('userData'), 'desktop-secrets.bin'); }
function legacyEnvPath() { return path.join(app.getPath('userData'), 'server.env'); }
function parseEnv(raw) { return Object.fromEntries(raw.split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; })); }
function scrubLegacySecrets() {
    if (!existsSync(legacyEnvPath()))
        return;
    const clean = readFileSync(legacyEnvPath(), 'utf8').split(/\r?\n/)
        .filter(line => !/^\s*(PGPASSWORD|CENTRAL_SYNC_DEVICE_TOKEN|LOCAL_BACKUP_KEY)\s*=/.test(line)).join('\n');
    writeFileSync(legacyEnvPath(), clean.endsWith('\n') ? clean : `${clean}\n`, 'utf8');
}
export function saveDesktopSecrets(secrets) {
    if (!safeStorage.isEncryptionAvailable())
        throw new Error('Windows secure storage is not available.');
    mkdirSync(path.dirname(secretPath()), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
    writeFileSync(secretPath(), encrypted);
}
export function loadDesktopSecrets() {
    if (existsSync(secretPath())) {
        if (!safeStorage.isEncryptionAvailable())
            throw new Error('Windows secure storage is not available.');
        const parsed = JSON.parse(safeStorage.decryptString(readFileSync(secretPath())));
        if (!parsed.backupKey) {
            parsed.backupKey = randomBytes(32).toString('base64');
            saveDesktopSecrets(parsed);
        }
        return parsed;
    }
    let postgresPassword = process.env.LOCAL_POSTGRES_PASSWORD || process.env.PGPASSWORD || '';
    let centralSyncDeviceToken = process.env.CENTRAL_SYNC_DEVICE_TOKEN || undefined;
    if (!postgresPassword && existsSync(legacyEnvPath())) {
        const legacy = parseEnv(readFileSync(legacyEnvPath(), 'utf8'));
        postgresPassword = legacy.PGPASSWORD || '';
        centralSyncDeviceToken = centralSyncDeviceToken || legacy.CENTRAL_SYNC_DEVICE_TOKEN || undefined;
    }
    if (!postgresPassword)
        return null;
    const secrets = { postgresPassword, centralSyncDeviceToken, backupKey: randomBytes(32).toString('base64') };
    saveDesktopSecrets(secrets);
    scrubLegacySecrets();
    return secrets;
}
