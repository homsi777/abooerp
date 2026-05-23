import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
const CHANNEL_PDF_EXPORT = 'pdf:export';
const exportPdfSchema = z.object({
    title: z.string().min(1),
    html: z.string().min(1),
    defaultFileName: z.string().min(1),
    landscape: z.boolean().optional().default(true),
});
function resolveHostWindow() {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
async function generatePdfBuffer(html, landscape) {
    const host = resolveHostWindow();
    const parent = host ?? undefined;
    const pdfWindow = new BrowserWindow({
        show: false,
        parent,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });
    try {
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        await pdfWindow.loadURL(url);
        await pdfWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready : true');
        const buffer = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            landscape,
            pageSize: 'A4',
        });
        return buffer;
    }
    finally {
        if (!pdfWindow.isDestroyed()) {
            pdfWindow.close();
        }
    }
}
export function registerPdfIpc() {
    ipcMain.removeHandler(CHANNEL_PDF_EXPORT);
    ipcMain.handle(CHANNEL_PDF_EXPORT, async (_event, rawPayload) => {
        const payload = exportPdfSchema.parse(rawPayload);
        const host = resolveHostWindow();
        if (!host) {
            return { saved: false, filePath: null, message: 'No active Electron window.' };
        }
        const picked = await dialog.showSaveDialog(host, {
            title: payload.title,
            defaultPath: path.join(path.resolve(process.env.USERPROFILE || process.cwd(), 'Downloads'), payload.defaultFileName.endsWith('.pdf') ? payload.defaultFileName : `${payload.defaultFileName}.pdf`),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (picked.canceled || !picked.filePath) {
            return { saved: false, filePath: null, message: 'cancelled' };
        }
        const buffer = await generatePdfBuffer(payload.html, payload.landscape);
        await fs.writeFile(picked.filePath, buffer);
        return { saved: true, filePath: picked.filePath, message: 'saved' };
    });
}
