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
        const info = printer as any;
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

function executePrint(activeWindow: BrowserWindow, payload: z.infer<typeof printPayloadSchema>) {
  return new Promise<{ success: boolean; errorType?: string }>((resolve) => {
    activeWindow.webContents.print(
      {
        silent: true,
        printBackground: true,
        deviceName: payload.printerTarget,
        copies: payload.copies,
      },
      (success, failureReason) => {
        resolve({ success, errorType: failureReason || undefined });
      }
    );
  });
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

  ipcMain.handle(CHANNEL_PRINTER_PRINT, async (_event, rawPayload: unknown) => {
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

    const result = await executePrint(activeWindow, payload);
    if (!result.success) {
      return {
        queued: false,
        message: `OS print dispatch failed (${result.errorType ?? 'unknown error'}).`,
      };
    }

    return {
      queued: true,
      message: `Print request sent to '${payload.printerTarget}' for '${payload.documentType}'.`,
    };
  });
}
