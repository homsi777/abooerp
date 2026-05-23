import path from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';

const CHANNEL_BACKUP_CONFIG = 'backup:get-config';
const CHANNEL_BACKUP_OPEN_DIR = 'backup:open-directory';
const CHANNEL_BACKUP_SELECT_RESTORE = 'backup:select-restore-file';

function resolveBackupDirectory() {
  return path.join(app.getPath('userData'), 'backups');
}

export function registerBackupIpc() {
  ipcMain.removeHandler(CHANNEL_BACKUP_CONFIG);
  ipcMain.removeHandler(CHANNEL_BACKUP_OPEN_DIR);
  ipcMain.removeHandler(CHANNEL_BACKUP_SELECT_RESTORE);

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
}
