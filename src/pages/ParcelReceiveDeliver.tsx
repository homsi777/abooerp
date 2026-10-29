import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Package, QrCode, RefreshCw, Search, X } from 'lucide-react';
import {
  PARCEL_NEXT_ACTION,
  parcelTrackingGateway,
  type ParcelListStatus,
  type ParcelRow,
} from '../lib/api/parcelTrackingGateway';

const STATUS_TABS: { value: ParcelListStatus; label: string }[] = [
  { value: 'open', label: 'غير مسلّمة' },
  { value: 'intake', label: 'مستلمة من المرسل' },
  { value: 'warehouse', label: 'في المستودع' },
  { value: 'arrived', label: 'وصلت إلى الوجهة' },
  { value: 'delivered', label: 'سُلّمت' },
  { value: 'all', label: 'الكل' },
];

function statusClasses(status: ParcelRow['parcel_status']): string {
  switch (status) {
    case 'delivered':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'arrived':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'warehouse':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

/**
 * Receive/deliver, driven by the QR code on the parcel label.
 *
 * The search box IS the scanner: a USB QR reader behaves as a keyboard, so
 * it types the receipt number and presses Enter — identical to a human
 * typing it. That is why no camera permission or device pairing is needed
 * anywhere in this screen.
 *
 * Scanning never names a target status. The server derives the next step
 * from where the parcel currently is, so an out-of-order scan (delivering
 * something that never left the origin) or a second delivery scan is
 * refused instead of silently corrupting the trail.
 */
export default function ParcelReceiveDeliver() {
  const [rows, setRows] = useState<ParcelRow[]>([]);
  const [status, setStatus] = useState<ParcelListStatus>('open');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [scanCode, setScanCode] = useState('');
  const [scanned, setScanned] = useState<ParcelRow | null>(null);
  const [deliveredTo, setDeliveredTo] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setRows(await parcelTrackingGateway.list({ status, search: search.trim() || undefined }));
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'تعذر تحميل القائمة.');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the cursor in the scan box so a reader can fire one code after
  // another without anyone touching the mouse.
  useEffect(() => {
    scanInputRef.current?.focus();
  }, [scanned]);

  const lookup = async () => {
    const code = Number(scanCode.trim());
    if (!Number.isFinite(code) || code <= 0) {
      setScanError('رمز غير صالح — يجب أن يكون رقم إيصال.');
      return;
    }
    setScanBusy(true);
    setScanError(null);
    setScanNotice(null);
    try {
      const parcel = await parcelTrackingGateway.lookup(code);
      setScanned(parcel);
      setDeliveredTo('');
    } catch (error) {
      setScanned(null);
      setScanError(error instanceof Error ? error.message : 'لا توجد شحنة بهذا الرمز.');
    } finally {
      setScanBusy(false);
    }
  };

  const confirmScan = async () => {
    if (!scanned?.tablet_receipt_no) return;
    setScanBusy(true);
    setScanError(null);
    try {
      const updated = await parcelTrackingGateway.scan({
        code: scanned.tablet_receipt_no,
        deliveredToName: deliveredTo.trim() || undefined,
      });
      setScanned(updated);
      setScanNotice(
        updated.parcel_status === 'delivered'
          ? `تم التسليم${updated.delivered_to_name ? ` إلى: ${updated.delivered_to_name}` : ''}`
          : `تم تحديث الحالة: ${updated.statusLabel}`,
      );
      setScanCode('');
      void refresh();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'تعذر تحديث حالة الشحنة.');
    } finally {
      setScanBusy(false);
    }
  };

  const clearScan = () => {
    setScanned(null);
    setScanCode('');
    setDeliveredTo('');
    setScanError(null);
    setScanNotice(null);
    scanInputRef.current?.focus();
  };

  const nextAction = scanned ? PARCEL_NEXT_ACTION[scanned.parcel_status] : null;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <Package className="w-6 h-6 text-emerald-700" />
        <h1 className="text-2xl font-bold">استلام / تسليم</h1>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-600">
          <QrCode className="w-5 h-5" />
          <span className="text-sm">امسح رمز QR على اللصاقة بالقارئ، أو اكتب رقم الإيصال واضغط Enter.</span>
        </div>

        <div className="flex gap-2">
          <input
            ref={scanInputRef}
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void lookup();
            }}
            placeholder="رقم الإيصال / مسح QR"
            className="flex-1 border rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={scanBusy || !scanCode.trim()}
            className="px-5 py-3 rounded-lg bg-emerald-700 text-white font-bold disabled:opacity-50"
          >
            بحث
          </button>
          {scanned && (
            <button type="button" onClick={clearScan} className="px-3 py-3 rounded-lg border" title="إلغاء">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {scanError && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{scanError}</div>}
        {scanNotice && (
          <div className="text-green-800 bg-green-50 border border-green-200 rounded-lg px-4 py-2 font-bold flex items-center gap-2">
            <Check className="w-5 h-5" />
            {scanNotice}
          </div>
        )}

        {scanned && (
          <div className={`rounded-xl border p-4 space-y-2 ${statusClasses(scanned.parcel_status)}`}>
            <div className="flex flex-wrap gap-x-8 gap-y-1 font-bold">
              <span>رقم الإيصال: {scanned.tablet_receipt_no ?? '-'}</span>
              <span>الحالة: {scanned.statusLabel}</span>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <span>المرسل: {scanned.sender_name || '-'}</span>
              <span>المستلم: {scanned.receiver_name || '-'}</span>
              <span>الوجهة: {scanned.destination || '-'}</span>
              <span>عدد الطرود: {scanned.parcel_count ?? '-'}</span>
              {scanned.branch_name && <span>فرع الإرسال: {scanned.branch_name}</span>}
            </div>

            {scanned.parcel_status === 'arrived' && (
              <div className="pt-2">
                <label className="block text-sm mb-1">اسم المستلم</label>
                <input
                  value={deliveredTo}
                  onChange={(e) => setDeliveredTo(e.target.value)}
                  placeholder={scanned.receiver_name ?? ''}
                  className="w-full md:w-80 border rounded-lg px-3 py-2"
                />
                <div className="text-xs text-slate-600 mt-1">
                  اتركه فارغاً ليُسجَّل باسم المستلم المدوّن على الشحنة.
                </div>
              </div>
            )}

            <div className="pt-2">
              {nextAction ? (
                <button
                  type="button"
                  onClick={() => void confirmScan()}
                  disabled={scanBusy}
                  className="px-5 py-3 rounded-lg bg-emerald-700 text-white font-bold disabled:opacity-50"
                >
                  {nextAction}
                </button>
              ) : (
                <div className="font-bold">
                  هذه الشحنة سُلّمت مسبقاً{scanned.delivered_to_name ? ` إلى: ${scanned.delivered_to_name}` : ''}.
                </div>
              )}
            </div>

            {scanned.history && scanned.history.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm font-bold">سجل حركة الطرد</summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {scanned.history.map((event, index) => (
                    <li key={index}>
                      {new Date(event.created_at).toLocaleString('ar')} — {event.to_status}
                      {event.scanned_by_name ? ` — بواسطة: ${event.scanned_by_name}` : ''}
                      {event.branch_name ? ` — ${event.branch_name}` : ''}
                      {event.delivered_to_name ? ` — استلمها: ${event.delivered_to_name}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-2 border-b">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                status === tab.value ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث: رقم، مرسل، مستلم، وجهة"
              className="border rounded-lg ps-3 pe-9 py-2 w-72"
            />
          </div>
          <button type="button" onClick={() => void refresh()} className="p-2 rounded-lg border" title="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {listError && <div className="p-4 text-red-700">{listError}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right">رقم الإيصال</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2 text-right">المرسل</th>
                <th className="px-3 py-2 text-right">المستلم</th>
                <th className="px-3 py-2 text-right">الوجهة</th>
                <th className="px-3 py-2 text-right">الطرود</th>
                <th className="px-3 py-2 text-right">الفرع</th>
                <th className="px-3 py-2 text-right">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    لا توجد شحنات مطابقة.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t ${row.parcel_status === 'delivered' ? 'bg-green-50' : ''}`}
                >
                  <td className="px-3 py-2 font-mono font-bold">{row.tablet_receipt_no ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full border text-xs ${statusClasses(row.parcel_status)}`}>
                      {row.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.sender_name || '-'}</td>
                  <td className="px-3 py-2">
                    {row.receiver_name || '-'}
                    {row.delivered_to_name && row.delivered_to_name !== row.receiver_name && (
                      <span className="text-xs text-green-800"> (استلمها: {row.delivered_to_name})</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.destination || '-'}</td>
                  <td className="px-3 py-2">{row.parcel_count ?? '-'}</td>
                  <td className="px-3 py-2">{row.branch_name || '-'}</td>
                  <td className="px-3 py-2">{row.ledger_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
