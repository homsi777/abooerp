import { useState } from 'react';
import { useToast } from '../../components/Toast';

export default function BackupRestoreSettings() {
  const { showToast } = useToast();
  const [lastBackupAt, setLastBackupAt] = useState('2026-04-19 18:40');

  const handleCreateBackup = () => {
    setLastBackupAt(new Date().toLocaleString('ar-SY'));
    showToast('تم إنشاء نسخة احتياطية (محاكاة)', 'success');
  };

  const handleRestore = () => {
    showToast('تمت الاستعادة (محاكاة)', 'info');
  };

  return (
    <div className="card">
      <div className="card-header">النسخ الاحتياطي والاستعادة</div>
      <div className="space-y-3">
        <div className="text-sm">
          <span className="font-semibold">آخر نسخة احتياطية:</span> {lastBackupAt}
        </div>
        <div className="flex gap-2">
          <button className="toolbar-btn primary" onClick={handleCreateBackup}>إنشاء نسخة احتياطية</button>
          <button className="toolbar-btn" onClick={handleRestore}>استعادة نسخة احتياطية</button>
        </div>
      </div>
    </div>
  );
}
