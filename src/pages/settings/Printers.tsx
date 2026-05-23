import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
};

type PrinterRecord = {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  printer_type: 'thermal' | 'label' | 'a4' | 'kitchen' | 'receipt';
  connection_type: 'local' | 'network' | 'usb' | 'windows';
  target: string;
  is_default: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
};

type PrinterForm = {
  branch_id: string;
  code: string;
  name: string;
  printer_type: PrinterRecord['printer_type'];
  connection_type: PrinterRecord['connection_type'];
  target: string;
  is_default: boolean;
  is_active: boolean;
};

const initialForm: PrinterForm = {
  branch_id: '',
  code: '',
  name: '',
  printer_type: 'receipt',
  connection_type: 'network',
  target: '',
  is_default: false,
  is_active: true,
};

export default function PrintersSettingsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<PrinterRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [selected, setSelected] = useState<PrinterRecord | null>(null);
  const [form, setForm] = useState<PrinterForm>(initialForm);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.target.toLowerCase().includes(q)
    );
  }, [items, search]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((branch) => map.set(branch.id, `${branch.code} - ${branch.name}`));
    return map;
  }, [branches]);

  const load = async () => {
    setLoading(true);
    try {
      const [printers, branchList] = await Promise.all([
        httpClient.get<PrinterRecord[]>(`/printers?includeInactive=${includeInactive ? 'true' : 'false'}`),
        httpClient.get<BranchRecord[]>('/auth/branches'),
      ]);
      setItems(printers);
      setBranches(branchList);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل الطابعات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [includeInactive]);

  const startCreate = () => {
    setSelected(null);
    setForm(initialForm);
  };

  const startEdit = (printer: PrinterRecord) => {
    setSelected(printer);
    setForm({
      branch_id: printer.branch_id ?? '',
      code: printer.code,
      name: printer.name,
      printer_type: printer.printer_type,
      connection_type: printer.connection_type,
      target: printer.target,
      is_default: printer.is_default,
      is_active: printer.is_active,
    });
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.target.trim()) {
      showToast('الكود، الاسم، والهدف مطلوبة', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        branch_id: form.branch_id || null,
      };
      if (selected) {
        await httpClient.put<PrinterRecord>(`/printers/${selected.id}`, payload);
        showToast('تم تحديث الطابعة', 'success');
      } else {
        await httpClient.post<PrinterRecord>('/printers', payload);
        showToast('تمت إضافة الطابعة', 'success');
      }
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ الطابعة', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/printers/${selected.id}`);
      showToast('تم تعطيل الطابعة', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل الطابعة', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async (printer: PrinterRecord) => {
    if (!window.printer?.print) {
      showToast('IPC للطباعة غير متاح في بيئة المتصفح', 'info');
      return;
    }
    setTestingPrinterId(printer.id);
    try {
      const result = await window.printer.print({
        documentType: 'receipt_voucher',
        printerTarget: printer.target,
        copies: 1,
        payloadType: 'text',
        payloadRef: 'TEST_PRINT',
        content: `Printer test for ${printer.name}`,
      });
      showToast(result.message || 'تم إرسال اختبار الطباعة', result.queued ? 'success' : 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'فشل اختبار الطباعة', 'error');
    } finally {
      setTestingPrinterId(null);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة الطابعات</div>
      <div className="flex gap-2 mb-3">
        <input className="form-input" placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          تضمين المعطلة
        </label>
        <button className="toolbar-btn primary" onClick={startCreate}>+ طابعة جديدة</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>

      <table className="data-grid">
        <thead>
          <tr>
            <th>الكود</th>
            <th>الاسم</th>
            <th>الفرع</th>
            <th>النوع</th>
            <th>الاتصال</th>
            <th>الهدف</th>
            <th>افتراضي</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((item) => (
            <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => startEdit(item)}>
              <td>{item.code}</td>
              <td>{item.name}</td>
              <td>{item.branch_id ? branchNameById.get(item.branch_id) ?? item.branch_id : 'عام الشركة'}</td>
              <td>{item.printer_type}</td>
              <td>{item.connection_type}</td>
              <td>{item.target}</td>
              <td>{item.is_default ? 'نعم' : 'لا'}</td>
              <td>{item.is_active ? 'نشط' : 'معلق'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-4 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">الكود</label>
          <input className="form-input w-full" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الاسم</label>
          <input className="form-input w-full" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الفرع</label>
          <select className="form-select w-full" value={form.branch_id} onChange={(e) => setForm((p) => ({ ...p, branch_id: e.target.value }))}>
            <option value="">عام الشركة</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} - {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">النوع</label>
          <select className="form-select w-full" value={form.printer_type} onChange={(e) => setForm((p) => ({ ...p, printer_type: e.target.value as PrinterRecord['printer_type'] }))}>
            <option value="receipt">receipt</option>
            <option value="thermal">thermal</option>
            <option value="label">label</option>
            <option value="a4">a4</option>
            <option value="kitchen">kitchen</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">الاتصال</label>
          <select className="form-select w-full" value={form.connection_type} onChange={(e) => setForm((p) => ({ ...p, connection_type: e.target.value as PrinterRecord['connection_type'] }))}>
            <option value="local">local</option>
            <option value="network">network</option>
            <option value="usb">usb</option>
            <option value="windows">windows</option>
          </select>
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">الهدف (الاسم/عنوان IP/Queue)</label>
          <input className="form-input w-full" value={form.target} onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
          طابعة افتراضية للنطاق
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
          الطابعة نشطة
        </label>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
          {selected ? 'حفظ التعديل' : 'إضافة طابعة'}
        </button>
        {selected && (
          <>
            <button className="toolbar-btn" onClick={() => void testPrint(selected)} disabled={testingPrinterId === selected.id}>
              {testingPrinterId === selected.id ? 'جاري الاختبار...' : 'اختبار'}
            </button>
            <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>تعطيل</button>
          </>
        )}
      </div>
    </div>
  );
}
