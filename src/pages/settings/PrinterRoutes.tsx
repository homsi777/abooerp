import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';
import { printDocumentViaResolvedRoute, resolvePrinterRoute } from '../../lib/api/printerBridge';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
};

type PrinterRecord = {
  id: string;
  code: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
};

type PrinterRouteRecord = {
  id: string;
  company_id: string;
  branch_id: string | null;
  document_type:
    | 'receipt_voucher'
    | 'payment_voucher'
    | 'shipment_label'
    | 'shipment_receipt'
    | 'manifest'
    | 'delivery_note'
    | 'a4_report'
    | 'kitchen_ticket';
  printer_id: string;
  copies: number;
  is_default: boolean;
  is_active: boolean;
};

type ResolvedRoute = PrinterRouteRecord & {
  printer_name: string;
  printer_code: string;
  target: string;
  route_scope: 'branch' | 'company';
};

type RouteForm = {
  branch_id: string;
  document_type: PrinterRouteRecord['document_type'];
  printer_id: string;
  copies: number;
  is_default: boolean;
  is_active: boolean;
};

const documentTypes: PrinterRouteRecord['document_type'][] = [
  'receipt_voucher',
  'payment_voucher',
  'shipment_label',
  'shipment_receipt',
  'manifest',
  'delivery_note',
  'a4_report',
  'kitchen_ticket',
];

const initialForm: RouteForm = {
  branch_id: '',
  document_type: 'shipment_label',
  printer_id: '',
  copies: 1,
  is_default: true,
  is_active: true,
};

