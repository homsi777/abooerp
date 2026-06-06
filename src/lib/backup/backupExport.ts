import { getAccessToken } from '../../context/authStorage';
import { getResolvedApiBaseUrl, httpClient } from '../api/httpClient';

export type BackupExportRecord = {
  id: string;
  backup_code: string;
  file_name: string;
  file_path?: string;
  is_stub: boolean;
  size_bytes: number;
};

function isLocalApiBase(apiBase: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(apiBase);
}

function defaultBackupFileName(code?: string): string {
  if (code) return `${code}.dump`;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `BKP-${stamp}.dump`;
}

/** Ask user where to save (Electron save dialog). Returns null if cancelled. */
export async function pickBackupSavePath(suggestedName?: string): Promise<string | null> {
  const runtime = window.backupRuntime;
  if (!runtime?.selectSavePath) return null;
  const picked = await runtime.selectSavePath({
    defaultFileName: defaultBackupFileName(suggestedName),
  });
  if (!picked.selected || !picked.filePath) return null;
  return picked.filePath;
}

async function downloadBackupBlob(backupId: string): Promise<Blob> {
  const base = await getResolvedApiBaseUrl();
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/backups/${backupId}/download`, { headers });
  if (!response.ok) {
    let message = `تعذر تحميل النسخة (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return response.blob();
}

/** Copy or download server backup file to user-selected path (Electron) or browser download. */
export async function saveBackupRecordToUser(
  record: BackupExportRecord,
  destPath: string | null,
): Promise<{ mode: 'electron-path' | 'browser-download'; path?: string }> {
  if (record.is_stub) {
    throw new Error('هذه النسخة وهمية (stub) — pg_dump غير متوفر. ثبّت PostgreSQL أو أعد المحاولة بعد التحديث.');
  }

  const apiBase = await getResolvedApiBaseUrl();
  const runtime = window.backupRuntime;

  if (destPath && runtime?.copyFile && record.file_path && isLocalApiBase(apiBase)) {
    const result = await runtime.copyFile({ sourcePath: record.file_path, destPath });
    if (!result.success) throw new Error(result.message || 'تعذر نسخ ملف النسخة الاحتياطية.');
    return { mode: 'electron-path', path: destPath };
  }

  if (destPath && runtime?.downloadToPath) {
    const token = getAccessToken();
    const result = await runtime.downloadToPath({
      destPath,
      downloadUrl: `${apiBase}/backups/${record.id}/download`,
      authToken: token,
    });
    if (!result.success) throw new Error(result.message || 'تعذر حفظ النسخة في المسار المحدد.');
    return { mode: 'electron-path', path: destPath };
  }

  const blob = await downloadBackupBlob(record.id);
  const fileName = destPath ? destPath.split(/[/\\]/).pop() || record.file_name : record.file_name;

  if (destPath && runtime?.writeFile) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
    const dataBase64 = btoa(binary);
    const result = await runtime.writeFile({ destPath, dataBase64 });
    if (!result.success) throw new Error(result.message || 'تعذر كتابة ملف النسخة.');
    return { mode: 'electron-path', path: destPath };
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { mode: 'browser-download' };
}

export async function createBackupAndSave(options?: {
  notes?: string;
  destPath?: string | null;
  askSaveLocation?: boolean;
}): Promise<BackupExportRecord> {
  let destPath = options?.destPath ?? null;
  if (options?.askSaveLocation !== false && window.backupRuntime?.selectSavePath) {
    destPath = await pickBackupSavePath();
    if (!destPath) {
      throw new Error('BACKUP_SAVE_CANCELLED');
    }
  }

  const record = await httpClient.post<BackupExportRecord>('/backups', {
    backupType: 'manual',
    scope: 'company',
    notes: options?.notes ?? 'نسخة احتياطية يدوية',
  });

  if (destPath || !window.backupRuntime?.selectSavePath) {
    await saveBackupRecordToUser(record, destPath);
  }

  return record;
}
