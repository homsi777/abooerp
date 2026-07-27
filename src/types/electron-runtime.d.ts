export {};

declare global {
  interface Window {
    runtime: {
      getEnv: () => Promise<'development' | 'production'>;
      getVersion: () => Promise<string>;
      getConfig: () => Promise<{
        apiBaseUrl: string;
        centralSyncApiBaseUrl?: string;
        environment: 'development' | 'production';
        runtimeMode: 'development' | 'local_production' | 'lan_node';
        backendResolutionMode: 'localhost' | 'manual_lan' | 'auto_lan';
        manualLanHost?: string;
        backendPort: number;
        schemaVersion: string;
        deviceName: string;
        featureFlags: Record<string, boolean>;
      }>;
      getSessionStatus: () => Promise<{
        authenticated: boolean;
        user?: unknown;
        activeBranchId?: string | null;
      }>;
      setSessionToken: (token: string | null) => Promise<{ success: boolean }>;
      getActiveBranch: () => Promise<string | null>;
      setActiveBranch: (branchId: string | null) => Promise<{ success: boolean }>;
      getMachineId: () => Promise<string>;
      getLanAddresses: () => Promise<string[]>;
      getServerMode: () => Promise<string>;
      testLanServer: (ip: string, port: number) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
    diagnosticsRuntime: {
      healthCheck: () => Promise<{
        ok: boolean;
        target: string;
        status: number;
        latencyMs: number;
        offline: boolean;
        runtimeMode: 'development' | 'local_production' | 'lan_node';
      }>;
      getLogs: () => Promise<
        Array<{
          at: string;
          level: 'info' | 'warn' | 'error';
          message: string;
          metadata?: Record<string, unknown>;
        }>
      >;
      getVersionMeta: () => Promise<{
        appVersion: string;
        runtimeVersion: string;
        schemaVersion: string;
        nodeVersion: string;
        chromeVersion: string;
      }>;
      appendLog: (payload: { level?: 'info' | 'warn' | 'error'; message: string; metadata?: Record<string, unknown> }) => Promise<{ success: boolean }>;
    };
    systemSettingsRuntime: {
      list: (payload?: { authToken?: string; branchId?: string | null }) => Promise<Record<string, unknown>>;
      get: (payload: { key: string; authToken?: string; branchId?: string | null }) => Promise<unknown>;
      set: (payload: { key: string; value: unknown; authToken: string; branchId?: string | null }) => Promise<unknown>;
    };
    printerRuntime: {
      list: () => Promise<{
        available: boolean;
        printers: Array<{
          name: string;
          displayName: string;
          isDefault: boolean;
          status?: number;
          options?: Record<string, unknown>;
        }>;
        message: string;
      }>;
      getDefault: () => Promise<{
        available: boolean;
        printer: {
          name: string;
          displayName: string;
          isDefault: boolean;
          status?: number;
          options?: Record<string, unknown>;
        } | null;
        message: string;
      }>;
      print: (payload: {
        documentType: string;
        printerTarget: string;
        copies: number;
        payloadType: 'raw' | 'html' | 'text';
        payloadRef?: string;
        content?: string;
      }) => Promise<{ queued: boolean; message: string }>;
    };
    pdfRuntime: {
      exportPdf: (payload: {
        title: string;
        html: string;
        defaultFileName: string;
        landscape?: boolean;
      }) => Promise<{ saved: boolean; filePath: string | null; message: string }>;
    };
    csvRuntime: {
      exportCsv: (payload: {
        title: string;
        csv: string;
        defaultFileName: string;
      }) => Promise<{ saved: boolean; filePath: string | null; message: string }>;
    };
    fs: {
      readConfig: () => Promise<{
        apiBaseUrl: string;
        centralSyncApiBaseUrl?: string;
        environment: 'development' | 'production';
        runtimeMode: 'development' | 'local_production' | 'lan_node';
        backendResolutionMode: 'localhost' | 'manual_lan' | 'auto_lan';
        manualLanHost?: string;
        backendPort: number;
        schemaVersion: string;
        deviceName: string;
        featureFlags: Record<string, boolean>;
      }>;
      writeConfig: (payload: {
        backendResolutionMode?: 'localhost' | 'manual_lan' | 'auto_lan';
        manualLanHost?: string;
        backendPort?: number;
        featureFlags?: Record<string, boolean>;
      }) => Promise<{
        apiBaseUrl: string;
        centralSyncApiBaseUrl?: string;
        environment: 'development' | 'production';
        runtimeMode: 'development' | 'local_production' | 'lan_node';
        backendResolutionMode: 'localhost' | 'manual_lan' | 'auto_lan';
        manualLanHost?: string;
        backendPort: number;
        schemaVersion: string;
        deviceName: string;
        featureFlags: Record<string, boolean>;
      }>;
      enableLocalPackagedServer: () => Promise<{ success: boolean }>;
    };
    printer: Window['printerRuntime'];
    backupRuntime: {
      getConfig: () => Promise<{
        available: boolean;
        backupDirectory: string;
        platform: string;
      }>;
      openDirectory: () => Promise<{
        success: boolean;
        message: string;
        backupDirectory: string;
      }>;
      selectRestoreFile: () => Promise<{
        selected: boolean;
        filePath: string | null;
      }>;
      selectSavePath: (payload?: { defaultFileName?: string }) => Promise<{
        selected: boolean;
        filePath: string | null;
      }>;
      copyFile: (payload: { sourcePath: string; destPath: string }) => Promise<{
        success: boolean;
        message: string;
        destPath?: string;
      }>;
      downloadToPath: (payload: {
        downloadUrl: string;
        destPath: string;
        authToken?: string | null;
      }) => Promise<{
        success: boolean;
        message: string;
        destPath?: string;
      }>;
      writeFile: (payload: { destPath: string; dataBase64: string }) => Promise<{
        success: boolean;
        message: string;
        destPath?: string;
      }>;
    };
    desktopSetupRuntime: {
      getStatus: () => Promise<{ configured: boolean; database: string }>;
      configurePostgres: (password: string) => Promise<{ success: boolean; database?: string; error?: string }>;
      listCentralBranches: () => Promise<{ success: boolean; error?: string; branches: Array<{ id: string; code: string; name: string }> }>;
      activateSync: (payload: { username: string; password: string; branchId: string }) => Promise<{ success: boolean; error?: string; deviceId?: string }>;
    };
  }
}