export default function PrinterRoutesSettingsPage() {
  const { showToast } = useToast();
  const [routes, setRoutes] = useState<PrinterRouteRecord[]>([]);
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [selected, setSelected] = useState<PrinterRouteRecord | null>(null);
  const [form, setForm] = useState<RouteForm>(initialForm);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resolveDocumentType, setResolveDocumentType] = useState<PrinterRouteRecord['document_type']>('shipment_label');
  const [resolved, setResolved] = useState<ResolvedRoute | null>(null);

  const printerNameById = useMemo(() => {
    const map = new Map<string, string>();
    printers.forEach((printer) => map.set(printer.id, `${printer.code} - ${printer.name}`));
    return map;
  }, [printers]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((branch) => map.set(branch.id, `${branch.code} - ${branch.name}`));
    return map;
  }, [branches]);

  const load = async () => {
    setLoading(true);
    try {
      const [routeRows, printerRows, branchRows] = await Promise.all([
        httpClient.get<PrinterRouteRecord[]>(`/printer-routes?includeInactive=${includeInactive ? 'true' : 'false'}`),
        httpClient.get<PrinterRecord[]>('/printers?includeInactive=true'),
        httpClient.get<BranchRecord[]>('/auth/branches'),
      ]);
      setRoutes(routeRows);
      setPrinters(printerRows);
      setBranches(branchRows);
      if (!form.printer_id && printerRows[0]) {
        setForm((prev) => ({ ...prev, printer_id: printerRows[0].id }));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل مسارات الطباعة', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [includeInactive]);

  const startCreate = () => {
    setSelected(null);
    setForm((prev) => ({ ...initialForm, printer_id: prev.printer_id }));
  };

  const startEdit = (row: PrinterRouteRecord) => {
    setSelected(row);
    setForm({
      branch_id: row.branch_id ?? '',
      document_type: row.document_type,
      printer_id: row.printer_id,
      copies: row.copies,
      is_default: row.is_default,
      is_active: row.is_active,
    });
  };

  const save = async () => {
    if (!form.printer_id) {
      showToast('اختر طابعة للمسار', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        branch_id: form.branch_id || null,
      };
      if (selected) {
        await httpClient.put(`/printer-routes/${selected.id}`, payload);
        showToast('تم تحديث مسار الطباعة', 'success');
      } else {
        await httpClient.post('/printer-routes', payload);
        showToast('تم إنشاء مسار طباعة', 'success');
      }
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ مسار الطباعة', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/printer-routes/${selected.id}`);
      showToast('تم تعطيل مسار الطباعة', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل المسار', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resolveRoute = async () => {
    try {
      const data = await resolvePrinterRoute(resolveDocumentType);
      setResolved(data);
      showToast('تم حل مسار الطباعة', 'success');
    } catch (error) {
      setResolved(null);
      showToast(error instanceof Error ? error.message : 'تعذر حل مسار الطباعة', 'error');
    }
  };

  const executePrint = async () => {
    try {
      const result = await printDocumentViaResolvedRoute({
        documentType: resolveDocumentType,
        payloadType: 'text',
        payloadRef: `ROUTE_TEST_${Date.now()}`,
        content: `Print route test for ${resolveDocumentType}`,
      });
      setResolved(result.resolved as ResolvedRoute);
      showToast(result.printResult.message || 'تم إرسال الطلب للطباعة', result.printResult.queued ? 'success' : 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'فشل اختبار الطباعة عبر المسار', 'error');
    }
  };

  const executeResolvedPrint = async () => {
    if (!resolved) {
      showToast('قم بحل المسار أولًا', 'error');
      return;
    }
    try {
      const result = await printDocumentViaResolvedRoute({
        documentType: resolved.document_type,
        payloadType: 'text',
        payloadRef: `ROUTE_TEST_${resolved.id}_${Date.now()}`,
        content: `Print route test for ${resolved.document_type}`,
        copies: resolved.copies,
      });
      showToast(result.printResult.message || 'تم إرسال الطلب للطباعة', result.printResult.queued ? 'success' : 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'فشل اختبار الطباعة عبر المسار', 'error');
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة مسارات الطباعة حسب نوع المستند</div>
      <div className="flex gap-2 mb-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          تضمين المعطلة
        </label>
        <button className="toolbar-btn primary" onClick={startCreate}>+ مسار جديد</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>

      <table className="data-grid">
        <thead>
          <tr>
            <th>نوع المستند</th>
            <th>الفرع</th>
            <th>الطابعة</th>
            <th>نسخ</th>
            <th>افتراضي</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((row) => (
            <tr key={row.id} className={selected?.id === row.id ? 'selected' : ''} onClick={() => startEdit(row)}>
              <td>{row.document_type}</td>
              <td>{row.branch_id ? branchNameById.get(row.branch_id) ?? row.branch_id : 'Fallback (Company)'}</td>
              <td>{printerNameById.get(row.printer_id) ?? row.printer_id}</td>
              <td>{row.copies}</td>
              <td>{row.is_default ? 'نعم' : 'لا'}</td>
              <td>{row.is_active ? 'نشط' : 'معلق'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-4 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">نوع المستند</label>
          <select className="form-select w-full" value={form.document_type} onChange={(e) => setForm((p) => ({ ...p, document_type: e.target.value as PrinterRouteRecord['document_type'] }))}>
            {documentTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">الفرع</label>
          <select className="form-select w-full" value={form.branch_id} onChange={(e) => setForm((p) => ({ ...p, branch_id: e.target.value }))}>
            <option value="">Fallback (Company)</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} - {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">الطابعة</label>
          <select className="form-select w-full" value={form.printer_id} onChange={(e) => setForm((p) => ({ ...p, printer_id: e.target.value }))}>
            <option value="">اختر طابعة</option>
            {printers.filter((printer) => printer.is_active).map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.code} - {printer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">عدد النسخ</label>
          <input type="number" min={1} max={10} className="form-input w-full" value={form.copies} onChange={(e) => setForm((p) => ({ ...p, copies: Number(e.target.value) || 1 }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
          المسار الافتراضي لنفس النطاق
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
          المسار نشط
        </label>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
          {selected ? 'حفظ التعديل' : 'إضافة المسار'}
        </button>
        {selected && <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>تعطيل</button>}
      </div>

      <div className="card mt-4">
        <div className="card-header">حل مسار الطباعة للتنفيذ</div>
        <div className="flex gap-2 items-center">
          <select className="form-select" value={resolveDocumentType} onChange={(e) => setResolveDocumentType(e.target.value as PrinterRouteRecord['document_type'])}>
            {documentTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button className="toolbar-btn" onClick={() => void resolveRoute()}>Resolve</button>
          <button className="toolbar-btn" onClick={() => void executePrint()}>Resolve + Print</button>
          <button className="toolbar-btn primary" onClick={() => void executeResolvedPrint()} disabled={!resolved}>Execute Print</button>
        </div>
        {resolved && (
          <div className="text-sm mt-2">
            <div>Route: {resolved.document_type} ({resolved.route_scope})</div>
            <div>Printer: {resolved.printer_code} - {resolved.printer_name}</div>
            <div>Target: {resolved.target}</div>
            <div>Copies: {resolved.copies}</div>
          </div>
        )}
      </div>
    </div>
  );
}
