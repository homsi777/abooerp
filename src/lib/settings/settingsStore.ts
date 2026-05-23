import { DEFAULT_TERMINOLOGY } from './terminologyCatalog';

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  logoDataUrl: string;
}

export type PrinterPaperSize = 'A4' | '80mm' | 'label';
export type PrinterConnectionType = 'network' | 'usb' | 'virtual';
export type PrinterHealthStatus = 'online' | 'offline' | 'warning';
export type PrintTaskId =
  | 'shipment_label'
  | 'shipment_invoice'
  | 'manifest'
  | 'receipt_voucher'
  | 'payment_voucher'
  | 'reports'
  | 'daily_journal';

export interface PrinterDevice {
  id: string;
  name: string;
  model: string;
  connection: PrinterConnectionType;
  paperSize: PrinterPaperSize;
  location: string;
  ipAddress?: string;
  status: PrinterHealthStatus;
  lastTestAt?: string;
  notes?: string;
}

export interface TaskPrinterRule {
  taskId: PrintTaskId;
  taskLabel: string;
  printerId: string;
  paperSize: PrinterPaperSize;
  copies: number;
  autoPrint: boolean;
}

export interface PrinterSettings {
  printHeader: string;
  printers: PrinterDevice[];
  taskRules: TaskPrinterRule[];
}

export interface TerminologySettings {
  [key: string]: string;
}

export interface BranchItem {
  id: number;
  code: string;
  name: string;
  city: string;
  status: 'نشط' | 'معلق';
}

export interface AgentItem {
  id: number;
  code: string;
  name: string;
  governorate: string;
  status: 'نشط' | 'معلق';
}

export interface RolePermission {
  role: string;
  reports: boolean;
  vouchers: boolean;
  settings: boolean;
  users: boolean;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action: string;
  module: string;
  user: string;
}

export type BackupType = 'manual' | 'scheduled' | 'before_update';
export type BackupStatus = 'ready' | 'restored' | 'failed' | 'verifying';

export interface BackupRecord {
  id: string;
  createdAt: string;
  type: BackupType;
  scope: string;
  sizeMb: number;
  status: BackupStatus;
  createdBy: string;
  notes?: string;
}

export interface BackupPolicySettings {
  autoBackupEnabled: boolean;
  autoBackupIntervalHours: number;
  retentionDays: number;
  verifyAfterBackup: boolean;
}

export const COMPANY_STORAGE_KEY = 'settings-company';
export const PRINTER_STORAGE_KEY = 'settings-printer';
export const TERMINOLOGY_STORAGE_KEY = 'settings-terminology';
export const BACKUP_TIME_STORAGE_KEY = 'settings-last-backup';
export const BACKUP_RECORDS_STORAGE_KEY = 'settings-backup-records';
export const BACKUP_POLICY_STORAGE_KEY = 'settings-backup-policy';

export const defaultCompanyInfo: CompanyInfo = {
  name: 'شركة شحن',
  address: 'دمشق - باب مصلى',
  phone: '011-1234567',
  logoDataUrl: '',
};

export const defaultPrinterSettings: PrinterSettings = {
  printHeader: 'شركة شحن - إدارة العمليات',
  printers: [
    {
      id: 'printer-main-a4',
      name: 'Main Office A4',
      model: 'HP LaserJet Pro',
      connection: 'network',
      paperSize: 'A4',
      location: 'الإدارة الرئيسية',
      ipAddress: '192.168.1.50',
      status: 'online',
      lastTestAt: '2026-04-22 09:15',
    },
    {
      id: 'printer-thermal-80',
      name: 'Counter Thermal 80mm',
      model: 'Epson TM-T20',
      connection: 'usb',
      paperSize: '80mm',
      location: 'كاونتر السندات',
      status: 'online',
      lastTestAt: '2026-04-22 08:40',
    },
    {
      id: 'printer-label-zebra',
      name: 'Zebra Label Printer',
      model: 'Zebra ZD220',
      connection: 'network',
      paperSize: 'label',
      location: 'مستودع التحزيم',
      ipAddress: '192.168.1.61',
      status: 'warning',
      lastTestAt: '2026-04-21 19:20',
      notes: 'يحتاج تنظيف رأس الطباعة أسبوعيًا',
    },
  ],
  taskRules: [
    { taskId: 'shipment_label', taskLabel: 'طباعة لصاقة الشحنة', printerId: 'printer-label-zebra', paperSize: 'label', copies: 1, autoPrint: true },
    { taskId: 'shipment_invoice', taskLabel: 'فاتورة الشحنة', printerId: 'printer-main-a4', paperSize: 'A4', copies: 1, autoPrint: false },
    { taskId: 'manifest', taskLabel: 'Manifest التحميل', printerId: 'printer-main-a4', paperSize: 'A4', copies: 1, autoPrint: false },
    { taskId: 'receipt_voucher', taskLabel: 'سند قبض', printerId: 'printer-thermal-80', paperSize: '80mm', copies: 2, autoPrint: false },
    { taskId: 'payment_voucher', taskLabel: 'سند دفع', printerId: 'printer-thermal-80', paperSize: '80mm', copies: 2, autoPrint: false },
    { taskId: 'reports', taskLabel: 'التقارير', printerId: 'printer-main-a4', paperSize: 'A4', copies: 1, autoPrint: false },
    { taskId: 'daily_journal', taskLabel: 'دفتر اليومية', printerId: 'printer-main-a4', paperSize: 'A4', copies: 1, autoPrint: false },
  ],
};

