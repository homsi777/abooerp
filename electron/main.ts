import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  copyFileSync,
} from 'node:fs';
import { app, BrowserWindow, shell } from 'electron';
import { clearStoredSession, loadRuntimeConfig, registerRuntimeConfigIpc, resolveMachineId } from './ipc/runtimeConfig.js';
import { registerFilesystemIpc } from './ipc/filesystem.js';
import { probePrinterRuntimeReadiness, registerPrinterIpc } from './ipc/printer.js';
import { registerBackupIpc } from './ipc/backup.js';
import { appendRuntimeLog, registerDiagnosticsIpc } from './ipc/diagnostics.js';
import { registerSystemSettingsIpc } from './ipc/systemSettings.js';
import { registerPdfIpc } from './ipc/pdf.js';
import { registerCsvIpc } from './ipc/csv.js';
import { createMainWindow } from './windows/createMainWindow.js';
import { createSplashWindow, setSplashStatus } from './windows/createSplashWindow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isSmokeMode = process.argv.includes('--smoke-runtime');

if (!app.isPackaged) {
  app.setName('شركة عبو المحمود لنقل والخدمات الوجستية Dev');
  app.setPath('userData', path.join(app.getPath('appData'), 'شركة عبو المحمود لنقل والخدمات الوجستية Dev'));
  // Vite HMR needs unsafe-eval; keeps devtools console free of the generic CSP warning.
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

if (app.isPackaged) {
  app.commandLine.appendSwitch('js-flags', '--disallow-code-generation-from-strings');
}

function resolveRendererEntry() {
  const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5188';
  const prodFile = path.resolve(__dirname, '..', 'dist', 'index.html');
  return app.isPackaged ? { mode: 'file' as const, value: prodFile } : { mode: 'url' as const, value: devUrl };
}

function registerIpc() {
  registerRuntimeConfigIpc();
  registerFilesystemIpc();
  registerPrinterIpc();
  registerBackupIpc();
  registerDiagnosticsIpc();
  registerSystemSettingsIpc();
  registerPdfIpc();
  registerCsvIpc();
}

async function runStartupHandshake() {
  try {
    const runtime = await loadRuntimeConfig();
    const machineId = await resolveMachineId();
    const response = await fetch(`${runtime.apiBaseUrl.replace(/\/api\/v1$/, '')}/api/v1/system/desktop-handshake`, {
      headers: {
        'x-electron-runtime': '1',
        'x-runtime-mode': runtime.runtimeMode,
        'x-runtime-version': process.versions.electron,
        'x-device-id': machineId,
      },
    });
    const payload = await response.json().catch(() => null);
    appendRuntimeLog(response.ok ? 'info' : 'warn', 'startup_handshake', {
      ok: response.ok,
      status: response.status,
      payload,
    });
    return response.ok;
  } catch (error) {
    appendRuntimeLog('error', 'startup_handshake_failed', {
      reason: (error as Error)?.message || 'unknown',
    });
    return false;
  }
}

async function runElectronRuntimeSmoke() {
  registerIpc();
  const handshakeOk = await runStartupHandshake();
  const preloadText = await (await import('node:fs/promises')).readFile(path.resolve(__dirname, 'preload.js'), 'utf-8');
  const checks = {
    hasPrinterRuntime: preloadText.includes("exposeInMainWorld('printerRuntime'"),
    hasBackupRuntime: preloadText.includes("exposeInMainWorld('backupRuntime'"),
    hasDiagnosticsRuntime: preloadText.includes("exposeInMainWorld('diagnosticsRuntime'"),
    hasSystemSettingsRuntime: preloadText.includes("exposeInMainWorld('systemSettingsRuntime'"),
    handshakeOk,
    printerReady: false,
  };
  try {
    const probe = await Promise.race([
      probePrinterRuntimeReadiness(),
      new Promise<{ callable: false; available: false; message: string }>((resolve) =>
        setTimeout(() => resolve({ callable: false, available: false, message: 'timeout' }), 4000)
      ),
    ]);
    checks.printerReady = probe.callable === true;
  } catch {
    checks.printerReady = false;
  }

  const passed =
    checks?.hasPrinterRuntime &&
    checks?.hasBackupRuntime &&
    checks?.hasDiagnosticsRuntime &&
    checks?.hasSystemSettingsRuntime &&
    checks?.handshakeOk &&
    checks?.printerReady;

  appendRuntimeLog(passed ? 'info' : 'error', 'electron_runtime_smoke', checks);
  console.info('[ELECTRON RUNTIME SMOKE]', checks);
  app.exit(passed ? 0 : 1);
}

/** Spawns the bundled Express server when running as a packaged Electron app. */
function spawnBundledServer(): void {
  // Use the CJS wrapper for reliable ESM loading on Windows via utilityProcess
  const serverWrapper  = path.join(process.resourcesPath, 'server-wrapper.cjs');
  const migrationsDir  = path.join(process.resourcesPath, 'migrations');
  const userDataDir    = app.getPath('userData');
  const userEnvFile    = path.join(userDataDir, 'server.env');
  // app-config.env is copied from server/.env at build time (preserves installer credentials)
  const bundledEnvFile = path.join(process.resourcesPath, 'app-config.env');
  const fallbackEnvText = [
    'NODE_ENV=production',
    'PGHOST=127.0.0.1',
    'PGPORT=5432',
    'PGDATABASE=almiya_hsahin',
    'PGUSER=postgres',
    'PGPASSWORD=12345678',
    'PGSSL_ENABLED=false',
    'PGSSL_REJECT_UNAUTHORIZED=true',
    'ALLOW_DB_SEED=true',
    'LOCK_SERVER_PORT=1',
    'SERVER_HOST=0.0.0.0',
    'SERVER_PORT=4010',
    'AUTH_ACCESS_TOKEN_TTL=15m',
    'AUTH_REFRESH_TOKEN_TTL_DAYS=7',
    'AUTH_STRICT_RBAC=true',
    'DASHBOARD_CACHE_TTL_MS=15000',
    'DASHBOARD_CACHE_RESET_ENABLED=true',
    'DASHBOARD_CACHE_RESET_REQUIRE_CONFIRM=false',
    '',
  ].join('\n');

  // Packaged runtime must always read config from userData/server.env.
  // On first run we copy bundled app-config.env there; if both are missing we generate safe defaults.
  const ensureUserEnvFile = () => {
    try {
      mkdirSync(userDataDir, { recursive: true });
      if (!existsSync(userEnvFile)) {
        if (existsSync(bundledEnvFile)) {
          copyFileSync(bundledEnvFile, userEnvFile);
          appendRuntimeLog('info', 'server_env_bootstrapped_from_bundle', { userEnvFile });
        } else {
          writeFileSync(userEnvFile, fallbackEnvText, 'utf-8');
          appendRuntimeLog('warn', 'server_env_generated_fallback', { userEnvFile });
        }
      }
    } catch (error) {
      appendRuntimeLog('error', 'server_env_bootstrap_failed', {
        reason: (error as Error)?.message || 'unknown',
      });
    }
  };
  ensureUserEnvFile();
  const envFilePath = userEnvFile;

  // Generate a stable JWT secret per installation (stored in userData)
  const secretFile = path.join(userDataDir, '.jwt_secret');
  let jwtSecret: string;
  try {
    mkdirSync(userDataDir, { recursive: true });
    if (existsSync(secretFile)) {
      jwtSecret = readFileSync(secretFile, 'utf-8').trim();
    } else {
      jwtSecret = randomBytes(48).toString('hex');
      writeFileSync(secretFile, jwtSecret, 'utf-8');
    }
  } catch {
    jwtSecret = randomBytes(48).toString('hex');
  }

  // Server log file for debugging crashes
  const serverLogFile = path.join(userDataDir, 'server-process.log');
  const logLine = (line: string) => {
    try { appendFileSync(serverLogFile, `${new Date().toISOString()} ${line}\n`); } catch {}
    appendRuntimeLog('info', 'server_process', { line });
  };

  const serverEnv: Record<string, string> = {
    NODE_ENV: 'production',
    ELECTRON_PACKAGED: '1',
    SERVER_HOST: '0.0.0.0',
    SERVER_PORT: '4010',
    LOCK_SERVER_PORT: '1',
    AUTH_JWT_SECRET: jwtSecret,
    AUTH_ACCESS_TOKEN_TTL: '15m',
    AUTH_REFRESH_TOKEN_TTL_DAYS: '7',
    MIGRATIONS_DIR: migrationsDir,
    SERVER_ENV_FILE: envFilePath,
    APPDATA: userDataDir,
  };

  appendRuntimeLog('info', 'spawning_bundled_server', { serverWrapper, migrationsDir, envFilePath });
  logLine(`[start] wrapper=${serverWrapper} env=${envFilePath}`);

  try {
    // ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave exactly like Node.js
    // (full networking/socket access — avoids utilityProcess Winsock restrictions)
    const child = spawn(process.execPath, [serverWrapper], {
      env: { ...serverEnv, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });

    child.stdout?.on('data', (data: Buffer) => {
      logLine('[stdout] ' + data.toString().trim());
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      logLine('[stderr] ' + msg);
      appendRuntimeLog('warn', 'server_stderr', { msg });
    });

    child.on('exit', (code, signal) => {
      logLine(`[exit] code=${code} signal=${signal}`);
      appendRuntimeLog('error', 'server_exited', { code, signal });
    });

    child.on('error', (err) => {
      logLine(`[spawn_error] ${err.message}`);
    });
  } catch (err) {
    logLine(`[fork_error] ${String(err)}`);
    appendRuntimeLog('error', 'server_fork_failed', { err: String(err) });
  }
}

/** TCP-level port check — much faster and more reliable than HTTP fetch on Windows. */
function isPortOpen(port: number, host: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); done(true); });
    sock.once('error',   () => { clearTimeout(timer); done(false); });
    sock.once('timeout', () => done(false));
    sock.setTimeout(timeoutMs);
    sock.connect(port, host);
  });
}

