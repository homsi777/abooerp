import { useState, useEffect } from 'react';
import { transfersGateway, Transfer } from '../lib/api/transfersGateway';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../lib/api/phase3FinanceGateway';
import { useToast } from '../components/Toast';
import { Plus, RefreshCw, Check, X, Search, Ban } from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { getCurrencyManagementSettings } from '../lib/settings/currencySettingsStore';

export default function Transfers() {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const currencySettings = getCurrencyManagementSettings();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [postingTransfer, setPostingTransfer] = useState<Transfer | null>(null);
  const [postingCashboxes, setPostingCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [postingCashboxId, setPostingCashboxId] = useState('');
  const [posting, setPosting] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<Transfer>>({});
  const [saving, setSaving] = useState(false);

  const canWrite = hasPermission('transfers.write');

  const displaySender = (transfer: Transfer) => transfer.sender_display_name || transfer.shipment_sender_name || transfer.sender_name;
  const displayReceiver = (transfer: Transfer) => transfer.receiver_display_name || transfer.shipment_receiver_name || transfer.receiver_name;
  const formatMoney = (amount?: number, currency?: string) => `${Number(amount ?? 0).toLocaleString()} ${currency || 'USD'}`;
  const formatTransferDate = (transfer: Transfer) => new Date(transfer.transfer_date || transfer.created_at).toLocaleString('ar-SY');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await transfersGateway.list({ status: statusFilter, search: searchTerm });
      setTransfers(data);
      setSelectedTransfer((current) => current ? data.find((item) => item.id === current.id) ?? null : null);
    } catch (err: any) {
      showToast(err.message || 'تعذر تحميل الحوالات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void loadData();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sender_name || !formData.receiver_name || !formData.amount) {
      showToast('الرجاء تعبئة الحقول المطلوبة', 'error');
      return;
    }

    try {
      setSaving(true);
      
      const payload = {
        sender_name: formData.sender_name,
        receiver_name: formData.receiver_name,
        amount: Number(formData.amount),
        currency: formData.currency || 'USD',
        main_amount: Number(formData.main_amount) || 0,
        // Legacy fields (mirrored from explicit agent commission)
        commission: Number(formData.agent_commission) || 0,
        commission_currency: formData.agent_commission_currency || 'USD',
        commission_main: Number(formData.agent_commission_main) || 0,
        // Explicit fields
        agent_commission: Number(formData.agent_commission) || 0,
        agent_commission_currency: formData.agent_commission_currency || 'USD',
        agent_commission_main: Number(formData.agent_commission_main) || 0,
        transfer_service_fee: Number(formData.transfer_service_fee) || 0,
        transfer_service_fee_currency: formData.transfer_service_fee_currency || (formData.currency || 'USD'),
        transfer_service_fee_main: Number(formData.transfer_service_fee_main) || 0,
        company_transfer_profit: Number(formData.company_transfer_profit) || Number(formData.transfer_service_fee) || 0,
        company_transfer_profit_currency: formData.company_transfer_profit_currency || formData.transfer_service_fee_currency || (formData.currency || 'USD'),
        company_transfer_profit_main: Number(formData.company_transfer_profit_main) || Number(formData.transfer_service_fee_main) || 0,
        notes: formData.notes,
        status: formData.status || 'PENDING',
      };

      if (!formData.id) {
        await transfersGateway.create(payload);
        showToast('تم إضافة الحوالة بنجاح', 'success');
      } else {
        // Not supporting full edit yet, only status update or delete
      }
      
      setIsEditing(false);
      setFormData({});
      void loadData();
    } catch (err: any) {
      showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await transfersGateway.updateStatus(id, newStatus);
      showToast('تم تحديث حالة الحوالة', 'success');
      void loadData();
    } catch (err: any) {
      showToast(err.message || 'تعذر تحديث الحالة', 'error');
    }
  };

  const openCompleteDialog = async (transfer: Transfer) => {
    setPostingTransfer(transfer);
    setPostingCashboxes([]);
    setPostingCashboxId('');
    try {
      const currency = String(transfer.transfer_service_fee_currency ?? transfer.currency ?? 'USD');
      const boxes = await phase3FinanceGateway.cashbox.listMaster({ currencyCode: currency, isActive: 'true' });
      const active = boxes.filter((b) => b.is_active);
      setPostingCashboxes(active);
      if (active.length === 1) {
        setPostingCashboxId(active[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'تعذر تحميل الصناديق', 'error');
    }
  };

  const closeCompleteDialog = () => {
    setPostingTransfer(null);
    setPostingCashboxes([]);
    setPostingCashboxId('');
    setPosting(false);
  };

  const confirmComplete = async () => {
    if (!postingTransfer) return;
    if (!postingCashboxId) {
      showToast('اختر الصندوق أولاً', 'error');
      return;
    }
    try {
      setPosting(true);
      await transfersGateway.complete(postingTransfer.id, { cashboxId: postingCashboxId });
      showToast('تم ترحيل الحوالة وإنشاء سند القبض', 'success');
      closeCompleteDialog();
      void loadData();
    } catch (err: any) {
      showToast(err.message || 'تعذر ترحيل الحوالة', 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleCancel = async (transfer: Transfer) => {
    const reason = prompt('سبب الإلغاء (اختياري):') || undefined;
    try {
      await transfersGateway.cancel(transfer.id, { reason });
      showToast('تم إلغاء الحوالة وعكس القيود', 'success');
      void loadData();
    } catch (err: any) {
      showToast(err.message || 'تعذر إلغاء الحوالة', 'error');
    }
  };

  const openNewForm = () => {
    setSelectedTransfer(null);
    setFormData({
      currency: 'USD',
      agent_commission_currency: 'USD',
      transfer_service_fee_currency: 'USD',
      company_transfer_profit_currency: 'USD',
      status: 'PENDING',
      amount: 0,
      agent_commission: 0,
      transfer_service_fee: 0,
      company_transfer_profit: 0,
    });
    setIsEditing(true);
  };

  // Commission Calculation
  const getRate = (currency: string) => {
    if (currency === 'USD') return 1;
    const rateRow = currencySettings.exchangeRates.find(r => r.from === currency);
    return rateRow ? rateRow.rate : 1;
  };

  const calculateDerivedAmounts = (amount: number, currency: string) => {
    const rate = getRate(currency);
    const usdAmount = currency === 'USD' ? amount : amount / rate;
    const serviceFee = amount * 0.01; // 1% default for transfer service fee
    setFormData(prev => ({
      ...prev,
      main_amount: usdAmount,
      transfer_service_fee: serviceFee,
      transfer_service_fee_currency: currency,
      transfer_service_fee_main: serviceFee / rate,
      company_transfer_profit: serviceFee,
      company_transfer_profit_currency: currency,
      company_transfer_profit_main: serviceFee / rate,
    }));
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {postingTransfer && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="card w-[520px] max-w-[95vw]">
            <div className="flex justify-between items-center border-b pb-2 mb-4">
              <div>
                <h3 className="font-semibold text-lg">ترحيل أجرة الحوالة</h3>
                <div className="text-xs text-gray-500">
                  {displaySender(postingTransfer)} → {displayReceiver(postingTransfer)} — {formatMoney(postingTransfer.transfer_service_fee, postingTransfer.transfer_service_fee_currency)}
                </div>
              </div>
              <button className="text-gray-400 hover:text-gray-600" onClick={closeCompleteDialog} title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="form-group">
                <label>الصندوق</label>
                <select className="form-input w-full" value={postingCashboxId} onChange={(e) => setPostingCashboxId(e.target.value)}>
                  <option value="">اختر صندوق...</option>
                  {postingCashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name} ({cb.currency_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-gray-500">
                سيتم إنشاء سند قبض مؤكد بقيمة أجرة الحوالة وربطه بالحوالة، مع تسجيل حركة صندوق.
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeCompleteDialog} disabled={posting}>
                  إلغاء
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmComplete} disabled={posting || !postingCashboxId}>
                  {posting ? 'جاري الترحيل...' : 'ترحيل'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2>قسم الحوالات</h2>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            className="form-input w-64"
            placeholder="بحث عن اسم مرسل أو مستلم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select 
            className="form-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">جميع الحالات</option>
            <option value="PENDING">قيد الانتظار</option>
            <option value="COMPLETED">مكتملة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
          <button type="submit" className="btn btn-secondary"><Search className="w-4 h-4" /></button>
        </form>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="card flex-1 flex flex-col min-h-0">
          <div className="toolbar">
            {canWrite && (
              <button className="btn btn-primary" onClick={openNewForm}>
                <Plus className="w-4 h-4" />
                حوالة جديدة
              </button>
            )}
            <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>

          <div className="table-container flex-1">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>تاريخ الحوالة</th>
                  <th>المرسل</th>
                  <th>المستلم</th>
                  <th>الوكيل</th>
                  <th>المبلغ</th>
                  <th>عمولة الوكيل</th>
                  <th>أجرة الحوالة</th>
                  <th>ربح الشركة</th>
                  <th>رقم الشحنة المرتبطة</th>
                  <th>الحالة</th>
                <th>السند</th>
                <th>الصندوق</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => {
                      setSelectedTransfer(t);
                      setIsEditing(false);
                    }}
                    title="اضغط لعرض تفاصيل الحوالة"
                    style={{
                      cursor: 'pointer',
                      background: selectedTransfer?.id === t.id ? '#eff6ff' : undefined,
                    }}
                  >
                    <td>{formatTransferDate(t)}</td>
                    <td>{displaySender(t)}</td>
                    <td>{displayReceiver(t)}</td>
                    <td>{t.agent_name || '-'}</td>
                    <td>{t.amount.toLocaleString()} {t.currency}</td>
                    <td>{(t.agent_commission ?? t.commission ?? 0).toLocaleString()} {(t.agent_commission_currency ?? t.commission_currency ?? t.currency)}</td>
                    <td>{(t.transfer_service_fee ?? 0).toLocaleString()} {(t.transfer_service_fee_currency ?? t.currency)}</td>
                    <td>{(t.company_transfer_profit ?? 0).toLocaleString()} {(t.company_transfer_profit_currency ?? t.currency)}</td>
                    <td>{t.shipment_no || '-'}</td>
                    <td>
                      <span className={`px-2 py-1 rounded text-xs ${t.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : t.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {t.status === 'COMPLETED' ? 'مكتملة' : t.status === 'CANCELLED' ? 'ملغاة' : 'قيد الانتظار'}
                      </span>
                    </td>
                    <td>{t.receipt_voucher_no || '-'}</td>
                    <td>{t.posted_cashbox_name || '-'}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="flex gap-2">
                        {canWrite && t.status === 'PENDING' && (
                          <button className="text-green-600 hover:text-green-800" onClick={() => void openCompleteDialog(t)} title="ترحيل وإكمال">
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        {canWrite && (t.status === 'PENDING' || t.status === 'COMPLETED') && (
                          <button className="text-amber-600 hover:text-amber-800" onClick={() => void handleCancel(t)} title="إلغاء الحوالة">
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {transfers.length === 0 && (
                  <tr>
                    <td colSpan={13} className="text-center py-8 text-gray-500">
                      لا يوجد حوالات
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {!isEditing && selectedTransfer && (
          <div className="card w-96 flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b pb-2 mb-4">
              <div>
                <h3 className="font-semibold text-lg">تفاصيل الحوالة</h3>
                <div className="text-xs text-gray-500">{selectedTransfer.shipment_no ? `مرتبطة بالشحنة ${selectedTransfer.shipment_no}` : 'حوالة مستقلة'}</div>
              </div>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setSelectedTransfer(null)} title="إغلاق التفاصيل">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-slate-200 p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 mb-1">المرسل</div>
                  <div className="font-semibold text-slate-900">{displaySender(selectedTransfer)}</div>
                </div>
                <div className="rounded border border-slate-200 p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 mb-1">المستلم</div>
                  <div className="font-semibold text-slate-900">{displayReceiver(selectedTransfer)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div><span className="text-gray-500">تاريخ الحوالة:</span> {formatTransferDate(selectedTransfer)}</div>
                <div><span className="text-gray-500">الحالة:</span> {selectedTransfer.status === 'COMPLETED' ? 'مكتملة' : selectedTransfer.status === 'CANCELLED' ? 'ملغاة' : 'قيد الانتظار'}</div>
                <div><span className="text-gray-500">الفرع:</span> {selectedTransfer.branch_name || '-'}</div>
                <div><span className="text-gray-500">الوكيل:</span> {selectedTransfer.agent_name || '-'}</div>
                <div><span className="text-gray-500">المبلغ:</span> {formatMoney(selectedTransfer.amount, selectedTransfer.currency)}</div>
                <div><span className="text-gray-500">المبلغ الرئيسي:</span> {formatMoney(selectedTransfer.main_amount, 'USD')}</div>
                <div><span className="text-gray-500">عمولة الوكيل:</span> {formatMoney(selectedTransfer.agent_commission ?? selectedTransfer.commission, selectedTransfer.agent_commission_currency ?? selectedTransfer.commission_currency ?? selectedTransfer.currency)}</div>
                <div><span className="text-gray-500">أجرة الحوالة:</span> {formatMoney(selectedTransfer.transfer_service_fee, selectedTransfer.transfer_service_fee_currency ?? selectedTransfer.currency)}</div>
                <div><span className="text-gray-500">ربح الشركة:</span> {formatMoney(selectedTransfer.company_transfer_profit, selectedTransfer.company_transfer_profit_currency ?? selectedTransfer.currency)}</div>
                <div><span className="text-gray-500">رقم الشحنة:</span> {selectedTransfer.shipment_no || '-'}</div>
                <div><span className="text-gray-500">سند القبض:</span> {selectedTransfer.receipt_voucher_no || '-'}</div>
                <div><span className="text-gray-500">الصندوق:</span> {selectedTransfer.posted_cashbox_name || '-'}</div>
                <div><span className="text-gray-500">تاريخ الترحيل:</span> {selectedTransfer.posted_at ? new Date(selectedTransfer.posted_at).toLocaleString('ar-SY') : '-'}</div>
              </div>

              {selectedTransfer.notes && (
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500 mb-1">ملاحظات</div>
                  <div>{selectedTransfer.notes}</div>
                </div>
              )}

              {selectedTransfer.cancellation_reason && (
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500 mb-1">سبب الإلغاء</div>
                  <div>{selectedTransfer.cancellation_reason}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {isEditing && (
          <div className="card w-80 flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b pb-2 mb-4">
              <h3 className="font-semibold text-lg">إضافة حوالة جديدة</h3>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setIsEditing(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-4 pr-2">
              <div className="form-group">
                <label>اسم المرسل <span className="text-red-500">*</span></label>
                <input required type="text" className="form-input" value={formData.sender_name || ''} onChange={e => setFormData({...formData, sender_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>اسم المستلم <span className="text-red-500">*</span></label>
                <input required type="text" className="form-input" value={formData.receiver_name || ''} onChange={e => setFormData({...formData, receiver_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>المبلغ <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input required type="number" step="0.01" className="form-input flex-1" value={formData.amount || ''} onChange={e => {
                    const amt = Number(e.target.value);
                    setFormData({...formData, amount: amt});
                    calculateDerivedAmounts(amt, formData.currency || 'USD');
                  }} />
                  <select className="form-input w-24" value={formData.currency || 'USD'} onChange={e => {
                    setFormData({...formData, currency: e.target.value});
                    calculateDerivedAmounts(Number(formData.amount || 0), e.target.value);
                  }}>
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>عمولة الوكيل (اختياري)</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" className="form-input flex-1" value={formData.agent_commission || ''} onChange={e => {
                    const comm = Number(e.target.value);
                    const rate = getRate(formData.agent_commission_currency || 'USD');
                    setFormData({
                      ...formData, 
                      agent_commission: comm,
                      agent_commission_main: (formData.agent_commission_currency === 'USD') ? comm : comm / rate
                    });
                  }} />
                  <select className="form-input w-24" value={formData.agent_commission_currency || 'USD'} onChange={e => {
                    const currency = e.target.value;
                    const comm = Number(formData.agent_commission || 0);
                    const rate = getRate(currency);
                    setFormData({
                      ...formData,
                      agent_commission_currency: currency,
                      agent_commission_main: currency === 'USD' ? comm : comm / rate,
                    });
                  }}>
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>أجرة خدمة الحوالة (ربح الخدمة)</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" className="form-input flex-1" value={formData.transfer_service_fee || ''} onChange={e => {
                    const fee = Number(e.target.value);
                    const currency = String(formData.transfer_service_fee_currency || formData.currency || 'USD');
                    const rate = getRate(currency);
                    const feeMain = currency === 'USD' ? fee : fee / rate;
                    setFormData({
                      ...formData,
                      transfer_service_fee: fee,
                      transfer_service_fee_main: feeMain,
                      company_transfer_profit: fee,
                      company_transfer_profit_currency: currency,
                      company_transfer_profit_main: feeMain,
                    });
                  }} />
                  <select className="form-input w-24" value={formData.transfer_service_fee_currency || formData.currency || 'USD'} onChange={e => {
                    const currency = e.target.value;
                    const fee = Number(formData.transfer_service_fee || 0);
                    const rate = getRate(currency);
                    const feeMain = currency === 'USD' ? fee : fee / rate;
                    setFormData({
                      ...formData,
                      transfer_service_fee_currency: currency,
                      transfer_service_fee_main: feeMain,
                      company_transfer_profit_currency: currency,
                      company_transfer_profit_main: feeMain,
                    });
                  }}>
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>ملاحظات</label>
                <textarea className="form-input min-h-[80px]" value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} />
              </div>
              
              <div className="pt-4 border-t mt-auto">
                <button type="submit" className="btn btn-primary w-full" disabled={saving}>
                  {saving ? 'جاري الحفظ...' : 'حفظ الحوالة'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