export const defaultTerminology: TerminologySettings = { ...DEFAULT_TERMINOLOGY };

export const defaultBackupRecords: BackupRecord[] = [
  {
    id: 'bkp-20260422-01',
    createdAt: '2026-04-22 09:40',
    type: 'manual',
    scope: 'كامل النظام',
    sizeMb: 42.7,
    status: 'ready',
    createdBy: 'admin',
    notes: 'نسخة ما قبل إغلاق اليومية',
  },
  {
    id: 'bkp-20260421-01',
    createdAt: '2026-04-21 23:00',
    type: 'scheduled',
    scope: 'البيانات التشغيلية + المالية',
    sizeMb: 41.9,
    status: 'ready',
    createdBy: 'system',
  },
  {
    id: 'bkp-20260420-01',
    createdAt: '2026-04-20 22:00',
    type: 'before_update',
    scope: 'بيانات الإعدادات',
    sizeMb: 8.3,
    status: 'restored',
    createdBy: 'admin',
    notes: 'تمت الاستعادة لاختبار مرحلة QA',
  },
];

export const defaultBackupPolicy: BackupPolicySettings = {
  autoBackupEnabled: true,
  autoBackupIntervalHours: 24,
  retentionDays: 30,
  verifyAfterBackup: true,
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

export function getCompanyInfo(): CompanyInfo {
  return readJson(COMPANY_STORAGE_KEY, defaultCompanyInfo);
}

export function saveCompanyInfo(value: CompanyInfo): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPANY_STORAGE_KEY, JSON.stringify(value));
}

export function getPrinterSettings(): PrinterSettings {
  const saved = readJson(PRINTER_STORAGE_KEY, defaultPrinterSettings) as Partial<PrinterSettings> & {
    defaultPrinter?: string;
    copies?: string;
    paperSize?: PrinterPaperSize;
  };

  const hasModernShape = Array.isArray(saved.printers) && Array.isArray(saved.taskRules);
  if (hasModernShape) {
    return {
      ...defaultPrinterSettings,
      ...saved,
      printers: saved.printers && saved.printers.length > 0 ? saved.printers : defaultPrinterSettings.printers,
      taskRules: saved.taskRules && saved.taskRules.length > 0 ? saved.taskRules : defaultPrinterSettings.taskRules,
    };
  }

  const fallbackPrinterId = defaultPrinterSettings.printers[0].id;
  const migratedPrinterName = saved.defaultPrinter || defaultPrinterSettings.printers[0].name;
  const migratedPaperSize = saved.paperSize || 'A4';

  const migrated: PrinterSettings = {
    printHeader: saved.printHeader || defaultPrinterSettings.printHeader,
    printers: [
      ...defaultPrinterSettings.printers.map((printer, idx) =>
        idx === 0 ? { ...printer, name: migratedPrinterName, paperSize: migratedPaperSize } : printer
      ),
    ],
    taskRules: defaultPrinterSettings.taskRules.map((rule) =>
      rule.taskId === 'reports' || rule.taskId === 'daily_journal'
        ? {
            ...rule,
            printerId: fallbackPrinterId,
            copies: Number(saved.copies || rule.copies),
            paperSize: migratedPaperSize,
          }
        : rule
    ),
  };
  return migrated;
}

export function savePrinterSettings(value: PrinterSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(value));
}

export function getTerminologySettings(): TerminologySettings {
  const saved = readJson(TERMINOLOGY_STORAGE_KEY, defaultTerminology);
  return { ...defaultTerminology, ...saved };
}

export function saveTerminologySettings(value: TerminologySettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TERMINOLOGY_STORAGE_KEY, JSON.stringify(value));
}

export function getLastBackupTime(): string {
  const records = getBackupRecords();
  if (records.length > 0) return records[0].createdAt;
  if (typeof window === 'undefined') return '2026-04-19 18:40';
  return window.localStorage.getItem(BACKUP_TIME_STORAGE_KEY) || '2026-04-19 18:40';
}

export function saveLastBackupTime(value: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKUP_TIME_STORAGE_KEY, value);
}

export function getBackupRecords(): BackupRecord[] {
  const records = readJson(BACKUP_RECORDS_STORAGE_KEY, defaultBackupRecords);
  return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveBackupRecords(records: BackupRecord[]): void {
  if (typeof window === 'undefined') return;
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  window.localStorage.setItem(BACKUP_RECORDS_STORAGE_KEY, JSON.stringify(sorted));
  if (sorted[0]) saveLastBackupTime(sorted[0].createdAt);
}

export function getBackupPolicySettings(): BackupPolicySettings {
  return readJson(BACKUP_POLICY_STORAGE_KEY, defaultBackupPolicy);
}

export function saveBackupPolicySettings(policy: BackupPolicySettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKUP_POLICY_STORAGE_KEY, JSON.stringify(policy));
}
