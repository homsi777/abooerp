import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
const CHANNEL_PRINTER_LIST = 'printer:list';
const CHANNEL_PRINTER_PRINT = 'printer:print';
const CHANNEL_PRINTER_GET_DEFAULT = 'printer:get-default';
const printPayloadSchema = z.object({
    documentType: z.string().min(1),
    printerTarget: z.string().min(1),
    copies: z.number().int().min(1).max(10).default(1),
    payloadType: z.enum(['raw', 'html', 'text']).default('text'),
    payloadRef: z.string().min(1).optional(),
    content: z.string().optional(),
});
function resolveWindow() {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
async function listSystemPrinters() {
    const activeWindow = resolveWindow();
    if (!activeWindow) {
        return { available: false, printers: [], message: 'No active Electron window for printer enumeration.' };
    }
    if (typeof activeWindow.webContents.getPrintersAsync !== 'function') {
        return { available: false, printers: [], message: 'Electron runtime does not expose getPrintersAsync.' };
    }
    const printers = await activeWindow.webContents.getPrintersAsync();
    return {
        available: true,
        printers: printers.map((printer) => ({
            // Electron printer descriptors vary across OS/runtime versions.
            // Read optional fields defensively to keep IPC stable.
            ...(() => {
                const info = printer;
                return {
                    name: printer.name,
                    displayName: printer.displayName ?? printer.name,
                    isDefault: Boolean(info.isDefault ?? info.default ?? false),
                    status: info.status,
                    options: printer.options ?? {},
                };
            })(),
        })),
        message: 'Printer list resolved from local runtime.',
    };
}
export async function probePrinterRuntimeReadiness() {
    const result = await listSystemPrinters();
    return {
        callable: true,
        available: result.available,
        message: result.message,
    };
}
function executePrint(webContents, payload) {
    return new Promise((resolve) => {
        webContents.print({
            silent: true,
            printBackground: true,
            deviceName: payload.printerTarget,
            copies: payload.copies,
        }, (success, failureReason) => {
            resolve({ success, errorType: failureReason || undefined });
        });
    });
}
async function loadPrintableHtml(html, parent) {
    const printWindow = new BrowserWindow({
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
        await printWindow.loadURL(url);
        await printWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()');
        return printWindow;
    }
    catch (error) {
        if (!printWindow.isDestroyed()) {
            printWindow.close();
        }
        throw error;
    }
}
function wrapTextAsHtml(content) {
    const escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Tahoma,Arial,sans-serif;white-space:pre-wrap;margin:12mm;}</style></head><body>${escaped}</body></html>`;
}
async function printPayloadContent(payload, host) {
    if (payload.payloadType === 'html' || payload.payloadType === 'text') {
        const html = payload.payloadType === 'html'
            ? String(payload.content ?? '').trim()
            : wrapTextAsHtml(String(payload.content ?? payload.payloadRef ?? '').trim());
        if (!html) {
            return { success: false, errorType: 'empty_content' };
        }
        const printWindow = await loadPrintableHtml(html, host);
        try {
            return await executePrint(printWindow.webContents, payload);
        }
        finally {
            if (!printWindow.isDestroyed()) {
                printWindow.close();
            }
        }
    }
    return executePrint(host.webContents, payload);
}
export function registerPrinterIpc() {
    ipcMain.removeHandler(CHANNEL_PRINTER_LIST);
    ipcMain.removeHandler(CHANNEL_PRINTER_PRINT);
    ipcMain.removeHandler(CHANNEL_PRINTER_GET_DEFAULT);
    ipcMain.handle(CHANNEL_PRINTER_LIST, async () => {
        return listSystemPrinters();
    });
    ipcMain.handle(CHANNEL_PRINTER_GET_DEFAULT, async () => {
        const listing = await listSystemPrinters();
        if (!listing.available) {
            return { available: false, printer: null, message: listing.message };
        }
        const defaultPrinter = listing.printers.find((printer) => printer.isDefault) ?? null;
        return {
            available: true,
            printer: defaultPrinter,
            message: defaultPrinter ? 'Default printer resolved.' : 'No default printer reported by OS.',
        };
    });
    ipcMain.handle(CHANNEL_PRINTER_PRINT, async (_event, rawPayload) => {
        const payload = printPayloadSchema.parse(rawPayload);
        const activeWindow = resolveWindow();
        if (!activeWindow) {
            return {
                queued: false,
                message: 'No active Electron window. Print request kept as controlled stub.',
            };
        }
        if (payload.payloadType === 'raw') {
            return {
                queued: false,
                message: 'RAW payload execution is not enabled yet. Request shape accepted for future engine.',
            };
        }
        const result = await printPayloadContent(payload, activeWindow);
        if (!result.success) {
            return {
                queued: false,
                message: `فشلت الطباعة (${result.errorType ?? 'خطأ غير معروف'}).`,
            };
        }
        return {
            queued: true,
            message: `Print request sent to '${payload.printerTarget}' for '${payload.documentType}'.`,
        };
    });
}
