import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthProvider';
import { useRegisterEscape } from '../../context/EscapeRegistryContext';
import { formatWesternNumber } from '../../lib/format/westernDigits';
import { printLedgerStyleDocument } from '../../lib/export/ledgerStylePrint';
import { companyPrintHeaderStyles, renderCompanyPrintHeader } from '../../lib/export/companyPrintHeader';

// شاشة "الرواتب والسلف" — أُعيد تصميمها بالكامل لتكون سطراً واحداً لكل موظف
// بجانبه زرّا "تسليم راتب" و"طباعة إيصال A5" فقط، بدل التبويبات الثلاثة
// (الموظفون/كشف الرواتب/السلف) المعقّدة سابقاً. إدارة بيانات الموظف والسلف
// بقيت متاحة من قائمة إجراءات صغيرة بجانب كل سطر لعدم فقدان أي قدرة قائمة.

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  code: string;
  name: string;
  position: string | null;
  basic_salary: string;
  currency: string;
  salary_type?: 'monthly' | 'weekly';
  hire_date: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
}

interface SalaryRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  period_year: number;
  period_month: number;
  basic_amount: string;
  bonuses: string;
  deductions: string;
  manual_deductions?: string;
  advance_deductions?: string;
  net_amount: string;
  paid_amount?: string;
  salary_payment_voucher_id?: string | null;
  salary_cashbox_id?: string | null;
  currency: string;
  payment_status: 'pending' | 'paid' | 'cancelled';
  paid_at: string | null;
  notes: string | null;
}

interface Advance {
  id: string;
  employee_id: string;
  amount: string;
  repaid_amount: string;
  currency: string;
  outstanding_usd_equivalent?: string;
  advance_date: string;
  expected_repay: string | null;
  status: 'pending' | 'partially_repaid' | 'repaid' | 'cancelled';
  notes: string | null;
}

interface SalaryAdvanceDeduction {
  id: string;
  employee_advance_id: string;
  advance_date: string;
  original_amount: string;
  remaining_balance: string;
  status: string;
  deducted_amount: string;
  currency: string;
  deducted_salary_amount: string;
  salary_currency: string;
  created_at: string;
}

// ─── Constants / helpers ────────────────────────────────────────────────────

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const CURRENCIES = ['USD', 'SYP', 'SAR', 'AED', 'EUR', 'TRY'];

const SALARY_TYPE_AR: Record<'monthly' | 'weekly', string> = {
  monthly: 'شهري',
  weekly: 'أسبوعي',
};

