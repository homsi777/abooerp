import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
const CHANNEL_CSV_EXPORT = 'csv:export';
const exportCsvSchema = z.object({
    title: z.string().min(1),
    csv: z.string().min(1),
    defaultFileName: z.string().min(1),
});
function resolveHostWindow() {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
export function registerCsvIpc() {
    ipcMain.removeHandler(CHANNEL_CSV_EXPORT);
    ipcMain.handle(CHANNEL_CSV_EXPORT, async (_event, rawPayload) => {
        const payload = exportCsvSchema.parse(rawPayload);
        const host = resolveHostWindow();
        if (!host) {
            return { saved: false, filePath: null, message: 'No active Electron window.' };
        }
        const picked = await dialog.showSaveDialog(host, {
            title: payload.title,
            defaultPath: path.join(path.resolve(process.env.USERPROFILE || process.cwd(), 'Downloads'), payload.defaultFileName.endsWith('.csv') ? payload.defaultFileName : `${payload.defaultFileName}.csv`),
            filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (picked.canceled || !picked.filePath) {
            return { saved: false, filePath: null, message: 'cancelled' };
        }
        await fs.writeFile(picked.filePath, payload.csv, 'utf-8');
        return { saved: true, filePath: picked.filePath, message: 'saved' };
    });
}
