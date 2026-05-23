import { useState, useEffect } from 'react';
import type { JournalEntry, JournalLine } from '../types';
import { useToast } from '../components/Toast';

export default function JournalEntry() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<JournalEntry>>({
    entryNo: '', date: new Date().toISOString().split('T')[0], description: '', debits: [], credits: [], posted: false
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      setEntries((prev) => prev);
    } finally { setLoading(false); }
  };

  const handleNew = () => {
    setSelectedEntry(null);
    setFormData({
      entryNo: '', date: new Date().toISOString().split('T')[0], description: '',
      debits: [{ accountId: 1, accountName: 'الصندوق', debit: 0, credit: 0 }],
      credits: [{ accountId: 2, accountName: 'ذمم العملاء', debit: 0, credit: 0 }],
      posted: false
    });
    setIsEditing(true);
  };

  const handleEdit = (entry: JournalEntry) => {
    setSelectedEntry(entry);
    setFormData(entry);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      const entry: JournalEntry = {
        id: Date.now(),
        entryNo: formData.entryNo || `JE-${Date.now()}`,
        date: formData.date || new Date().toISOString().split('T')[0],
        description: formData.description || '',
        debits: (formData.debits || []) as JournalLine[],
        credits: (formData.credits || []) as JournalLine[],
        posted: Boolean(formData.posted),
        createdBy: 'local',
      };
      setEntries((prev) => [entry, ...prev]);
      showToast('تم حفظ القيد بنجاح', 'success');
      setIsEditing(false);
    } catch { showToast('حدث خطأ', 'error'); }
  };

  const totalDebits = formData.debits?.reduce((sum, d) => sum + (d.debit || 0), 0) || 0;
  const totalCredits = formData.credits?.reduce((sum, c) => sum + (c.credit || 0), 0) || 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">القيود المحاسبية</h2>
        <button onClick={loadData} className="toolbar-btn">تحميل</button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
          </div>
          <table className="data-grid">
            <thead>
              <tr>
                <th>رقم القيد</th>
                <th>التاريخ</th>
                <th>الوصف</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>مرحّل</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className={selectedEntry?.id === e.id ? 'selected' : ''} onClick={() => handleEdit(e)}>
                  <td>{e.entryNo}</td>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td className="text-left">{e.debits.reduce((s, d) => s + d.debit, 0).toLocaleString()}</td>
                  <td className="text-left">{e.credits.reduce((s, c) => s + c.credit, 0).toLocaleString()}</td>
                  <td><span className={`status-badge ${e.posted ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{e.posted ? 'مرحّل' : 'غير مرحّل'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-[500px] card overflow-auto">
            <div className="card-header">{selectedEntry ? 'تعديل قيد' : ' قيد جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">التاريخ</label>
                <input type="date" className="form-input w-full" value={formData.date || ''} onChange={(e) => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">الوصف</label>
                <input type="text" className="form-input w-full" value={formData.description || ''} onChange={(e) => setFormData({...formData, description: e.target.value})} />
              </div>
              
              <div className="form-group">
                <label className="form-label">مدين (Debit)</label>
                <table className="data-grid text-sm">
                  <thead>
                    <tr><th>الحساب</th><th>المبلغ</th></tr>
                  </thead>
                  <tbody>
                    {formData.debits?.map((d, i) => (
                      <tr key={i}>
                        <td><input type="text" className="form-input w-full" value={d.accountName} onChange={(e) => {
                          const newDebits = [...(formData.debits || [])];
                          newDebits[i].accountName = e.target.value;
                          setFormData({...formData, debits: newDebits});
                        }} /></td>
                        <td><input type="number" className="form-input w-full text-left" value={d.debit || 0} onChange={(e) => {
                          const newDebits = [...(formData.debits || [])];
                          newDebits[i].debit = Number(e.target.value);
                          setFormData({...formData, debits: newDebits});
                        }} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>المجموع</td><td className="text-left font-bold">{totalDebits.toLocaleString()}</td></tr>
                  </tfoot>
                </table>
              </div>

              <div className="form-group">
                <label className="form-label">دائن (Credit)</label>
                <table className="data-grid text-sm">
                  <thead>
                    <tr><th>الحساب</th><th>المبلغ</th></tr>
                  </thead>
                  <tbody>
                    {formData.credits?.map((c, i) => (
                      <tr key={i}>
                        <td><input type="text" className="form-input w-full" value={c.accountName} onChange={(e) => {
                          const newCredits = [...(formData.credits || [])];
                          newCredits[i].accountName = e.target.value;
                          setFormData({...formData, credits: newCredits});
                        }} /></td>
                        <td><input type="number" className="form-input w-full text-left" value={c.credit || 0} onChange={(e) => {
                          const newCredits = [...(formData.credits || [])];
                          newCredits[i].credit = Number(e.target.value);
                          setFormData({...formData, credits: newCredits});
                        }} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>المجموع</td><td className="text-left font-bold">{totalCredits.toLocaleString()}</td></tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1" disabled={totalDebits !== totalCredits}>حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
