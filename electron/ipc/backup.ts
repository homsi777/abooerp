import { access } from 'node:fs/promises';
import path from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, shell } from 'electron';

const CHANNEL_BACKUP_CONFIG = 'backup:get-config';
const CHANNEL_BACKUP_OPEN_DIR = 'backup:open-directory';
const CHANNEL_BACKUP_SELECT_RESTORE = 'backup:select-restore-file';
const CHANNEL_BACKUP_SELECT_SAVE = 'backup:select-save-path';
const CHANNEL_BACKUP_COPY_FILE = 'backup:copy-file';
const CHANNEL_BACKUP_DOWNLOAD_TO_PATH = 'backup:download-to-path';
const CHANNEL_BACKUP_WRITE_FILE = 'backup:write-file';

function resolveBackupDirectory() {
  return path.join(app.getPath('userData'), 'backups');
}

export function registerBackupIpc() {
  ipcMain.removeHandler(CHANNEL_BACKUP_CONFIG);
  ipcMain.removeHandler(CHANNEL_BACKUP_OPEN_DIR);
  ipcMain.removeHandler(CHANNEL_BACKUP_SELECT_RESTORE);
  ipcMain.removeHandler(CHANNEL_BACKUP_SELECT_SAVE);
  ipcMain.removeHandler(CHANNEL_BACKUP_COPY_FILE);
  ipcMain.removeHandler(CHANNEL_BACKUP_DOWNLOAD_TO_PATH);
  ipcMain.removeHandler(CHANNEL_BACKUP_WRITE_FILE);

  ipcMain.handle(CHANNEL_BACKUP_CONFIG, async () => {
    return {
      available: true,
      backupDirectory: resolveBackupDirectory(),
      platform: process.platform,
    };
  });

  ipcMain.handle(CHANNEL_BACKUP_OPEN_DIR, async () => {
    const target = resolveBackupDirectory();
    const result = await shell.openPath(target);
    return {
      success: !result,
      message: result || 'Backup directory opened.',
      backupDirectory: target,
    };
  });

  ipcMain.handle(CHANNEL_BACKUP_SELECT_RESTORE, async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Select backup file for restore validation',
      properties: ['openFile'],
      filters: [
        { name: 'Backup files', extensions: ['dump', 'backup', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return { selected: false, filePath: null };
    }
    return { selected: true, filePath: picked.filePaths[0] };
  });

  ipcMain.handle(CHANNEL_BACKUP_SELECT_SAVE, async (_event, payload?: { defaultFileName?: string }) => {
    const defaultFileName = payload?.defaultFileName?.trim() || `BKP-${Date.now()}.dump`;
    const picked = await dialog.showSaveDialog({
      title: 'اختر مكان حفظ النسخة الاحتياطية',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [
        { name: 'PostgreSQL backup', extensions: ['dump'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePath) {
      return { selected: false, filePath: null };
    }
    const filePath = picked.filePath.toLowerCase().endsWith('.dump') ? picked.filePath : `${picked.filePath}.dump`;
    return { selected: true, filePath };
  });

  ipcMain.handle(
    CHANNEL_BACKUP_COPY_FILE,
    async (_event, payload: { sourcePath?: string; destPath?: string }) => {
      const sourcePath = payload?.sourcePath?.trim();
      const destPath = payload?.destPath?.trim();
      if (!sourcePath || !destPath) {
        return { success: false, message: 'Missing source or destination path.' };
      }
      try {
        await access(sourcePath);
        await mkdir(path.dirname(destPath), { recursive: true });
        await copyFile(sourcePath, destPath);
        return { success: true, message: 'تم حفظ النسخة الاحتياطية.', destPath };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Copy failed.',
        };
      }
    },
  );

  ipcMain.handle(
    CHANNEL_BACKUP_DOWNLOAD_TO_PATH,
    async (_event, payload: { downloadUrl?: string; destPath?: string; authToken?: string | null }) => {
      const downloadUrl = payload?.downloadUrl?.trim();
      const destPath = payload?.destPath?.trim();
      if (!downloadUrl || !destPath) {
        return { success: false, message: 'Missing download URL or destination path.' };
      }
      try {
        const headers: Record<string, string> = {};
        if (payload.authToken) headers.Authorization = `Bearer ${payload.authToken}`;
        const response = await fetch(downloadUrl, { headers });
        if (!response.ok) {
          return { success: false, message: `Download failed (${response.status}).` };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await mkdir(path.dirname(destPath), { recursive: true });
        await writeFile(destPath, buffer);
        return { success: true, message: 'تم حفظ النسخة الاحتياطية.', destPath };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Download failed.',
        };
      }
    },
  );

  ipcMain.handle(
    CHANNEL_BACKUP_WRITE_FILE,
    async (_event, payload: { destPath?: string; dataBase64?: string }) => {
      const destPath = payload?.destPath?.trim();
      const dataBase64 = payload?.dataBase64;
      if (!destPath || !dataBase64) {
        return { success: false, message: 'Missing destination path or file data.' };
      }
      try {
        await mkdir(path.dirname(destPath), { recursive: true });
        await writeFile(destPath, Buffer.from(dataBase64, 'base64'));
        return { success: true, message: 'تم حفظ النسخة الاحتياطية.', destPath };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Write failed.',
        };
      }
    },
  );
}
