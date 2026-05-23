import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';
import type { ShippingLabelFieldId, ShippingLabelFieldSetting, ShippingLabelPrintSettings } from '../../lib/settings/shippingLabelPrintConfig';
import { DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS } from '../../lib/settings/shippingLabelPrintConfig';

const previewShipmentData: Record<ShippingLabelFieldId, string> = {
  receiverName: 'متجر النجاح',
  receiverPhone: '0944556677',
  senderName: 'شركة الأصيل التجارية',
  senderPhone: '0933111222',
  shipmentNo: 'SHP-2026-01025',
  trackingNo: 'TRK-882145',
  destination: 'دمشق',
  branch: 'فرع دمشق',
  goodsDescription: 'قطع إلكترونية حساسة',
  piecesCount: '3',
  notes: 'قابل للكسر - يرجى التعامل بحذر',
  date: '2026-04-22',
  companyName: 'شركة شحن',
  companyLogo: 'LOGO',
};

const importantFields: ShippingLabelFieldId[] = ['shipmentNo', 'trackingNo', 'receiverName'];

type PrintPlan = {
  settings: ShippingLabelPrintSettings;
  printerRoute: null | {
    printer_name: string;
    target: string;
    copies: number;
    route_scope: 'branch' | 'company';
  };
};

export default function ShippingLabelPrintSettingsPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<ShippingLabelPrintSettings>(DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS);
  const [printPlan, setPrintPlan] = useState<PrintPlan | null>(null);
  const [saving, setSaving] = useState(false);

  const visibleFields = useMemo(
    () => settings.fields.filter((field) => field.enabled).sort((a, b) => a.order - b.order),
    [settings.fields]
  );

  const updateField = (id: ShippingLabelFieldId, update: Partial<ShippingLabelFieldSetting>) => {
    setSettings((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => (field.id === id ? { ...field, ...update } : field)),
    }));
  };

  const load = async () => {
    try {
      const data = await httpClient.get<ShippingLabelPrintSettings>('/shipping-label-settings');
      setSettings(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل إعدادات لصاقة الشحن', 'error');
    }
  };

  const loadPrintPlan = async () => {
    try {
      const data = await httpClient.get<PrintPlan>('/shipping-label-settings/print-plan');
      setPrintPlan(data);
    } catch (error) {
      setPrintPlan(null);
      showToast(error instanceof Error ? error.message : 'تعذر جلب خطة الطباعة', 'error');
    }
  };

  useEffect(() => {
    void load();
    void loadPrintPlan();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const data = await httpClient.put<ShippingLabelPrintSettings>('/shipping-label-settings', settings);
      setSettings(data);
      showToast('تم حفظ إعدادات طباعة لصاقة الشحن', 'success');
      await loadPrintPlan();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ إعدادات لصاقة الشحن', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSettings(DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS);
    showToast('تمت إعادة الإعدادات الافتراضية محليًا، اضغط حفظ للتطبيق', 'info');
  };

  const densityClass = settings.layout.spacingDensity === 'compact' ? 'space-y-1' : 'space-y-2';
  const alignStyle = { textAlign: settings.layout.textAlign as 'right' | 'center' | 'left' };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">تخصيص طباعة لصاقة الشحن (Backend-driven)</div>
        <div className="text-sm text-gray-600 mb-3">الطباعة الآن تعتمد على إعدادات backend + printer routing ({'shipment_label'}).</div>

        <div className="grid grid-cols-2 gap-4">
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">حقول اللصاقة</div>
            <table className="data-grid">
              <thead>
                <tr>
                  <th>تفعيل</th>
                  <th>الحقل</th>
                  <th>الترتيب</th>
                </tr>
              </thead>
              <tbody>
                {settings.fields.map((field) => (
                  <tr key={field.id}>
                    <td><input type="checkbox" checked={field.enabled} onChange={(e) => updateField(field.id, { enabled: e.target.checked })} /></td>
                    <td>{field.label}</td>
                    <td>
                      <input type="number" min={1} className="form-input w-20" value={field.order} onChange={(e) => updateField(field.id, { order: Number(e.target.value) || 1 })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">خيارات التخطيط</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label">حجم اللصاقة</label>
                <select className="form-select w-full" value={settings.layout.labelSize} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, labelSize: e.target.value as any } })}>
                  <option value="A6">A6</option>
                  <option value="100x150">100x150</option>
                  <option value="80x50">80x50</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">محاذاة النص</label>
                <select className="form-select w-full" value={settings.layout.textAlign} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, textAlign: e.target.value as any } })}>
                  <option value="right">يمين</option>
                  <option value="center">وسط</option>
                  <option value="left">يسار</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">الكثافة</label>
                <select className="form-select w-full" value={settings.layout.spacingDensity} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, spacingDensity: e.target.value as any } })}>
                  <option value="normal">Normal</option>
                  <option value="compact">Compact</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.layout.showBorder} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, showBorder: e.target.checked } })} />إظهار إطار</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.layout.boldImportantFields} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, boldImportantFields: e.target.checked } })} />إبراز الحقول المهمة</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.layout.largeTrackingNumber} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, largeTrackingNumber: e.target.checked } })} />رقم تتبع كبير</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.layout.barcodeEnabled} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, barcodeEnabled: e.target.checked } })} />تفعيل الباركود</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.layout.logoEnabled} onChange={(e) => setSettings({ ...settings, layout: { ...settings.layout, logoEnabled: e.target.checked } })} />تفعيل الشعار</label>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={() => void save()} className="toolbar-btn primary" disabled={saving}>{saving ? 'Saving...' : 'حفظ التخصيص'}</button>
          <button onClick={reset} className="toolbar-btn">إعادة الافتراضي</button>
          <button onClick={() => void loadPrintPlan()} className="toolbar-btn">تحديث خطة الطباعة</button>
        </div>
      </div>

      {printPlan && (
        <div className="card text-sm">
          <div className="card-header">Shipping Label Print Route</div>
          {printPlan.printerRoute ? (
            <>
              <div>Printer: {printPlan.printerRoute.printer_name}</div>
              <div>Target: {printPlan.printerRoute.target}</div>
              <div>Copies: {printPlan.printerRoute.copies}</div>
              <div>Scope: {printPlan.printerRoute.route_scope}</div>
            </>
          ) : (
            <div className="text-red-700">لا يوجد مسار طباعة مفعّل لنوع المستند shipment_label.</div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header">معاينة حية للّصاقة</div>
        <div className="flex justify-center">
          <div className={`w-80 bg-white p-3 ${settings.layout.showBorder ? 'border border-gray-400' : ''}`} style={alignStyle}>
            {settings.layout.logoEnabled && visibleFields.some((f) => f.id === 'companyLogo') && (
              <div className="text-xs mb-2 text-gray-700">[شعار الشركة]</div>
            )}
            <div className={densityClass}>
              {visibleFields.map((field) => {
                const isImportant = settings.layout.boldImportantFields && importantFields.includes(field.id);
                const isTracking = settings.layout.largeTrackingNumber && field.id === 'trackingNo';
                return (
                  <div key={field.id} style={{ fontWeight: isImportant ? 700 : 400, fontSize: isTracking ? '18px' : '14px' }}>
                    <span className="text-gray-500 ml-1">{field.label}:</span>
                    <span>{previewShipmentData[field.id]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