/** يُنشأ عند اختيار «رئيسي» في شاشة التثبيت — بدونه لا يُشغّل التطبيق المغلف خادماً محلياً (لتجنّب PostgreSQL على الفرعي). */
const LOCAL_PACKAGED_SERVER_FLAG = '.erp-spawn-local-api';

function getLocalPackagedServerFlagPath(): string {
  return path.join(app.getPath('userData'), LOCAL_PACKAGED_SERVER_FLAG);
}

/** ترحيل: منشآت قديمة لديها server.env فقط — نعتبرها رئيسية وتُفعّل التشغيل المحلي. */
function migrateLocalPackagedServerFlagFromLegacyEnv(): void {
  try {
    const userData = app.getPath('userData');
    const flag = path.join(userData, LOCAL_PACKAGED_SERVER_FLAG);
    const env = path.join(userData, 'server.env');
    const runtimePath = path.join(userData, 'runtime.json');
    if (!existsSync(env) || existsSync(flag)) return;

    // لا نُفعّل الخادم المحلي تلقائياً إذا كان المستخدم قد ضبط وضع LAN (فرعي).
    if (existsSync(runtimePath)) {
      try {
        const raw = readFileSync(runtimePath, 'utf-8');
        if (raw.includes('manual_lan') || raw.includes('auto_lan')) {
          return;
        }
      } catch {
        /* ignore */
      }
    }

    writeFileSync(flag, `migrated:${new Date().toISOString()}\n`, 'utf-8');
    appendRuntimeLog('info', 'migrated_local_packaged_server_flag', {});
  } catch {
    /* ignore */
  }
}

