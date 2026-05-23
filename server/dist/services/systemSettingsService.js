import { z } from 'zod';
import { HttpError } from '../utils/errors.js';
import { SystemSettingsRepository } from '../repositories/systemSettingsRepository.js';
const hostnameRegex = /^(localhost|(([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|(\d{1,3}\.){3}\d{1,3})$/;
const supportedKeys = [
    'network.mode',
    'network.host',
    'network.port',
    'network.protocol',
    'network.publicUrl',
    'network.lanEnabled',
    'runtime.environment',
    'runtime.offlineMode',
    'runtime.autoReconnect',
    'runtime.deviceName',
    'runtime.maintenanceMode',
    'diagnostics.enabled',
    'diagnostics.level',
    'electron.autoLaunch',
    'electron.autoUpdateEnabled',
    'electron.windowMode',
    'backup.autoEnabled',
    'backup.intervalHours',
    'backup.retentionDays',
    'backup.verifyAfterCreate',
];
const protectedKeys = new Set(['runtime.environment']);
const defaultValues = {
    'network.mode': 'local_only',
    'network.host': '127.0.0.1',
    'network.port': 3001,
    'network.protocol': 'http',
    'network.publicUrl': '',
    'network.lanEnabled': false,
    'runtime.environment': 'development',
    'runtime.offlineMode': false,
    'runtime.autoReconnect': true,
    'runtime.deviceName': 'main-workstation',
    'runtime.maintenanceMode': false,
    'diagnostics.enabled': true,
    'diagnostics.level': 'info',
    'electron.autoLaunch': false,
    'electron.autoUpdateEnabled': true,
    'electron.windowMode': 'windowed',
    'backup.autoEnabled': true,
    'backup.intervalHours': 24,
    'backup.retentionDays': 30,
    'backup.verifyAfterCreate': true,
};
const validators = {
    'network.mode': (input) => z.enum(['local_only', 'lan_branch', 'cloud_ready', 'hybrid_ready']).parse(input),
    'network.host': (input) => {
        const host = z.string().min(1).max(255).parse(input).trim();
        if (!hostnameRegex.test(host)) {
            throw new HttpError(400, 'Invalid network.host format');
        }
        return host;
    },
    'network.port': (input) => z.number().int().min(1).max(65535).parse(input),
    'network.protocol': (input) => z.enum(['http', 'https']).parse(input),
    'network.publicUrl': (input) => {
        const text = z.string().max(500).parse(input).trim();
        if (!text)
            return '';
        let url;
        try {
            url = new URL(text);
        }
        catch {
            throw new HttpError(400, 'network.publicUrl must be a valid URL');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new HttpError(400, 'network.publicUrl must start with http:// or https://');
        }
        return text;
    },
    'network.lanEnabled': (input) => z.boolean().parse(input),
    'runtime.environment': (input) => z.enum(['development', 'staging', 'production', 'test']).parse(input),
    'runtime.offlineMode': (input) => z.boolean().parse(input),
    'runtime.autoReconnect': (input) => z.boolean().parse(input),
    'runtime.deviceName': (input) => z.string().trim().min(2).max(120).parse(input),
    'runtime.maintenanceMode': (input) => z.boolean().parse(input),
    'diagnostics.enabled': (input) => z.boolean().parse(input),
    'diagnostics.level': (input) => z.enum(['error', 'warn', 'info', 'debug']).parse(input),
    'electron.autoLaunch': (input) => z.boolean().parse(input),
    'electron.autoUpdateEnabled': (input) => z.boolean().parse(input),
    'electron.windowMode': (input) => z.enum(['windowed', 'maximized', 'fullscreen']).parse(input),
    'backup.autoEnabled': (input) => z.boolean().parse(input),
    'backup.intervalHours': (input) => z.number().int().min(1).max(168).parse(input),
    'backup.retentionDays': (input) => z.number().int().min(1).max(365).parse(input),
    'backup.verifyAfterCreate': (input) => z.boolean().parse(input),
};
const settingKeySchema = z.enum(supportedKeys);
export class SystemSettingsService {
    repository;
    constructor(repository = new SystemSettingsRepository()) {
        this.repository = repository;
    }
    validateSettingKey(key) {
        return settingKeySchema.parse(key);
    }
    validateValue(key, value) {
        return validators[key](value);
    }
    validateNetworkTopology(network) {
        if (network.protocol === 'https' && Number(network.port) === 80) {
            throw new HttpError(400, 'https protocol cannot use port 80');
        }
        if (network.protocol === 'http' && Number(network.port) === 443) {
            throw new HttpError(400, 'http protocol cannot use port 443');
        }
        if (network.lanEnabled && network.mode === 'cloud_ready') {
            throw new HttpError(400, 'network.mode cloud_ready is incompatible with LAN enabled mode');
        }
    }
    async listSettings(companyId) {
        const rows = await this.repository.listSettings(companyId);
        const merged = { ...defaultValues };
        for (const row of rows) {
            if (!supportedKeys.includes(row.key))
                continue;
            const key = row.key;
            try {
                merged[key] = this.validateValue(key, row.value);
            }
            catch {
                merged[key] = defaultValues[key];
            }
        }
        return merged;
    }
    async getSetting(companyId, key) {
        const normalizedKey = this.validateSettingKey(key);
        const row = await this.repository.getSetting(companyId, normalizedKey);
        if (!row) {
            return defaultValues[normalizedKey];
        }
        return this.validateValue(normalizedKey, row.value);
    }
    async setSetting(companyId, key, value, isEncrypted = false) {
        const normalizedKey = this.validateSettingKey(key);
        const normalizedValue = this.validateValue(normalizedKey, value);
        if (normalizedKey.startsWith('network.')) {
            const currentNetwork = await this.getNetworkConfig(companyId);
            const candidateNetwork = {
                ...currentNetwork,
                [normalizedKey.replace('network.', '')]: normalizedValue,
            };
            this.validateNetworkTopology(candidateNetwork);
        }
        return this.repository.setSetting(companyId, normalizedKey, normalizedValue, isEncrypted);
    }
    async deleteSetting(companyId, key) {
        const normalizedKey = this.validateSettingKey(key);
        if (protectedKeys.has(normalizedKey)) {
            throw new HttpError(403, `${normalizedKey} is restricted and cannot be deleted`);
        }
        return this.repository.deleteSetting(companyId, normalizedKey);
    }
    async getNetworkConfig(companyId) {
        const all = await this.listSettings(companyId);
        return {
            mode: all['network.mode'],
            host: all['network.host'],
            port: all['network.port'],
            protocol: all['network.protocol'],
            publicUrl: all['network.publicUrl'],
            lanEnabled: all['network.lanEnabled'],
        };
    }
    async getRuntimeConfig(companyId) {
        const all = await this.listSettings(companyId);
        return {
            environment: all['runtime.environment'],
            offlineMode: all['runtime.offlineMode'],
            autoReconnect: all['runtime.autoReconnect'],
            deviceName: all['runtime.deviceName'],
            maintenanceMode: all['runtime.maintenanceMode'],
            diagnosticsEnabled: all['diagnostics.enabled'],
            diagnosticsLevel: all['diagnostics.level'],
        };
    }
    async getElectronRuntimeConfig(companyId) {
        const all = await this.listSettings(companyId);
        return {
            windowMode: all['electron.windowMode'],
            autoLaunch: all['electron.autoLaunch'],
            autoUpdateEnabled: all['electron.autoUpdateEnabled'],
            deviceName: all['runtime.deviceName'],
            offlineMode: all['runtime.offlineMode'],
        };
    }
}
