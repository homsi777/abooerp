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
  pay_date: string;
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

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonthIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

const MAIN_CASHBOX_NAME = 'صندوق رئيسي';

/** كل أيام الخميس (أساس أجرة الأسبوعي) من أول الشهر الحالي حتى اليوم ضمناً. */
function thursdaysThisMonthUpToToday(year: number, month: number): string[] {
  const now = new Date();
  const lastDay = year === now.getFullYear() && month === now.getMonth() + 1 ? now : new Date(year, month, 0);
  const dates: string[] = [];
  const cursor = new Date(year, month - 1, 1);
  while (cursor.getMonth() === month - 1) {
    if (cursor.getDay() === 4 && cursor <= lastDay) {
      dates.push(toIsoDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10100, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: '10px', boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
          width: '100%', maxWidth: wide ? '880px' : '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: '16px' }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── "النسيم" — غلاف بطاقة تسليم الراتب ────────────────────────────────────

function BreezeShell({
  tag, title, sub, onClose, children, wide,
}: {
  tag: string;
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useRegisterEscape(onClose);
  return (
    <div className="breeze-overlay" onClick={onClose}>
      <div className={`breeze breeze-card ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="breeze-head">
          <button type="button" className="breeze-head-x" onClick={onClose}>✕</button>
          <div className="breeze-tag">{tag}</div>
          <h2>{title}</h2>
          <div className="breeze-sub">{sub}</div>
        </div>
        <div className={`breeze-body ${wide ? 'breeze-body-cols' : ''}`}>{children}</div>
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
  const [allAdvances, setAllAdvances] = useState<Advance[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const [empModal, setEmpModal] = useState<'create' | Employee | null>(null);
  const [empForm, setEmpForm] = useState<EmpForm>(emptyEmp);
  const [savingEmp, setSavingEmp] = useState(false);

  const [payEmployee, setPayEmployee] = useState<Employee | null>(null);
  const [weeklyPayEmployee, setWeeklyPayEmployee] = useState<Employee | null>(null);
  const [advanceEmployee, setAdvanceEmployee] = useState<Employee | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);

  const now = new Date();
  const periodYear = now.getFullYear();
  const periodMonth = now.getMonth() + 1;

  const load = async () => {
    setLoading(true);
    try {
      const [emps, sals, advs, boxes] = await Promise.all([
        httpClient.get<Employee[]>('/employees?includeInactive=true'),
        httpClient.get<SalaryRecord[]>('/salary-records'),
        httpClient.get<Advance[]>('/employee-advances'),
        phase3FinanceGateway.cashbox.listMaster(),
      ]);
      setEmployees(emps);
      setAllSalaries(sals);
      setAllAdvances(advs);
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

  // سجل راتب موظف لتاريخ دفعة محدَّد هذا الشهر (ثابت = أول الشهر للراتب
  // الشهري، أو تاريخ الأسبوع نفسه للراتب الأسبوعي — فقد يوجد أكثر من سجل
  // واحد للموظف الأسبوعي ضمن الشهر نفسه، واحد لكل أسبوع).
  const recordForPayDate = (employeeId: string, payDate: string): SalaryRecord | null =>
    allSalaries.find(
      (s) =>
        s.employee_id === employeeId &&
        s.period_year === periodYear &&
        s.period_month === periodMonth &&
        s.pay_date?.split('T')[0] === payDate &&
        s.payment_status !== 'cancelled',
    ) ?? null;

  const weekDatesThisMonth = thursdaysThisMonthUpToToday(periodYear, periodMonth);

  const currentRecordFor = (employee: Employee): SalaryRecord | null =>
    employee.salary_type === 'weekly'
      ? recordForPayDate(employee.id, weekDatesThisMonth[weekDatesThisMonth.length - 1] ?? startOfMonthIso(periodYear, periodMonth))
      : recordForPayDate(employee.id, startOfMonthIso(periodYear, periodMonth));

  /** عدد أسابيع الشهر (حتى اليوم) التي دُفعت فعلياً — للراتب الأسبوعي فقط. */
  const weeksPaidCountFor = (employeeId: string): number =>
    weekDatesThisMonth.filter((d) => recordForPayDate(employeeId, d)?.payment_status === 'paid').length;

  const lastPaidRecordFor = (employeeId: string): SalaryRecord | null => {
    const paid = allSalaries.filter((s) => s.employee_id === employeeId && s.payment_status === 'paid');
    if (!paid.length) return null;
    return paid.reduce((latest, s) => (s.pay_date > latest.pay_date ? s : latest), paid[0]!);
  };

  /** مجموع السلف المفتوحة (معلّقة أو مسدَّدة جزئياً) لموظف، مجمَّعة حسب العملة
   *  (نادراً ما يملك موظف سلفاً بأكثر من عملة، لكن نعرضها بأمان لو حصل). */
  const openAdvancesByCurrencyFor = (employeeId: string): { currency: string; amount: number }[] => {
    const byCurrency = new Map<string, number>();
    for (const a of allAdvances) {
      if (a.employee_id !== employeeId || (a.status !== 'pending' && a.status !== 'partially_repaid')) continue;
      const remaining = Math.max(0, Number(a.amount) - Number(a.repaid_amount));
      if (remaining <= 0) continue;
      byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + remaining);
    }
    return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount }));
  };

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
    const current = currentRecordFor(employee);
    const record = current?.payment_status === 'paid' ? current : lastPaidRecordFor(employee.id);
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
                  <th style={thStyle('right')}>السلف</th>
                  <th style={thStyle('right')}>حالة هذا الشهر</th>
                  <th style={thStyle('right')}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const isWeekly = e.salary_type === 'weekly';
                  const current = currentRecordFor(e);
                  const paidThisMonth = current?.payment_status === 'paid';
                  const canPrint = paidThisMonth || !!lastPaidRecordFor(e.id);
                  const weeksPaid = isWeekly ? weeksPaidCountFor(e.id) : 0;
                  const weeksExpected = isWeekly ? weekDatesThisMonth.length : 0;
                  const weeksBehind = isWeekly && weeksPaid < weeksExpected;
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb', opacity: e.is_active ? 1 : 0.55 }}>
                      <td style={tdStyle('right')}>
                        <div style={{ fontWeight: 700 }}>{e.name}</div>
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>
                          {e.code}{e.position ? ` · ${e.position}` : ''}{!e.is_active ? ' · غير نشط' : ''}
                        </div>
                      </td>
                      <td style={tdStyle('right')}>
                        {fmt(e.basic_salary)} {e.currency}
                        {isWeekly && <span style={{ fontSize: '11px', color: '#6b7280' }}> / أسبوع</span>}
                      </td>
                      <td style={tdStyle('right')}>
                        {(() => {
                          const advances = openAdvancesByCurrencyFor(e.id);
                          return advances.length === 0 ? (
                            <span style={{ color: '#9ca3af', fontSize: '12px' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {advances.map(({ currency, amount }) => (
                                <span
                                  key={currency}
                                  style={{
                                    background: '#fff3db', color: '#b45309', padding: '3px 10px',
                                    borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, width: 'fit-content',
                                  }}
                                >
                                  {fmt(amount)} {currency}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={tdStyle('right')}>
                        {isWeekly ? (
                          <span
                            style={{
                              background: weeksBehind ? '#fef3c7' : '#dcfce7',
                              color: weeksBehind ? '#b45309' : '#15803d',
                              padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700,
                            }}
                          >
                            {weeksPaid}/{weeksExpected} أسابيع مدفوعة
                          </span>
                        ) : paidThisMonth ? (
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
                              disabled={isWeekly ? !weeksBehind : paidThisMonth}
                              onClick={() => (isWeekly ? setWeeklyPayEmployee(e) : setPayEmployee(e))}
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
          currentRecord={currentRecordFor(payEmployee)}
          cashboxes={cashboxes}
          periodYear={periodYear}
          periodMonth={periodMonth}
          payDate={startOfMonthIso(periodYear, periodMonth)}
          onClose={() => setPayEmployee(null)}
          onPaid={() => { setPayEmployee(null); void load(); }}
        />
      )}

      {weeklyPayEmployee && (
        <WeeklySalaryPayModal
          employee={weeklyPayEmployee}
          weekDates={weekDatesThisMonth}
          cashboxes={cashboxes}
          periodYear={periodYear}
          periodMonth={periodMonth}
          onClose={() => setWeeklyPayEmployee(null)}
          onChanged={() => void load()}
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
  employee, currentRecord, cashboxes, periodYear, periodMonth, payDate, onClose, onPaid,
}: {
  employee: Employee;
  currentRecord: SalaryRecord | null;
  cashboxes: BackendCashboxRecord[];
  periodYear: number;
  periodMonth: number;
  payDate: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { showToast } = useToast();
  const [openAdvances, setOpenAdvances] = useState<Advance[]>([]);
  const [loadingAdvances, setLoadingAdvances] = useState(true);
  const [selectedAdvanceIds, setSelectedAdvanceIds] = useState<Set<string>>(new Set());
  const [manualDeduction, setManualDeduction] = useState(String(currentRecord?.manual_deductions ?? currentRecord?.deductions ?? 0));
  const [cashboxId, setCashboxId] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleAdvance = (advanceId: string) => {
    setSelectedAdvanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(advanceId)) next.delete(advanceId); else next.add(advanceId);
      return next;
    });
  };

  const isForeignCurrency = employee.currency?.trim().toUpperCase() !== 'USD';
  const [payInUsd, setPayInUsd] = useState(false);
  const [usdRate, setUsdRate] = useState(''); // كم من عملة الموظف (مثلاً ل.س) يساوي 1 دولار

  useEffect(() => {
    httpClient
      .get<Advance[]>(`/employee-advances?employeeId=${employee.id}`)
      .then((rows) => setOpenAdvances(rows.filter((a) => a.status === 'pending' || a.status === 'partially_repaid')))
      .catch(() => setOpenAdvances([]))
      .finally(() => setLoadingAdvances(false));
  }, [employee.id]);

  // تعبئة سعر صرف مبدئي من سعر اليوم المسجَّل في النظام — قابل للتعديل يدوياً
  // عبر الحقل مباشرة (المحاسبة قد تعتمد سعراً تقريبياً مختلفاً عن الرسمي).
  useEffect(() => {
    if (!isForeignCurrency) return;
    httpClient
      .get<{ rate: number }>(`/advance-usd-quote?amount=1&currency=${employee.currency}&date=${today()}`)
      .then((q) => { if (q.rate > 0) setUsdRate(String(Number((1 / q.rate).toFixed(2)))); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCashboxes = cashboxes.filter((c) => c.is_active);
  const targetCurrency = payInUsd ? 'USD' : employee.currency?.trim().toUpperCase();
  const sameCurrencyCashboxes = activeCashboxes.filter((c) => c.currency_code?.trim().toUpperCase() === targetCurrency);
  // لو لم يوجد صندوق بنفس العملة المستهدَفة (حالة إعداد غير مكتملة)، نعرض كل
  // الصناديق النشطة بدل تفريغ القائمة بالكامل — الخادم يرفض أي عدم تطابق
  // عملة فعلي عند الدفع، فلا خطر محاسبي من عرضها جميعاً هنا.
  const eligibleCashboxes = sameCurrencyCashboxes.length > 0 ? sameCurrencyCashboxes : activeCashboxes;
  const currencyMismatchFallback = sameCurrencyCashboxes.length === 0 && activeCashboxes.length > 0;
  const totalOpenAdvancesUsd = openAdvances.reduce((sum, a) => sum + Number(a.outstanding_usd_equivalent ?? 0), 0);
  const totalSelectedAdvancesUsd = openAdvances
    .filter((a) => selectedAdvanceIds.has(a.id))
    .reduce((sum, a) => sum + Number(a.outstanding_usd_equivalent ?? 0), 0);

  // صندوق افتراضي: "صندوق رئيسي" إن وُجد ضمن الصناديق المؤهَّلة، ليوفّر على
  // المحاسب اختياره يدوياً كل مرة — تبقى بقية الصناديق متاحة للاختيار.
  useEffect(() => {
    if (cashboxId) return;
    const main = eligibleCashboxes.find((c) => c.name?.trim() === MAIN_CASHBOX_NAME);
    if (main) setCashboxId(main.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleCashboxes.length, payInUsd]);

  const usdRateNum = Number(usdRate) || 0;
  const convertedUsdAmount = usdRateNum > 0 ? Number(((parseFloat(employee.basic_salary) || 0) / usdRateNum).toFixed(2)) : 0;

  const confirmPay = async () => {
    if (!cashboxId) {
      showToast('اختاري الصندوق أولاً', 'error');
      return;
    }
    if (payInUsd && usdRateNum <= 0) {
      showToast('أدخلي سعر صرف صحيحاً أكبر من صفر', 'error');
      return;
    }
    setSaving(true);
    try {
      const payCurrency = payInUsd ? 'USD' : employee.currency;
      const payBasicAmount = payInUsd ? convertedUsdAmount : (parseFloat(employee.basic_salary) || 0);
      const manualNum = Number(manualDeduction) || 0;

      let recordId = currentRecord?.id;
      // سجل سابق من محاولة فاشلة (عملة أو مبلغ مختلف عن المطلوب الآن) — يُحذَف
      // ويُعاد إنشاؤه بالقيم الصحيحة؛ لم يُدفع فعلياً فلا خطر محاسبي من ذلك.
      if (recordId && (currentRecord!.currency !== payCurrency || Math.abs(parseFloat(currentRecord!.basic_amount) - payBasicAmount) > 0.004)) {
        await httpClient.delete(`/salary-records/${recordId}`);
        recordId = undefined;
      }
      if (!recordId) {
        const created = await httpClient.post<SalaryRecord>('/salary-records', {
          employeeId: employee.id,
          periodYear,
          periodMonth,
          payDate,
          basicAmount: payBasicAmount,
          bonuses: 0,
          deductions: manualNum,
          currency: payCurrency,
        });
        recordId = created.id;
      } else if (manualNum !== Number(currentRecord?.manual_deductions ?? currentRecord?.deductions ?? 0)) {
        await httpClient.put(`/salary-records/${recordId}`, { deductions: manualNum });
      }
      await httpClient.post(`/salary-records/${recordId}/pay`, { cashboxId, advanceIds: Array.from(selectedAdvanceIds) });
      showToast('تم تسليم الراتب بنجاح', 'success');
      onPaid();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تسليم الراتب', 'error');
    } finally {
      setSaving(false);
    }
  };

  const estimatedNet = Math.max(
    0,
    (payInUsd ? convertedUsdAmount : (parseFloat(employee.basic_salary) || 0)) - (Number(manualDeduction) || 0) - totalSelectedAdvancesUsd,
  );

  return (
    <BreezeShell tag="تسليم راتب" title={employee.name} sub={`${employee.code}${employee.position ? ` · ${employee.position}` : ''}`} onClose={onClose} wide>
      <div className="breeze-col">
        <div className="breeze-tiles">
          <div className="breeze-tile">
            <div className="breeze-tile-label">الراتب الأساسي</div>
            <div className="breeze-tile-value">
              {fmt(employee.basic_salary)} {employee.currency}
              {payInUsd && usdRateNum > 0 && <span style={{ fontSize: '12px', color: 'var(--breeze-accent)', fontWeight: 700 }}> = {fmt(convertedUsdAmount)}$</span>}
            </div>
          </div>
          <div className="breeze-tile">
            <div className="breeze-tile-label">السلف المفتوحة (كلها)</div>
            <div className={`breeze-tile-value ${totalOpenAdvancesUsd > 0 ? 'warn' : 'good'}`}>
              {loadingAdvances ? '...' : `${fmt(totalOpenAdvancesUsd)}$`}
            </div>
          </div>
        </div>

        {isForeignCurrency && (
          <div className="breeze-fxrow">
            <label className="breeze-fx-toggle">
              <input type="checkbox" checked={payInUsd} onChange={(e) => { setPayInUsd(e.target.checked); setCashboxId(''); }} />
              تحويل الراتب إلى دولار والدفع من صندوق دولار
            </label>
            {payInUsd && (
              <div className="breeze-fx-detail">
                <div className="breeze-field">
                  <label>✏️ سعر الصرف (1$ = ؟ {employee.currency})</label>
                  <input type="number" min="0.01" step="0.01" dir="ltr" className="breeze-input" value={usdRate} onChange={(e) => setUsdRate(e.target.value)} />
                </div>
                <div className="breeze-fx-result">= {fmt(convertedUsdAmount)}$</div>
              </div>
            )}
          </div>
        )}

        <div className="breeze-field">
          <label>خصم مخالفات / أخرى (اختياري)</label>
          <input type="number" min="0" step="0.01" dir="ltr" className="breeze-input" value={manualDeduction} onChange={(e) => setManualDeduction(e.target.value)} />
        </div>

        <div className="breeze-field">
          <label>الصندوق</label>
          <select className="breeze-select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
            <option value="">اختر...</option>
            {eligibleCashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {eligibleCashboxes.length === 0 && (
            <p style={{ color: '#dc2626', fontSize: '12.5px', marginTop: '4px' }}>لا يوجد أي صندوق نشط في النظام حالياً.</p>
          )}
          {currencyMismatchFallback && (
            <p style={{ color: 'var(--breeze-warn)', fontSize: '12.5px', marginTop: '4px' }}>
              ⚠ لا يوجد صندوق بعملة {targetCurrency} تحديداً — القائمة تعرض كل الصناديق النشطة، تأكدي من اختيار صندوق بهذه العملة فعلاً.
            </p>
          )}
        </div>

        <div className="breeze-net">
          <span className="breeze-net-label">الصافي المقدَّر للاستلام</span>
          <span className="breeze-net-value">{fmt(estimatedNet)} {payInUsd ? 'USD' : employee.currency}</span>
        </div>

        <div className="breeze-actions">
          <button type="button" className="breeze-btn-cancel" onClick={onClose}>إلغاء</button>
          <button type="button" className="breeze-btn-confirm" onClick={() => void confirmPay()} disabled={saving || !cashboxId}>
            {saving ? 'جارٍ التسليم...' : 'تأكيد استلام'}
          </button>
        </div>
      </div>

      <div className="breeze-col">
        <div className="breeze-section">
          <div className="breeze-section-head">
            <span>سلف الموظف المفتوحة</span>
            {!loadingAdvances && openAdvances.length > 0 && <span className="breeze-section-hint">حدّدي السلف التي تريدين خصمها الآن</span>}
          </div>
          {loadingAdvances ? (
            <p className="breeze-note">جاري التحميل...</p>
          ) : openAdvances.length === 0 ? (
            <p className="breeze-note">لا توجد سلف مفتوحة لهذا الموظف.</p>
          ) : (
            <>
              {openAdvances.map((a) => {
                const checked = selectedAdvanceIds.has(a.id);
                return (
                  <label key={a.id} className={`breeze-adv ${checked ? 'checked' : ''}`}>
                    <span className="breeze-adv-label">
                      <input type="checkbox" checked={checked} onChange={() => toggleAdvance(a.id)} />
                      سلفة {a.advance_date?.split('T')[0]}
                    </span>
                    <span className="breeze-adv-amt">
                      {fmt(Number(a.amount) - Number(a.repaid_amount))} {a.currency}
                      <span className="breeze-adv-orig"> (أصل {fmt(a.amount)})</span>
                    </span>
                  </label>
                );
              })}
              <div className="breeze-selsum">
                <span>سيُخصَم من هذا الراتب: {fmt(totalSelectedAdvancesUsd)}$</span>
                {selectedAdvanceIds.size === 0 && <span className="muted">لم تُحدَّد أي سلفة بعد</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </BreezeShell>
  );
}

// ─── "تسليم راتب" للموظف الأسبوعي — عدة أسابيع ضمن الشهر نفسه ──────────────────
// كل خميس من الشهر الحالي حتى اليوم له سطر مستقل: إن لم يُدفَع بعد يظهر زر
// "تسليم" خاص به (نفس منطق SalaryPayPanel لكن لتاريخ محدَّد)، مع زر إجمالي
// "دفع كل الأسابيع المتأخرة" يُسدِّد كل الأسابيع غير المدفوعة بالتتابع
// (الأقدم أولاً) بنفس الصندوق والخصم — ليُستخدَم للتعويض عن أسابيع فائتة.

function WeeklySalaryPayModal({
  employee, weekDates, cashboxes, periodYear, periodMonth, onClose, onChanged,
}: {
  employee: Employee;
  weekDates: string[];
  cashboxes: BackendCashboxRecord[];
  periodYear: number;
  periodMonth: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [openAdvances, setOpenAdvances] = useState<Advance[]>([]);
  const [selectedAdvanceIds, setSelectedAdvanceIds] = useState<Set<string>>(new Set());
  const [manualDeduction, setManualDeduction] = useState('0');
  const [cashboxId, setCashboxId] = useState('');
  const [payingDate, setPayingDate] = useState<string | null>(null);
  const [bulkPaying, setBulkPaying] = useState(false);

  const toggleAdvance = (advanceId: string) => {
    setSelectedAdvanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(advanceId)) next.delete(advanceId); else next.add(advanceId);
      return next;
    });
  };

  const isForeignCurrency = employee.currency?.trim().toUpperCase() !== 'USD';
  const [payInUsd, setPayInUsd] = useState(false);
  const [usdRate, setUsdRate] = useState('');

  const loadRecords = async () => {
    setLoadingRecords(true);
    try {
      const rows = await httpClient.get<SalaryRecord[]>(
        `/salary-records?employeeId=${employee.id}&year=${periodYear}&month=${periodMonth}`,
      );
      setRecords(rows);
    } catch {
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    void loadRecords();
    httpClient
      .get<Advance[]>(`/employee-advances?employeeId=${employee.id}`)
      .then((rows) => setOpenAdvances(rows.filter((a) => a.status === 'pending' || a.status === 'partially_repaid')))
      .catch(() => setOpenAdvances([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  useEffect(() => {
    if (!isForeignCurrency) return;
    httpClient
      .get<{ rate: number }>(`/advance-usd-quote?amount=1&currency=${employee.currency}&date=${today()}`)
      .then((q) => { if (q.rate > 0) setUsdRate(String(Number((1 / q.rate).toFixed(2)))); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCashboxes = cashboxes.filter((c) => c.is_active);
  const targetCurrency = payInUsd ? 'USD' : employee.currency?.trim().toUpperCase();
  const sameCurrencyCashboxes = activeCashboxes.filter((c) => c.currency_code?.trim().toUpperCase() === targetCurrency);
  const eligibleCashboxes = sameCurrencyCashboxes.length > 0 ? sameCurrencyCashboxes : activeCashboxes;
  const currencyMismatchFallback = sameCurrencyCashboxes.length === 0 && activeCashboxes.length > 0;
  const totalOpenAdvancesUsd = openAdvances.reduce((sum, a) => sum + Number(a.outstanding_usd_equivalent ?? 0), 0);
  const totalSelectedAdvancesUsd = openAdvances
    .filter((a) => selectedAdvanceIds.has(a.id))
    .reduce((sum, a) => sum + Number(a.outstanding_usd_equivalent ?? 0), 0);

  useEffect(() => {
    if (cashboxId) return;
    const main = eligibleCashboxes.find((c) => c.name?.trim() === MAIN_CASHBOX_NAME);
    if (main) setCashboxId(main.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleCashboxes.length, payInUsd]);

  const usdRateNum = Number(usdRate) || 0;
  const convertedUsdAmount = usdRateNum > 0 ? Number(((parseFloat(employee.basic_salary) || 0) / usdRateNum).toFixed(2)) : 0;

  const recordFor = (date: string) => records.find((r) => r.pay_date?.split('T')[0] === date && r.payment_status !== 'cancelled') ?? null;

  const payWeek = async (date: string) => {
    const existing = recordFor(date);
    const payCurrency = payInUsd ? 'USD' : employee.currency;
    const payBasicAmount = payInUsd ? convertedUsdAmount : (parseFloat(employee.basic_salary) || 0);
    const manualNum = Number(manualDeduction) || 0;

    let recordId = existing?.id;
    if (recordId && (existing!.currency !== payCurrency || Math.abs(parseFloat(existing!.basic_amount) - payBasicAmount) > 0.004)) {
      await httpClient.delete(`/salary-records/${recordId}`);
      recordId = undefined;
    }
    if (!recordId) {
      const created = await httpClient.post<SalaryRecord>('/salary-records', {
        employeeId: employee.id,
        periodYear,
        periodMonth,
        payDate: date,
        basicAmount: payBasicAmount,
        bonuses: 0,
        deductions: manualNum,
        currency: payCurrency,
      });
      recordId = created.id;
    } else if (manualNum !== Number(existing?.manual_deductions ?? existing?.deductions ?? 0)) {
      await httpClient.put(`/salary-records/${recordId}`, { deductions: manualNum });
    }
    await httpClient.post(`/salary-records/${recordId}/pay`, { cashboxId, advanceIds: Array.from(selectedAdvanceIds) });
  };

  const handlePayWeek = async (date: string) => {
    if (!cashboxId) { showToast('اختاري الصندوق أولاً', 'error'); return; }
    if (payInUsd && usdRateNum <= 0) { showToast('أدخلي سعر صرف صحيحاً أكبر من صفر', 'error'); return; }
    setPayingDate(date);
    try {
      await payWeek(date);
      await loadRecords();
      onChanged();
      showToast(`تم تسليم راتب أسبوع ${date}`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تسليم الراتب', 'error');
    } finally {
      setPayingDate(null);
    }
  };

  const unpaidDates = weekDates.filter((d) => recordFor(d)?.payment_status !== 'paid');

  const handlePayAllOverdue = async () => {
    if (!cashboxId) { showToast('اختاري الصندوق أولاً', 'error'); return; }
    if (payInUsd && usdRateNum <= 0) { showToast('أدخلي سعر صرف صحيحاً أكبر من صفر', 'error'); return; }
    setBulkPaying(true);
    try {
      for (const date of unpaidDates) {
        await payWeek(date);
      }
      await loadRecords();
      onChanged();
      showToast(`تم تسليم ${unpaidDates.length} أسبوع متأخر`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تسليم كل الأسابيع — راجعي حالة كل أسبوع', 'error');
      await loadRecords();
    } finally {
      setBulkPaying(false);
    }
  };

  return (
    <BreezeShell tag="تسليم راتب أسبوعي" title={employee.name} sub={`${employee.code}${employee.position ? ` · ${employee.position}` : ''}`} onClose={onClose} wide>
      <div className="breeze-col">
        <div className="breeze-tiles">
          <div className="breeze-tile">
            <div className="breeze-tile-label">أجرة الأسبوع</div>
            <div className="breeze-tile-value">
              {fmt(employee.basic_salary)} {employee.currency}
              {payInUsd && usdRateNum > 0 && <span style={{ fontSize: '12px', color: 'var(--breeze-accent)', fontWeight: 700 }}> = {fmt(convertedUsdAmount)}$</span>}
            </div>
          </div>
          <div className="breeze-tile">
            <div className="breeze-tile-label">السلف المفتوحة (بالدولار)</div>
            <div className={`breeze-tile-value ${totalOpenAdvancesUsd > 0 ? 'warn' : 'good'}`}>{fmt(totalOpenAdvancesUsd)}$</div>
          </div>
        </div>

        {isForeignCurrency && (
          <div className="breeze-fxrow">
            <label className="breeze-fx-toggle">
              <input type="checkbox" checked={payInUsd} onChange={(e) => { setPayInUsd(e.target.checked); setCashboxId(''); }} />
              تحويل الراتب إلى دولار والدفع من صندوق دولار
            </label>
            {payInUsd && (
              <div className="breeze-fx-detail">
                <div className="breeze-field">
                  <label>✏️ سعر الصرف (1$ = ؟ {employee.currency})</label>
                  <input type="number" min="0.01" step="0.01" dir="ltr" className="breeze-input" value={usdRate} onChange={(e) => setUsdRate(e.target.value)} />
                </div>
                <div className="breeze-fx-result">= {fmt(convertedUsdAmount)}$</div>
              </div>
            )}
          </div>
        )}

        <div className="breeze-field">
          <label>خصم مخالفات / أخرى لكل أسبوع يُسلَّم الآن (اختياري)</label>
          <input type="number" min="0" step="0.01" dir="ltr" className="breeze-input" value={manualDeduction} onChange={(e) => setManualDeduction(e.target.value)} />
        </div>

        <div className="breeze-field">
          <label>الصندوق</label>
          <select className="breeze-select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
            <option value="">اختر...</option>
            {eligibleCashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {currencyMismatchFallback && (
            <p style={{ color: 'var(--breeze-warn)', fontSize: '12.5px', marginTop: '4px' }}>
              ⚠ لا يوجد صندوق بعملة {targetCurrency} تحديداً — تأكدي من اختيار صندوق بهذه العملة فعلاً.
            </p>
          )}
        </div>

        <div className="breeze-actions">
          <button type="button" className="breeze-btn-cancel" onClick={onClose}>إغلاق</button>
          {unpaidDates.length > 1 ? (
            <button type="button" className="breeze-btn-confirm" onClick={() => void handlePayAllOverdue()} disabled={bulkPaying || !cashboxId}>
              {bulkPaying ? 'جارٍ تسليم الكل...' : `تسليم كل الأسابيع المتأخرة (${unpaidDates.length})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="breeze-col">
        {openAdvances.length > 0 && (
          <div className="breeze-section">
            <div className="breeze-section-head">
              <span>سلف الموظف المفتوحة</span>
              <span className="breeze-section-hint">حدّدي السلف لخصمها من كل أسبوع يُسلَّم الآن</span>
            </div>
            {openAdvances.map((a) => {
              const checked = selectedAdvanceIds.has(a.id);
              return (
                <label key={a.id} className={`breeze-adv ${checked ? 'checked' : ''}`}>
                  <span className="breeze-adv-label">
                    <input type="checkbox" checked={checked} onChange={() => toggleAdvance(a.id)} />
                    سلفة {a.advance_date?.split('T')[0]}
                  </span>
                  <span className="breeze-adv-amt">
                    {fmt(Number(a.amount) - Number(a.repaid_amount))} {a.currency}
                    <span className="breeze-adv-orig"> (أصل {fmt(a.amount)})</span>
                  </span>
                </label>
              );
            })}
            <div className="breeze-selsum">
              <span>سيُخصَم من كل أسبوع يُسلَّم الآن: {fmt(totalSelectedAdvancesUsd)}$</span>
              {selectedAdvanceIds.size === 0 && <span className="muted">لم تُحدَّد أي سلفة بعد</span>}
            </div>
          </div>
        )}

        <div className="breeze-section">
          <div className="breeze-section-head"><span>أسابيع {MONTHS_AR[periodMonth - 1]}</span></div>
          {loadingRecords ? (
            <p className="breeze-note">جاري التحميل...</p>
          ) : (
            <div className="breeze-weeks">
              {weekDates.map((date) => {
                const rec = recordFor(date);
                const paid = rec?.payment_status === 'paid';
                return (
                  <div key={date} className="breeze-week">
                    <span>
                      أسبوع {date}
                      {paid && <span className="breeze-week-status"> — مدفوع</span>}
                    </span>
                    <button
                      type="button"
                      className={`breeze-week-btn ${paid ? 'ghost' : ''}`}
                      disabled={paid || payingDate === date || bulkPaying || !cashboxId}
                      onClick={() => void handlePayWeek(date)}
                    >
                      {payingDate === date ? 'جارٍ...' : paid ? 'مدفوع' : 'تسليم'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BreezeShell>
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
