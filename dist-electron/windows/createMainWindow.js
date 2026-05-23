import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export function createMainWindow() {
    const preloadPath = app.isPackaged
        ? path.resolve(__dirname, '..', 'preload.cjs')
        : path.resolve(process.cwd(), 'electron', 'preload.cjs');
    const mainWindow = new BrowserWindow({
        width: 1366,
        height: 840,
        minWidth: 1100,
        minHeight: 700,
        show: false,
        backgroundColor: '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            devTools: !app.isPackaged,
            spellcheck: false,
            preload: preloadPath,
        },
    });
    // Prevent unknown popups and open them externally.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });
    return mainWindow;
}
