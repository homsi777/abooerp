import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type BackupRecord = {
  id: string;
  backup_code: string;
  backup_type: 'manual' | 'scheduled' | 'before_update';
  scope: string;
  status: 'creating' | 'ready' | 'verifying' | 'failed' | 'restoring' | 'restored';
  file_name: string;
  size_bytes: number;
  is_stub: boolean;
  error_message: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

type BackupPolicy = {
  autoEnabled: boolean;
  intervalHours: number;
  retentionDays: number;
  verifyAfterCreate: boolean;
};

type BackupDiagnostics = {
  latestBackupAt: string | null;
  latestBackupStatus: string;
  latestBackupCode: string | null;
  backupDirectory: string;
  pgDumpAvailable: boolean;
  retentionDays: number;
  autoEnabled: boolean;
  restoreReadiness?: {
    ready: boolean;
    blockers: Array<{ code: string; message: string }>;
  };
};

type RestoreReadiness = {
  ready: boolean;
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
};

const defaultPolicy: BackupPolicy = {
  autoEnabled: true,
  intervalHours: 24,
  retentionDays: 30,
  verifyAfterCreate: true,
};

const backupTypeAr: Record<BackupRecord['backup_type'], string> = {
  manual: 'يدوي',
  scheduled: 'مجدول',
  before_update: 'قبل التحديث',
};

const backupStatusAr: Record<BackupRecord['status'], string> = {
  creating: 'قيد الإنشاء',
  ready: 'جاهز',
  verifying: 'قيد التحقق',
  failed: 'فشل',
  restoring: 'قيد الاستعادة',
  restored: 'مستعاد',
};

function scopeAr(scope: string): string {
  const map: Record<string, string> = { company: 'الشركة', branch: 'فرع' };
  return map[scope] ?? scope;
}

export default function BackupsSettingsPage() {
  const { showToast } = useToast();
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [policy, setPolicy] = useState<BackupPolicy>(defaultPolicy);
  const [diagnostics, setDiagnostics] = useState<BackupDiagnostics | null>(null);
  const [runtimeDirectory, setRuntimeDirectory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [restoreConfirmCode, setRestoreConfirmCode] = useState('');
  const [restoreExecutionToken, setRestoreExecutionToken] = useState('');
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [selectedRestoreReadiness, setSelectedRestoreReadiness] = useState<RestoreReadiness | null>(null);

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (record) =>
        record.backup_code.toLowerCase().includes(q) ||
        record.scope.toLowerCase().includes(q) ||
        record.file_name.toLowerCase().includes(q)
    );
  }, [records, searchTerm]);

  const load = async () => {
    try {
      const [backupRows, backupPolicy, backupDiagnostics] = await Promise.all([
        httpClient.get<BackupRecord[]>('/backups?includeFailed=true'),
        httpClient.get<BackupPolicy>('/backup-policy'),
        httpClient.get<BackupDiagnostics>('/backup/diagnostics'),
      ]);
      setRecords(backupRows);
      setPolicy(backupPolicy);
      setDiagnostics(backupDiagnostics);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل إعدادات النسخ الاحتياطي', 'error');
    }
  };

  useEffect(() => {
    void load();
    window.backupRuntime
      ?.getConfig()
      .then((cfg) => setRuntimeDirectory(cfg.backupDirectory))
      .catch(() => setRuntimeDirectory(null));
  }, []);

  const createBackup = async () => {
    setCreatingBackup(true);
    try {
      await httpClient.post('/backups', {
        backupType: 'manual',
        scope: 'company',
        notes: 'من لوحة إعدادات النسخ الاحتياطي',
      });
      showToast('تم إنشاء نسخة احتياطية جديدة', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر إنشاء النسخة الاحتياطية', 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const savePolicy = async () => {
    setSavingPolicy(true);
    try {
      const updated = await httpClient.put<BackupPolicy>('/backup-policy', policy);
      setPolicy(updated);
      showToast('تم حفظ سياسة النسخ الاحتياطي', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ سياسة النسخ الاحتياطي', 'error');
    } finally {
      setSavingPolicy(false);
    }
  };

  const verifyBackup = async (backupId: string) => {
    setWorkingId(backupId);
    try {
      await httpClient.post(`/backups/${backupId}/verify`, {});
      showToast('تم التحقق من سلامة النسخة', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'فشل التحقق من النسخة', 'error');
    } finally {
      setWorkingId(null);
    }
  };

  const restoreBackup = async (backupId: string, dryRun: boolean) => {
    setWorkingId(backupId);
    try {
      await httpClient.post(`/backups/${backupId}/restore`, {
        confirmBackupCode: restoreConfirmCode,
        dryRun,
        executionToken: dryRun ? undefined : restoreExecutionToken || undefined,
      });
      showToast(dryRun ? 'تم فحص الاستعادة بنجاح (تجريبي دون تطبيق)' : 'تم تنفيذ الاستعادة بنجاح', 'success');
      setRestoreConfirmCode('');
      setRestoreExecutionToken('');
      setSelectedBackupId(null);
      setSelectedRestoreReadiness(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذرت عملية الاستعادة', 'error');
    } finally {
      setWorkingId(null);
    }
  };

  const loadRestoreReadiness = async (backupId: string) => {
    try {
      const data = await httpClient.get<RestoreReadiness>(`/backups/${backupId}/restore-readiness`);
      setSelectedRestoreReadiness(data);
    } catch {
      setSelectedRestoreReadiness(null);
    }
  };

  const issueExecutionToken = async (backupId: string) => {
    try {
      const data = await httpClient.post<{ token: string; expiresAt: string }>(`/backups/${backupId}/restore-token`, {});
      setRestoreExecutionToken(data.token);
      showToast(`صدر رمز التنفيذ (ينتهي في ${data.expiresAt})`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر إصدار رمز التنفيذ', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">سياسة النسخ الاحتياطي</div>
        <div className="grid grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={policy.autoEnabled} onChange={(e) => setPolicy((p) => ({ ...p, autoEnabled: e.target.checked }))} />
            نسخ تلقائي
          </label>
          <div className="form-group">
            <label className="form-label">الفترة (ساعات)</label>
            <input type="number" min={1} max={168} className="form-input w-full" value={policy.intervalHours} onChange={(e) => setPolicy((p) => ({ ...p, intervalHours: Number(e.target.value) || 24 }))} />
          </div>
          <div className="form-group">
            <label className="form-label">مدة الاحتفاظ (أيام)</label>
            <input type="number" min={1} max={365} className="form-input w-full" value={policy.retentionDays} onChange={(e) => setPolicy((p) => ({ ...p, retentionDays: Number(e.target.value) || 30 }))} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={policy.verifyAfterCreate} onChange={(e) => setPolicy((p) => ({ ...p, verifyAfterCreate: e.target.checked }))} />
            تحقق بعد الإنشاء
          </label>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="toolbar-btn primary" onClick={() => void createBackup()} disabled={creatingBackup}>
            {creatingBackup ? 'جاري الإنشاء...' : 'إنشاء نسخة الآن'}
          </button>
          <button className="toolbar-btn" onClick={() => void savePolicy()} disabled={savingPolicy}>
            حفظ السياسة
          </button>
          <button
            className="toolbar-btn"
            onClick={() =>
              window.backupRuntime
                ?.openDirectory()
                .then((result) => showToast(result.message, result.success ? 'success' : 'error'))
                .catch(() => showToast('تعذر فتح مجلد النسخ في هذا التشغيل', 'info'))
            }
          >
            فتح مجلد النسخ
          </button>
          <button className="toolbar-btn" onClick={() => void load()}>تحديث</button>
        </div>
      </div>

      {diagnostics && (
        <div className="card text-sm">
          <div className="card-header">مؤشرات النسخ الاحتياطي</div>
          <div>آخر نسخة: {diagnostics.latestBackupCode ?? '-'} ({diagnostics.latestBackupStatus})</div>
          <div>وقت آخر نسخة: {diagnostics.latestBackupAt ?? '-'}</div>
          <div>مجلد النسخ: {diagnostics.backupDirectory}</div>
          <div>أداة pg_dump: {diagnostics.pgDumpAvailable ? 'متوفرة' : 'غير متوفرة (وضع بديل)'}</div>
          <div>مجلد تشغيل التطبيق: {runtimeDirectory ?? '-'}</div>
        </div>
      )}

      <div className="card">
        <div className="card-header">سجلات النسخ</div>
        <div className="mb-3">
          <input className="form-input w-full" placeholder="بحث بالرمز أو الملف أو النطاق" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <table className="data-grid">
          <thead>
            <tr>
              <th>الرمز</th>
              <th>النوع</th>
              <th>النطاق</th>
              <th>الحالة</th>
              <th>الحجم (ميغابايت)</th>
              <th>بديل</th>
              <th>تاريخ الإنشاء</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record) => (
              <tr key={record.id}>
                <td>{record.backup_code}</td>
                <td>{backupTypeAr[record.backup_type]}</td>
                <td>{scopeAr(record.scope)}</td>
                <td>{backupStatusAr[record.status]}</td>
                <td>{(record.size_bytes / (1024 * 1024)).toFixed(2)}</td>
                <td>{record.is_stub ? 'نعم' : 'لا'}</td>
                <td>{record.created_at}</td>
                <td>
                  <div className="flex gap-1">
                    <button className="toolbar-btn" onClick={() => void verifyBackup(record.id)} disabled={workingId === record.id}>تحقق</button>
                    <button
                      className="toolbar-btn"
                      onClick={() => {
                        setSelectedBackupId(record.id);
                        setRestoreExecutionToken('');
                        void loadRestoreReadiness(record.id);
                      }}
                    >
                      استعادة
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-500">لا توجد سجلات نسخ.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedBackupId && (
        <div className="card">
          <div className="card-header">التحقق قبل الاستعادة</div>
          <div className="text-sm mb-2">أدخل رمز النسخة لتأكيد عملية الاستعادة:</div>
          <input className="form-input w-full mb-3" value={restoreConfirmCode} onChange={(e) => setRestoreConfirmCode(e.target.value)} placeholder="مثال: BKP-..." />
          {selectedRestoreReadiness && (
            <div className="text-sm mb-3">
              <div>جاهزية الاستعادة: {selectedRestoreReadiness.ready ? 'جاهز' : 'موقوف'}</div>
              {!selectedRestoreReadiness.ready && (
                <ul className="text-red-700">
                  {selectedRestoreReadiness.blockers.map((blocker) => (
                    <li key={blocker.code}>- {blocker.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <input
            className="form-input w-full mb-3"
            value={restoreExecutionToken}
            onChange={(e) => setRestoreExecutionToken(e.target.value)}
            placeholder="رمز التنفيذ (للاستعادة الفعلية)"
          />
          <div className="flex gap-2">
            <button className="toolbar-btn" onClick={() => void restoreBackup(selectedBackupId, true)} disabled={workingId === selectedBackupId}>فحص استعادة (تجريبي)</button>
            <button className="toolbar-btn" onClick={() => void issueExecutionToken(selectedBackupId)} disabled={workingId === selectedBackupId}>إصدار رمز التنفيذ</button>
            <button className="toolbar-btn primary" onClick={() => void restoreBackup(selectedBackupId, false)} disabled={workingId === selectedBackupId}>تنفيذ الاستعادة</button>
            <button className="toolbar-btn" onClick={() => { setSelectedBackupId(null); setRestoreConfirmCode(''); setRestoreExecutionToken(''); setSelectedRestoreReadiness(null); }}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}
