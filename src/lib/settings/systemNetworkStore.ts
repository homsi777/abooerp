export type NetworkMode = 'local_only' | 'lan_branch' | 'cloud_ready' | 'hybrid_ready';
export type ConnectionType = 'internal_lan' | 'vpn' | 'internet';
export type EndpointStatus = 'good' | 'warning' | 'disconnected' | 'incomplete';

export interface ServiceEndpoint {
  id: string;
  name: string;
  address: string;
  status: EndpointStatus;
  notes: string;
}

export interface EndpointTestRecord {
  id: string;
  endpointId: string;
  endpointName: string;
  testedAt: string;
  result: 'success' | 'warning' | 'failed';
  responseTimeMs: number;
  tester: string;
  notes?: string;
}

export interface SyncPreferences {
  enableSyncWhenOnline: boolean;
  autoRetryFailedSync: boolean;
  syncIntervalMinutes: number;
  notifyOnConnectionLoss: boolean;
  preferLocalCache: boolean;
  preferRemoteSync: boolean;
}

export interface DiagnosticsState {
  databaseConnection: EndpointStatus;
  localStorageStatus: EndpointStatus;
  printerReadiness: EndpointStatus;
  exchangeRatesAvailability: EndpointStatus;
  branchConfigCompleteness: EndpointStatus;
  lastConnectivityResult: EndpointStatus;
}

export interface SystemNetworkSettings {
  systemName: string;
  environmentLabel: 'تجريبي' | 'إنتاجي' | 'اختبار';
  defaultBranchCode: string;
  workstationName: string;
  operationModeLabel: string;
  networkMode: NetworkMode;
  connectionType: ConnectionType;
  networkStatus: 'متصل' | 'متذبذب' | 'غير متصل';
  defaultBranch: string;
  branchEndpointLabel: string;
  branchConnectionType: 'LAN' | 'VPN' | 'Cloud Tunnel';
  remoteBranchEnabled: boolean;
  remoteAgentConnectivityEnabled: boolean;
  serviceEndpoints: ServiceEndpoint[];
  endpointTestLogs: EndpointTestRecord[];
  syncPreferences: SyncPreferences;
  diagnostics: DiagnosticsState;
  lastConnectivityTestAt: string;
  currentSystemModeCard: string;
  linkedBranchesCount: number;
}

export const SYSTEM_NETWORK_STORAGE_KEY = 'settings-system-network';

export const defaultSystemNetworkSettings: SystemNetworkSettings = {
  systemName: 'لوحة التحكم — نظام شحن',
  environmentLabel: 'تجريبي',
  defaultBranchCode: 'BR-001',
  workstationName: 'WS-DAM-01',
  operationModeLabel: 'تشغيل محلي',
  networkMode: 'local_only',
  connectionType: 'internal_lan',
  networkStatus: 'متصل',
  defaultBranch: 'الفرع الرئيسي - دمشق',
  branchEndpointLabel: 'بوابة الفرع — دمشق',
  branchConnectionType: 'LAN',
  remoteBranchEnabled: true,
  remoteAgentConnectivityEnabled: true,
  serviceEndpoints: [
    {
      id: 'api',
      name: 'واجهة البرنامج',
      address: 'http://localhost:5000/api',
      status: 'warning',
      notes: 'ربط مبدئي بالخادم',
    },
    {
      id: 'printer',
      name: 'الطابعة',
      address: 'tcp://192.168.1.50:9100',
      status: 'good',
      notes: 'جاهزة للطباعة على الشبكة',
    },
    {
      id: 'label',
      name: 'الملصقات والباركود',
      address: 'http://localhost:5050/label',
      status: 'incomplete',
      notes: 'بانتظار الربط',
    },
    {
      id: 'sync',
      name: 'خدمة المزامنة',
      address: 'http://localhost:5100/sync',
      status: 'warning',
      notes: 'قائمة إعادة المحاولة مفعّلة',
    },
    {
      id: 'backup',
      name: 'النسخ الاحتياطي',
      address: 'file://local-backups',
      status: 'good',
      notes: 'قناة نسخ محلية',
    },
  ],
  endpointTestLogs: [
    {
      id: 'ep-log-001',
      endpointId: 'printer',
      endpointName: 'الطابعة',
      testedAt: '2026-04-22 11:10',
      result: 'success',
      responseTimeMs: 84,
      tester: 'مسؤول',
      notes: 'قناة تي سي بي تستجيب',
    },
    {
      id: 'ep-log-002',
      endpointId: 'api',
      endpointName: 'واجهة البرنامج',
      testedAt: '2026-04-22 11:08',
      result: 'warning',
      responseTimeMs: 320,
      tester: 'مسؤول',
      notes: 'الاستجابة بطيئة',
    },
    {
      id: 'ep-log-003',
      endpointId: 'label',
      endpointName: 'الملصقات والباركود',
      testedAt: '2026-04-22 11:05',
      result: 'failed',
      responseTimeMs: 0,
      tester: 'نظام',
      notes: 'نقطة غير مكتملة',
    },
  ],
  syncPreferences: {
    enableSyncWhenOnline: true,
    autoRetryFailedSync: true,
    syncIntervalMinutes: 15,
    notifyOnConnectionLoss: true,
    preferLocalCache: true,
    preferRemoteSync: false,
  },
  diagnostics: {
    databaseConnection: 'warning',
    localStorageStatus: 'good',
    printerReadiness: 'good',
    exchangeRatesAvailability: 'good',
    branchConfigCompleteness: 'warning',
    lastConnectivityResult: 'good',
  },
  lastConnectivityTestAt: '2026-04-22 11:20',
  currentSystemModeCard: 'محلي',
  linkedBranchesCount: 3,
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getSystemNetworkSettings(): SystemNetworkSettings {
  const saved = readJson(SYSTEM_NETWORK_STORAGE_KEY, defaultSystemNetworkSettings);
  return {
    ...defaultSystemNetworkSettings,
    ...saved,
    serviceEndpoints: saved.serviceEndpoints || defaultSystemNetworkSettings.serviceEndpoints,
    endpointTestLogs: saved.endpointTestLogs || defaultSystemNetworkSettings.endpointTestLogs,
    syncPreferences: { ...defaultSystemNetworkSettings.syncPreferences, ...(saved.syncPreferences || {}) },
    diagnostics: { ...defaultSystemNetworkSettings.diagnostics, ...(saved.diagnostics || {}) },
  };
}

export function saveSystemNetworkSettings(value: SystemNetworkSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SYSTEM_NETWORK_STORAGE_KEY, JSON.stringify(value));
}

export function resetSystemNetworkSettings(): SystemNetworkSettings {
  return getSystemNetworkSettings();
}

export function restoreDefaultSystemNetworkSettings(): SystemNetworkSettings {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SYSTEM_NETWORK_STORAGE_KEY, JSON.stringify(defaultSystemNetworkSettings));
  }
  return { ...defaultSystemNetworkSettings };
}
