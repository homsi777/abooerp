import fs from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain } from 'electron';
import { invalidateRuntimeConfigSnapshot, loadRuntimeConfig } from './runtimeConfig.js';

type RuntimeConfigPayload = {
  backendResolutionMode?: 'localhost' | 'manual_lan' | 'auto_lan';
  manualLanHost?: string;
  backendPort?: number;
  featureFlags?: Record<string, boolean>;
};

const CHANNEL_READ_CONFIG = 'fs:read-config';
const CHANNEL_WRITE_CONFIG = 'fs:write-config';
const CHANNEL_ENABLE_LOCAL_PACKAGED = 'fs:enable-local-packaged-server';

const LOCAL_PACKAGED_SERVER_FLAG = '.erp-spawn-local-api';

function getLocalPackagedServerFlagPath() {
  return path.resolve(app.getPath('userData'), LOCAL_PACKAGED_SERVER_FLAG);
}

function getUserRuntimePath() {
  return path.resolve(app.getPath('userData'), 'runtime.json');
}

export function registerFilesystemIpc() {
  ipcMain.removeHandler(CHANNEL_READ_CONFIG);
  ipcMain.removeHandler(CHANNEL_WRITE_CONFIG);
  ipcMain.removeHandler(CHANNEL_ENABLE_LOCAL_PACKAGED);

  ipcMain.handle(CHANNEL_READ_CONFIG, async () => loadRuntimeConfig());

  ipcMain.handle(CHANNEL_ENABLE_LOCAL_PACKAGED, async () => {
    await fs.mkdir(path.dirname(getLocalPackagedServerFlagPath()), { recursive: true });
    await fs.writeFile(getLocalPackagedServerFlagPath(), new Date().toISOString(), 'utf-8');
    return { success: true as const };
  });

  ipcMain.handle(CHANNEL_WRITE_CONFIG, async (_event, payload: RuntimeConfigPayload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid runtime config payload.');
    }

    const existing = await loadRuntimeConfig();
    const merged = {
      ...existing,
      backendResolutionMode: payload.backendResolutionMode ?? existing.backendResolutionMode,
      manualLanHost: payload.manualLanHost ?? existing.manualLanHost,
      backendPort: payload.backendPort ?? existing.backendPort,
      featureFlags: {
        ...existing.featureFlags,
        ...(payload.featureFlags || {}),
      },
    };

    await fs.mkdir(path.dirname(getUserRuntimePath()), { recursive: true });
    await fs.writeFile(getUserRuntimePath(), JSON.stringify(merged, null, 2), 'utf-8');

    // جهاز فرعي (LAN): لا يجب أن يبقى علامة تشغيل الخادم المحلي — وإلا يُشغّل فرعياً Postgres فارغاً ويُربك التشخيص.
    if (merged.backendResolutionMode === 'manual_lan' || merged.backendResolutionMode === 'auto_lan') {
      try {
        await fs.unlink(getLocalPackagedServerFlagPath());
      } catch {
        /* غير موجود */
      }
    }
    invalidateRuntimeConfigSnapshot();
    return merged;
  });
}