/** Polls port 4010 until open or max 15 s.  Never throws — always returns. */
async function waitForServer(splash: BrowserWindow): Promise<void> {
  const maxAttempts = 15;
  appendRuntimeLog('info', 'waiting_for_server', { port: 4010, maxAttempts });

  // Give splash HTML time to paint before we update its text
  await new Promise<void>(r => setTimeout(r, 600));
  setSplashStatus(splash, 'جاري تشغيل الخادم...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const open = await isPortOpen(4010, '127.0.0.1');
      if (open) {
        appendRuntimeLog('info', 'server_port_open', { attempt: i + 1 });
        setSplashStatus(splash, 'الخادم جاهز — جاري فتح التطبيق...');
        await new Promise<void>(r => setTimeout(r, 400));
        return;
      }
    } catch {/* ignore */}

    if (i === 3)  setSplashStatus(splash, 'جاري الاتصال بقاعدة البيانات...');
    if (i === 8)  setSplashStatus(splash, 'جاري تهيئة الجداول...');
    if (i === 12) setSplashStatus(splash, 'يستغرق أطول من المعتاد...');

    await new Promise<void>(r => setTimeout(r, 1000));
  }

  appendRuntimeLog('warn', 'server_wait_timeout');
  setSplashStatus(splash, 'فتح التطبيق...');
  await new Promise<void>(r => setTimeout(r, 500));
}