function fmt(n: string | number | undefined | null): string {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0;
  return Number.isNaN(v) ? '0' : formatWesternNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

type EmpForm = {
  code: string;
  name: string;
  position: string;
  basicSalary: number;
  currency: string;
  salaryType: 'monthly' | 'weekly';
  hireDate: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

const emptyEmp: EmpForm = {
  code: '', name: '', position: '', basicSalary: 0,
  currency: 'USD', salaryType: 'monthly', hireDate: '', phone: '', notes: '',
  isActive: true,
};

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useRegisterEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`bg-white rounded-lg shadow-xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── A5 salary receipt print ────────────────────────────────────────────────

function escapeReceiptHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSalaryReceiptHtml(
  employee: Employee,
  record: SalaryRecord,
  deductions: SalaryAdvanceDeduction[],
  cashboxName: string | null,
): string {
  const advanceRows = deductions
    .map(
      (d) => `<tr><td>${escapeReceiptHtml(d.advance_date?.split('T')[0] ?? '—')}</td><td>${fmt(d.deducted_salary_amount)} ${escapeReceiptHtml(record.currency)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>إيصال راتب — ${escapeReceiptHtml(employee.name)}</title>
<style>
  @page { size: A5; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; font-family: Tahoma, Arial, sans-serif; color: #10251f; }
  ${companyPrintHeaderStyles()}
  .meta { margin: 10px 0; font-size: 12.5px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; }
  .meta div { border: 1px solid #c5d0dc; padding: 4px 6px; background: #f8fafc; }
  .meta strong { font-weight: 800; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th, td { border: 1px solid #7f93a7; padding: 5px 6px; text-align: right; }
  th { background: #dce8e5; font-weight: 800; }
  tr.net td { background: #dce8e5; font-weight: 800; font-size: 14px; }
  tr.sub td { color: #475569; font-size: 11.5px; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 26px; font-size: 12.5px; }
  .sign-row div { width: 45%; border-top: 1px solid #334155; padding-top: 4px; text-align: center; }
</style>
</head>
<body>
  ${renderCompanyPrintHeader({ title: 'إيصال استلام راتب', fields: [] })}
  <div class="meta">
    <div><strong>الموظف:</strong> ${escapeReceiptHtml(employee.name)} (${escapeReceiptHtml(employee.code)})</div>
    <div><strong>الفترة:</strong> ${escapeReceiptHtml(MONTHS_AR[record.period_month - 1])} ${escapeReceiptHtml(record.period_year)}</div>
    <div><strong>تاريخ الاستلام:</strong> ${escapeReceiptHtml(record.paid_at?.split('T')[0] ?? '—')}</div>
    <div><strong>الصندوق:</strong> ${escapeReceiptHtml(cashboxName ?? '—')}</div>
  </div>
  <table>
    <thead><tr><th>البيان</th><th>المبلغ (${escapeReceiptHtml(record.currency)})</th></tr></thead>
    <tbody>
      <tr><td>الراتب الأساسي</td><td>${fmt(record.basic_amount)}</td></tr>
      ${Number(record.bonuses) > 0 ? `<tr><td>بونص</td><td>${fmt(record.bonuses)}</td></tr>` : ''}
      ${advanceRows ? `<tr><td colspan="2" style="background:#f1f5f9;font-weight:700;">خصم سلف</td></tr>${advanceRows}` : ''}
      ${Number(record.manual_deductions ?? 0) > 0 ? `<tr><td>خصم (مخالفات/أخرى)</td><td>-${fmt(record.manual_deductions)}</td></tr>` : ''}
      <tr class="net"><td>الصافي المستلم</td><td>${fmt(record.paid_amount ?? record.net_amount)}</td></tr>
    </tbody>
  </table>
  <div class="sign-row">
    <div>توقيع الموظف</div>
    <div>توقيع المحاسب</div>
  </div>
</body>
</html>`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FinanceSalaries() {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canManageEmployees = hasPermission('hr.employees.write');
  const canManageSalaries = hasPermission('hr.salaries.write');
  const canManageAdvances = hasPermission('hr.advances.write');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allSalaries, setAllSalaries] = useState<SalaryRecord[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const [empModal, setEmpModal] = useState<'create' | Employee | null>(null);
  const [empForm, setEmpForm] = useState<EmpForm>(emptyEmp);
  const [savingEmp, setSavingEmp] = useState(false);

  const [payEmployee, setPayEmployee] = useState<Employee | null>(null);
  const [advanceEmployee, setAdvanceEmployee] = useState<Employee | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);

  const now = new Date();
  const periodYear = now.getFullYear();
  const periodMonth = now.getMonth() + 1;

  const load = async () => {
    setLoading(true);
    try {
      const [emps, sals, boxes] = await Promise.all([
        httpClient.get<Employee[]>('/employees?includeInactive=true'),
        httpClient.get<SalaryRecord[]>('/salary-records'),
        phase3FinanceGateway.cashbox.listMaster(),
      ]);
      setEmployees(emps);
      setAllSalaries(sals);
      setCashboxes(boxes);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // allSalaries مرتّبة من الخادم تنازلياً حسب الفترة (الأحدث أولاً)، فأول عنصر
  // مطابق لكل موظف هو سجله الأحدث/المدفوع الأحدث على التتابع.
  const currentRecordFor = (employeeId: string): SalaryRecord | null =>
    allSalaries.find(
      (s) => s.employee_id === employeeId && s.period_year === periodYear && s.period_month === periodMonth && s.payment_status !== 'cancelled',
    ) ?? null;

  const lastPaidRecordFor = (employeeId: string): SalaryRecord | null =>
    allSalaries.find((s) => s.employee_id === employeeId && s.payment_status === 'paid') ?? null;

  const openCreateEmp = () => { setEmpForm(emptyEmp); setEmpModal('create'); };
  const openEditEmp = (e: Employee) => {
    setEmpForm({
      code: e.code, name: e.name, position: e.position ?? '',
      basicSalary: parseFloat(e.basic_salary), currency: e.currency,
      salaryType: (e.salary_type === 'weekly' ? 'weekly' : 'monthly') as 'monthly' | 'weekly',
      hireDate: e.hire_date ?? '', phone: e.phone ?? '', notes: e.notes ?? '',
      isActive: e.is_active,
    });
    setEmpModal(e);
    setActionsFor(null);
  };

  const saveEmployee = async () => {
    setSavingEmp(true);
    try {
      const payload = {
        code: empForm.code, name: empForm.name,
        position: empForm.position || undefined,
        basicSalary: empForm.basicSalary,
        currency: empForm.currency,
        salaryType: empForm.salaryType,
        hireDate: empForm.hireDate || undefined,
        phone: empForm.phone || undefined,
        notes: empForm.notes || undefined,
        isActive: empForm.isActive,
      };
      if (empModal === 'create') {
        await httpClient.post('/employees', payload);
        showToast('تم إضافة الموظف', 'success');
      } else {
        await httpClient.put(`/employees/${(empModal as Employee).id}`, payload);
        showToast('تم تحديث الموظف', 'success');
      }
      setEmpModal(null);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ في الحفظ', 'error');
    } finally {
      setSavingEmp(false);
    }
  };

  const printReceipt = async (employee: Employee) => {
    const record = currentRecordFor(employee.id)?.payment_status === 'paid'
      ? currentRecordFor(employee.id)
      : lastPaidRecordFor(employee.id);
    if (!record) {
      showToast('لا يوجد راتب مدفوع لهذا الموظف بعد', 'error');
      return;
    }
    setPrintingId(employee.id);
    try {
      const deductions = await httpClient.get<SalaryAdvanceDeduction[]>(`/salary-records/${record.id}/advance-deductions`);
      const cashbox = cashboxes.find((c) => c.id === record.salary_cashbox_id);
      const html = buildSalaryReceiptHtml(employee, record, deductions, cashbox?.name ?? null);
      const result = await printLedgerStyleDocument(html, 'salary-receipt');
      if (result === 'error') showToast('تعذر تنفيذ الطباعة', 'error');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تنفيذ الطباعة', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Link to="/finance" style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af', textDecoration: 'none', width: 'fit-content', display: 'inline-block' }}>
        ← الذمم والمالية
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">الرواتب والسلف</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {MONTHS_AR[periodMonth - 1]} {periodYear}
          </p>
        </div>
        <div className="flex gap-2">
          {canManageEmployees && (
            <button type="button" className="toolbar-btn primary" onClick={openCreateEmp}>+ موظف جديد</button>
          )}
          <button type="button" className="toolbar-btn" onClick={() => void load()}>↻ تحديث</button>
        </div>
      </div>

      <div className="card p-0" style={{ border: '1px solid #9ca3af', borderRadius: '4px', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: '14px', color: '#6b7280' }}>جاري التحميل...</p>
        ) : employees.length === 0 ? (
          <p style={{ padding: '28px', textAlign: 'center', color: '#9ca3af' }}>لا يوجد موظفون بعد.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #9ca3af' }}>
                  <th style={thStyle('right')}>الموظف</th>
                  <th style={thStyle('right')}>الراتب الأساسي</th>
                  <th style={thStyle('right')}>حالة هذا الشهر</th>
                  <th style={thStyle('right')}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const current = currentRecordFor(e.id);
                  const paidThisMonth = current?.payment_status === 'paid';
                  const canPrint = paidThisMonth || !!lastPaidRecordFor(e.id);
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb', opacity: e.is_active ? 1 : 0.55 }}>
                      <td style={tdStyle('right')}>
                        <div style={{ fontWeight: 700 }}>{e.name}</div>
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>
                          {e.code}{e.position ? ` · ${e.position}` : ''}{!e.is_active ? ' · غير نشط' : ''}
                        </div>
                      </td>
                      <td style={tdStyle('right')}>{fmt(e.basic_salary)} {e.currency}</td>
                      <td style={tdStyle('right')}>
                        {paidThisMonth ? (
                          <span className="chip" style={{ background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700 }}>
                            مدفوع {current?.paid_at?.split('T')[0]}
                          </span>
                        ) : current ? (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700 }}>
                            معلّق هذا الشهر
                          </span>
                        ) : (
                          <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700 }}>
                            لم يُسلَّم بعد
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle('right'), position: 'relative' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {canManageSalaries && (
                            <button
                              type="button"
                              className="toolbar-btn primary"
                              style={{ fontSize: '12px', padding: '5px 10px' }}
                              disabled={paidThisMonth}
                              onClick={() => setPayEmployee(e)}
                            >
                              تسليم راتب
                            </button>
                          )}
                          <button
                            type="button"
                            className="toolbar-btn"
                            style={{ fontSize: '12px', padding: '5px 10px' }}
                            disabled={!canPrint || printingId === e.id}
                            onClick={() => void printReceipt(e)}
                          >
                            {printingId === e.id ? '...' : 'طباعة إيصال A5'}
                          </button>
                          <button
                            type="button"
                            title="إجراءات أخرى"
                            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', width: '26px', height: '26px', cursor: 'pointer', color: '#374151' }}
                            onClick={() => setActionsFor(actionsFor === e.id ? null : e.id)}
                          >
                            ⋯
                          </button>
                          {actionsFor === e.id && (
                            <div
                              style={{
                                position: 'absolute', insetInlineEnd: 0, top: '36px', background: '#fff',
                                border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                                zIndex: 30, minWidth: '160px', overflow: 'hidden',
                              }}
                            >
                              {canManageEmployees && (
                                <button type="button" className="dropdown-item" style={dropdownItemStyle} onClick={() => openEditEmp(e)}>
                                  تعديل بيانات الموظف
                                </button>
                              )}
                              {canManageAdvances && (
                                <button
                                  type="button"
                                  style={dropdownItemStyle}
                                  onClick={() => { setAdvanceEmployee(e); setActionsFor(null); }}
                                >
                                  سلفة جديدة
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {empModal && (
        <Modal title={empModal === 'create' ? 'موظف جديد' : 'تعديل موظف'} onClose={() => setEmpModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">الكود</label>
                <input className="form-input w-full" value={empForm.code} onChange={(e) => setEmpForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">الاسم</label>
                <input className="form-input w-full" value={empForm.name} onChange={(e) => setEmpForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">المنصب</label>
                <input className="form-input w-full" value={empForm.position} onChange={(e) => setEmpForm((f) => ({ ...f, position: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">نوع الراتب</label>
                <select className="form-input w-full" value={empForm.salaryType} onChange={(e) => setEmpForm((f) => ({ ...f, salaryType: e.target.value as 'monthly' | 'weekly' }))}>
                  {(['monthly', 'weekly'] as const).map((t) => <option key={t} value={t}>{SALARY_TYPE_AR[t]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">الراتب الأساسي</label>
                <input type="number" min="0" step="0.01" className="form-input w-full" value={empForm.basicSalary} onChange={(e) => setEmpForm((f) => ({ ...f, basicSalary: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label">العملة</label>
                <select className="form-input w-full" value={empForm.currency} onChange={(e) => setEmpForm((f) => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">تاريخ التعيين</label>
                <input type="date" className="form-input w-full" value={empForm.hireDate} onChange={(e) => setEmpForm((f) => ({ ...f, hireDate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">الهاتف</label>
                <input className="form-input w-full" value={empForm.phone} onChange={(e) => setEmpForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">ملاحظات</label>
              <textarea className="form-input w-full" rows={2} value={empForm.notes} onChange={(e) => setEmpForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={empForm.isActive} onChange={(e) => setEmpForm((f) => ({ ...f, isActive: e.target.checked }))} />
              نشط
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className="toolbar-btn" onClick={() => setEmpModal(null)}>إلغاء</button>
              <button type="button" className="toolbar-btn primary" onClick={() => void saveEmployee()} disabled={savingEmp || !empForm.code || !empForm.name}>
                {savingEmp ? 'جارٍ الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {payEmployee && (
        <SalaryPayPanel
          employee={payEmployee}
          currentRecord={currentRecordFor(payEmployee.id)}
          cashboxes={cashboxes}
          periodYear={periodYear}
          periodMonth={periodMonth}
          onClose={() => setPayEmployee(null)}
          onPaid={() => { setPayEmployee(null); void load(); }}
        />
      )}

      {advanceEmployee && (
        <AdvanceQuickModal
          employee={advanceEmployee}
          onClose={() => setAdvanceEmployee(null)}
          onSaved={() => { setAdvanceEmployee(null); void load(); }}
        />
      )}
    </div>
  );
}

function thStyle(align: 'right' | 'left'): React.CSSProperties {
  return { textAlign: align, padding: '9px 14px', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' };
}
function tdStyle(align: 'right' | 'left'): React.CSSProperties {
  return { textAlign: align, padding: '8px 14px', color: '#1f2937' };
}
const dropdownItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'right', padding: '9px 12px', fontSize: '13px',
  background: 'none', border: 'none', cursor: 'pointer', color: '#1f2937',
};

// ─── "تسليم راتب" panel ──────────────────────────────────────────────────────
// عند الضغط عليها: تُعرَض السلف المفتوحة على الموظف، وخانة لخصم مخالفات/أخرى
// (رقم واحد)، واختيار الصندوق، وزر "تأكيد استلام" واحد يقوم خلف الكواليس
// بإنشاء سجل الراتب (إن لم يكن موجوداً لهذا الشهر) أو تحديث خصمه، ثم دفعه —
// فيُخصَم تلقائياً من السلف المفتوحة بالترتيب (منطق paySalary الموجود) وتُنشأ
// سند دفع حقيقي من الصندوق المختار.

function SalaryPayPanel({
  employee, currentRecord, cashboxes, periodYear, periodMonth, onClose, onPaid,
}: {
  employee: Employee;
  currentRecord: SalaryRecord | null;
  cashboxes: BackendCashboxRecord[];
  periodYear: number;
  periodMonth: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { showToast } = useToast();
  const [openAdvances, setOpenAdvances] = useState<Advance[]>([]);
  const [loadingAdvances, setLoadingAdvances] = useState(true);
  const [manualDeduction, setManualDeduction] = useState(String(currentRecord?.manual_deductions ?? currentRecord?.deductions ?? 0));
  const [cashboxId, setCashboxId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    httpClient
      .get<Advance[]>(`/employee-advances?employeeId=${employee.id}`)
      .then((rows) => setOpenAdvances(rows.filter((a) => a.status === 'pending' || a.status === 'partially_repaid')))
      .catch(() => setOpenAdvances([]))
      .finally(() => setLoadingAdvances(false));
  }, [employee.id]);

  const eligibleCashboxes = cashboxes.filter((c) => c.is_active && c.currency_code === employee.currency);
  const totalOpenAdvancesUsd = openAdvances.reduce((sum, a) => sum + Number(a.outstanding_usd_equivalent ?? 0), 0);

  const confirmPay = async () => {
    if (!cashboxId) {
      showToast('اختاري الصندوق أولاً', 'error');
      return;
    }
    setSaving(true);
    try {
      let recordId = currentRecord?.id;
      const manualNum = Number(manualDeduction) || 0;
      if (!recordId) {
        const created = await httpClient.post<SalaryRecord>('/salary-records', {
          employeeId: employee.id,
          periodYear,
          periodMonth,
          basicAmount: parseFloat(employee.basic_salary) || 0,
          bonuses: 0,
          deductions: manualNum,
          currency: employee.currency,
        });
        recordId = created.id;
      } else if (manualNum !== Number(currentRecord?.manual_deductions ?? currentRecord?.deductions ?? 0)) {
        await httpClient.put(`/salary-records/${recordId}`, { deductions: manualNum });
      }
      await httpClient.post(`/salary-records/${recordId}/pay`, { cashboxId });
      showToast('تم تسليم الراتب بنجاح', 'success');
      onPaid();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تسليم الراتب', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`تسليم راتب — ${employee.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px' }}>
            <div style={{ fontSize: '11.5px', color: '#6b7280', fontWeight: 600 }}>الراتب الأساسي</div>
            <div style={{ fontSize: '16px', fontWeight: 800 }}>{fmt(employee.basic_salary)} {employee.currency}</div>
          </div>
          <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px' }}>
            <div style={{ fontSize: '11.5px', color: '#6b7280', fontWeight: 600 }}>السلف المفتوحة (ما يعادله بالدولار)</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: totalOpenAdvancesUsd > 0 ? '#b45309' : '#166534' }}>
              {loadingAdvances ? '...' : `${fmt(totalOpenAdvancesUsd)}$`}
            </div>
          </div>
        </div>

        {!loadingAdvances && openAdvances.length > 0 && (
          <div style={{ fontSize: '12.5px', color: '#374151', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px' }}>
            {openAdvances.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span>سلفة {a.advance_date?.split('T')[0]}</span>
                <span>{fmt(a.amount)} {a.currency} (متبقٍ {fmt(Number(a.amount) - Number(a.repaid_amount))})</span>
              </div>
            ))}
            <div style={{ marginTop: '4px', fontWeight: 700 }}>ستُخصَم هذه السلف تلقائياً من الراتب حسب الترتيب الزمني.</div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">خصم مخالفات / أخرى (اختياري)</label>
          <input type="number" min="0" step="0.01" className="form-input w-full" value={manualDeduction} onChange={(e) => setManualDeduction(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">الصندوق</label>
          <select className="form-input w-full" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
            <option value="">اختر...</option>
            {eligibleCashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {eligibleCashboxes.length === 0 && (
            <p style={{ color: '#dc2626', fontSize: '12.5px', marginTop: '4px' }}>لا يوجد صندوق نشط بعملة {employee.currency}.</p>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void confirmPay()} disabled={saving || !cashboxId}>
            {saving ? 'جارٍ التسليم...' : 'تأكيد استلام'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── "سلفة جديدة" quick modal ────────────────────────────────────────────────

function AdvanceQuickModal({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(employee.currency);
  const [advanceDate, setAdvanceDate] = useState(today());
  const [expectedRepay, setExpectedRepay] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const amt = Number(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      showToast('أدخلي مبلغاً صحيحاً أكبر من صفر', 'error');
      return;
    }
    setSaving(true);
    try {
      await httpClient.post('/employee-advances', {
        employeeId: employee.id,
        amount: amt,
        currency,
        advanceDate,
        expectedRepay: expectedRepay || undefined,
        notes: notes || undefined,
      });
      showToast('تم تسجيل السلفة', 'success');
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ السلفة', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`سلفة جديدة — ${employee.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label">المبلغ</label>
            <input type="number" min="0.01" step="0.01" className="form-input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">العملة</label>
            <select className="form-input w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label">تاريخ السلفة</label>
            <input type="date" className="form-input w-full" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">موعد السداد المتوقع (اختياري)</label>
            <input type="date" className="form-input w-full" value={expectedRepay} onChange={(e) => setExpectedRepay(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">ملاحظات</label>
          <textarea className="form-input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="toolbar-btn" onClick={onClose}>إلغاء</button>
          <button type="button" className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ السلفة'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