/** عند وضع LAN: انتظار استجابة /api/health على الخادم البعيد (لا يُشغّل خادماً محلياً). */
async function waitForRemoteHealth(splash: BrowserWindow, healthUrl: string): Promise<void> {
  const maxAttempts = 20;
  appendRuntimeLog('info', 'waiting_for_remote_health', { healthUrl, maxAttempts });
  await new Promise<void>(r => setTimeout(r, 500));
  setSplashStatus(splash, 'جاري الاتصال بالخادم الرئيسي...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        appendRuntimeLog('info', 'remote_health_ok', { attempt: i + 1 });
        setSplashStatus(splash, 'الاتصال جاهز — جاري فتح التطبيق...');
        await new Promise<void>(r => setTimeout(r, 400));
        return;
      }
    } catch {/* ignore */}

    if (i === 4) setSplashStatus(splash, 'تحقق من IP الرئيسي والشبكة...');
    if (i === 12) setSplashStatus(splash, 'لا يزال الاتصال غير متاح...');

    await new Promise<void>(r => setTimeout(r, 1000));
  }

  appendRuntimeLog('warn', 'remote_health_wait_timeout', { healthUrl });
  setSplashStatus(splash, 'فتح التطبيق...');
  await new Promise<void>(r => setTimeout(r, 500));
}

async function bootstrapDesktopRuntime() {
  registerIpc();

  // Show splash IMMEDIATELY — user sees feedback within milliseconds
  const splash = createSplashWindow();

  // رئيسي: خادم مضمّن بعد وضع العلامة (.erp-spawn-local-api). فرعي (LAN): لا خادم محلي.
  if (app.isPackaged) {
    migrateLocalPackagedServerFlagFromLegacyEnv();
    try {
      const cfg = await loadRuntimeConfig();
      const lanClient =
        cfg.backendResolutionMode === 'manual_lan' || cfg.backendResolutionMode === 'auto_lan';
      const allowLocalSpawn = existsSync(getLocalPackagedServerFlagPath());

      if (lanClient) {
        const api = String(cfg.apiBaseUrl || 'http://127.0.0.1:4010/api/v1').replace(/\/+$/, '');
        const healthUrl = api.endsWith('/api/v1') ? api.replace(/\/api\/v1$/, '/api/health') : `${api}/api/health`;
        appendRuntimeLog('info', 'packaged_lan_client_skip_local_server', {
          apiBaseUrl: cfg.apiBaseUrl,
          healthUrl,
        });
        try {
          await waitForRemoteHealth(splash, healthUrl);
        } catch (e) {
          appendRuntimeLog('error', 'wait_remote_health_error', { e: String(e) });
        }
      } else if (allowLocalSpawn) {
        try {
          spawnBundledServer();
        } catch (e) {
          appendRuntimeLog('error', 'spawn_error', { e: String(e) });
        }
        try {
          await waitForServer(splash);
        } catch (e) {
          appendRuntimeLog('error', 'wait_server_error', { e: String(e) });
        }
      } else {
        appendRuntimeLog('info', 'packaged_skip_local_server_until_primary_choice');
        setSplashStatus(splash, 'اختر نوع الجهاز من الشاشة التالية...');
        await new Promise<void>(r => setTimeout(r, 700));
      }
    } catch (e) {
      appendRuntimeLog('error', 'bootstrap_config_error', { e: String(e) });
      if (existsSync(getLocalPackagedServerFlagPath())) {
        try {
          spawnBundledServer();
        } catch (se) {
          appendRuntimeLog('error', 'spawn_error_fallback', { e: String(se) });
        }
        try {
          await waitForServer(splash);
        } catch (we) {
          appendRuntimeLog('error', 'wait_server_error_fallback', { e: String(we) });
        }
      } else {
        setSplashStatus(splash, 'فتح التطبيق...');
        await new Promise<void>(r => setTimeout(r, 500));
      }
    }
  }

  try { await runStartupHandshake(); } catch {/* non-fatal */}

  const mainWindow = createMainWindow();

  // One-time show helper — idempotent so multiple triggers are safe
  let windowShown = false;
  const showMainWindow = () => {
    if (windowShown || mainWindow.isDestroyed()) return;
    windowShown = true;
    clearTimeout(showFallbackTimer);
    if (!splash.isDestroyed()) splash.destroy();
    mainWindow.show();
    console.info('[Electron] main_window_ready');
    appendRuntimeLog('info', 'main_window_ready');
  };

  // Layer 1 — ideal: fired by Chromium when first frame is painted
  mainWindow.once('ready-to-show', showMainWindow);

  // Layer 2 — fallback: page finished loading but ready-to-show was missed
  mainWindow.webContents.once('did-finish-load', () => setTimeout(showMainWindow, 150));

  // Layer 3 — hard timeout: splash cannot stay forever
  const showFallbackTimer = setTimeout(() => {
    console.warn('[Electron] show-timeout fallback triggered (8 s)');
    appendRuntimeLog('warn', 'main_window_force_shown');
    showMainWindow();
  }, 8000);

  mainWindow.on('closed', () => {
    clearTimeout(showFallbackTimer);
    if (!splash.isDestroyed()) splash.destroy();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendRuntimeLog('error', 'renderer_crashed', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    if (!mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          void mainWindow.reload();
        }
      }, 800);
    }
  });

  // Security requirement: wipe any persisted session token on every app start.
  // This guarantees the login screen is always shown, regardless of previous sessions.
  await clearStoredSession();
  appendRuntimeLog('info', 'desktop_bootstrap_started', { sessionCleared: true });
  console.info('[Electron] Stored session cleared — login screen will be shown.');

  const entry = resolveRendererEntry();
  if (entry.mode === 'url') {
    // Dev: BrowserRouter URL — navigate to /login
    const loginUrl = `${entry.value.replace(/\/$/, '')}/login`;
    void mainWindow.loadURL(loginUrl);
  } else {
    // Prod: HashRouter — loadFile with hash '/login' → renders as #/login
    void mainWindow.loadFile(entry.value, { hash: '/login' });
  }
}

const instanceLock = isSmokeMode ? true : app.requestSingleInstanceLock();
if (!instanceLock) {
  app.exit(1);
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(async () => {
    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-navigate', (event, navigationUrl) => {
        const isLocal =
          navigationUrl.startsWith('file://') ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(navigationUrl);
        if (!isLocal) {
          event.preventDefault();
          void shell.openExternal(navigationUrl);
        }
      });
    });

    if (isSmokeMode) {
      await runElectronRuntimeSmoke();
      return;
    }

    await bootstrapDesktopRuntime();

    app.on('activate', async () => {
      if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
        await bootstrapDesktopRuntime();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
