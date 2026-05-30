import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { useRegisterEscape } from '../../context/EscapeRegistryContext';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

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
  employee_salary_type?: 'monthly' | 'weekly';
}

interface SalaryAdvanceDeduction {
  id: string;
  salary_record_id: string;
  employee_advance_id: string;
  advance_date: string;
  original_amount: string;
  repaid_amount: string;
  remaining_balance: string;
  advance_status: string;
  deducted_amount: string;
  currency: string;
  deducted_salary_amount: string;
  salary_currency: string;
  created_at: string;
}

interface Advance {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  amount: string;
  repaid_amount: string;
  currency: string;
  exchange_rate_to_usd?: string;
  amount_usd_equivalent?: string;
  repaid_usd_equivalent?: string;
  outstanding_usd_equivalent?: string;
  advance_date: string;
  expected_repay: string | null;
  status: 'pending' | 'partially_repaid' | 'repaid' | 'cancelled';
  notes: string | null;
}

interface Summary {
  salary: {
    total_records: string;
    pending: string;
    paid: string;
    total_net: string;
    total_paid: string;
  };
  advances: {
    open_advances: string;
    outstanding: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const SALARY_STATUS_AR: Record<string, string> = {
  pending: 'معلق',
  paid: 'مدفوع',
  cancelled: 'ملغى',
};

const SALARY_STATUS_CSS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const ADVANCE_STATUS_AR: Record<string, string> = {
  pending: 'معلقة',
  partially_repaid: 'مسددة جزئياً',
  repaid: 'مسددة',
  cancelled: 'ملغاة',
};

const ADVANCE_STATUS_CSS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  partially_repaid: 'bg-blue-100 text-blue-800',
  repaid: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const CURRENCIES = ['USD', 'SYP', 'SAR', 'AED', 'EUR', 'TRY'];

const SALARY_TYPE_AR: Record<'monthly' | 'weekly', string> = {
  monthly: 'شهري',
  weekly: 'أسبوعي',
};

function fmt(n: string | number): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return isNaN(v) ? '0' : v.toLocaleString('ar-SY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

// ─── Empty forms ─────────────────────────────────────────────────────────────

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

type SalaryForm = {
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  basicAmount: number;
  bonuses: number;
  deductions: number;
  currency: string;
  paymentStatus: 'pending' | 'paid' | 'cancelled';
  notes: string;
};

type AdvanceForm = {
  employeeId: string;
  amount: number;
  currency: string;
  advanceDate: string;
  expectedRepay: string;
  notes: string;
};

const emptyEmp: EmpForm = {
  code: '', name: '', position: '', basicSalary: 0,
  currency: 'USD', salaryType: 'monthly', hireDate: '', phone: '', notes: '',
  isActive: true,
};

const emptySalary = (employees: Employee[]): SalaryForm => ({
  employeeId: employees[0]?.id ?? '',
  periodYear: new Date().getFullYear(),
  periodMonth: new Date().getMonth() + 1,
  basicAmount: employees[0] ? parseFloat(employees[0].basic_salary) : 0,
  bonuses: 0,
  deductions: 0,
  currency: employees[0]?.currency ?? 'USD',
  paymentStatus: 'pending',
  notes: '',
});

const emptyAdv = (employees: Employee[]): AdvanceForm => ({
  employeeId: employees[0]?.id ?? '',
  amount: 0,
  currency: employees[0]?.currency ?? 'USD',
  advanceDate: today(),
  expectedRepay: '',
  notes: '',
});

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

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'employees' | 'salaries' | 'advances';

export default function FinanceSalaries() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  // data
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  // loading
  const [loadingEmp, setLoadingEmp] = useState(false);
  const [loadingSal, setLoadingSal] = useState(false);
  const [loadingAdv, setLoadingAdv] = useState(false);
  const [saving, setSaving] = useState(false);

  // filters
  const [empSearch, setEmpSearch] = useState('');
  const [salYear, setSalYear] = useState(new Date().getFullYear());
  const [salMonth, setSalMonth] = useState(new Date().getMonth() + 1);
  const [salEmpFilter, setSalEmpFilter] = useState('');
  const [advEmpFilter, setAdvEmpFilter] = useState('');
  const [advStatusFilter, setAdvStatusFilter] = useState('');

  // modals
  const [empModal, setEmpModal] = useState<null | 'create' | Employee>(null);
  const [salModal, setSalModal] = useState<null | 'create' | SalaryRecord>(null);
  const [advModal, setAdvModal] = useState<null | 'create' | Advance>(null);
  const [salaryPayModal, setSalaryPayModal] = useState<SalaryRecord | null>(null);
  const [salaryPayCashboxId, setSalaryPayCashboxId] = useState('');
  const [payingSalary, setPayingSalary] = useState(false);
  const [salaryDetails, setSalaryDetails] = useState<null | { salary: SalaryRecord; deductions: SalaryAdvanceDeduction[] }>(null);
  const [salaryDetailsLoading, setSalaryDetailsLoading] = useState(false);

  const [dossierEmployeeId, setDossierEmployeeId] = useState<string | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierData, setDossierData] = useState<null | {
    employee: Employee;
    salaries: SalaryRecord[];
    advances: Advance[];
    openAdvancesUsd: number;
  }>(null);

  const [advUsdQuote, setAdvUsdQuote] = useState<null | { rate: number; usdEquivalent: number }>(null);
  const [advUsdQuoteFailed, setAdvUsdQuoteFailed] = useState(false);

  // forms
  const [empForm, setEmpForm] = useState<EmpForm>(emptyEmp);
  const [salForm, setSalForm] = useState<SalaryForm>(() => emptySalary([]));
  const [advForm, setAdvForm] = useState<AdvanceForm>(() => emptyAdv([]));

  /** مجموع السلف المفتوحة للموظف — يُضاف تلقائياً للخصومات عند إنشاء راتب جديد (الخادم). */
  const [salaryOpenAdvancesHint, setSalaryOpenAdvancesHint] = useState(0);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadEmployees = useCallback(async () => {
    setLoadingEmp(true);
    try {
      const rows = await httpClient.get<Employee[]>('/employees?includeInactive=true');
      setEmployees(rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الموظفين', 'error');
    } finally {
      setLoadingEmp(false);
    }
  }, [showToast]);

  const loadSalaries = useCallback(async () => {
    setLoadingSal(true);
    try {
      const params = new URLSearchParams();
      params.set('year', String(salYear));
      params.set('month', String(salMonth));
      if (salEmpFilter) params.set('employeeId', salEmpFilter);
      const [rows, sum] = await Promise.all([
        httpClient.get<SalaryRecord[]>(`/salary-records?${params}`),
        httpClient.get<Summary>(`/salary-records/summary?year=${salYear}&month=${salMonth}`),
      ]);
      setSalaries(rows);
      setSummary(sum);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الرواتب', 'error');
    } finally {
      setLoadingSal(false);
    }
  }, [showToast, salYear, salMonth, salEmpFilter]);

  const loadAdvances = useCallback(async () => {
    setLoadingAdv(true);
    try {
      const params = new URLSearchParams();
      if (advEmpFilter) params.set('employeeId', advEmpFilter);
      if (advStatusFilter) params.set('status', advStatusFilter);
      const rows = await httpClient.get<Advance[]>(`/employee-advances?${params}`);
      setAdvances(rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل السلف', 'error');
    } finally {
      setLoadingAdv(false);
    }
  }, [showToast, advEmpFilter, advStatusFilter]);

  const loadCashboxes = useCallback(async () => {
    try {
      const rows = await phase3FinanceGateway.cashbox.listMaster({ isActive: 'true' });
      setCashboxes(rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الصناديق', 'error');
    }
  }, [showToast]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void loadSalaries(); }, [loadSalaries]);
  useEffect(() => { void loadAdvances(); }, [loadAdvances]);
  useEffect(() => { void loadCashboxes(); }, [loadCashboxes]);

  useEffect(() => {
    if (salModal !== 'create' || !salForm.employeeId) {
      setSalaryOpenAdvancesHint(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await httpClient.get<{ outstandingTotal: number; targetCurrency?: string }>(
          `/employee-advances/outstanding-total?employeeId=${encodeURIComponent(salForm.employeeId)}&targetCurrency=${encodeURIComponent(salForm.currency)}`,
        );
        if (!cancelled) setSalaryOpenAdvancesHint(Number(d.outstandingTotal) || 0);
      } catch {
        if (!cancelled) setSalaryOpenAdvancesHint(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salModal, salForm.employeeId, salForm.currency]);

  useEffect(() => {
    const editing = advModal !== null && advModal !== 'create' ? (advModal as Advance) : null;
    const canQuoteUsd =
      advModal === 'create' ||
      (editing?.status === 'pending' && parseFloat(editing.repaid_amount) === 0);
    if (!canQuoteUsd || advForm.amount <= 0) {
      setAdvUsdQuote(null);
      setAdvUsdQuoteFailed(false);
      return;
    }
    setAdvUsdQuoteFailed(false);
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const q = await httpClient.get<{ rate: number; usdEquivalent: number }>(
            `/advance-usd-quote?amount=${encodeURIComponent(String(advForm.amount))}&currency=${encodeURIComponent(advForm.currency)}&date=${encodeURIComponent(advForm.advanceDate)}`,
          );
          if (!cancelled) {
            setAdvUsdQuote(q);
            setAdvUsdQuoteFailed(false);
          }
        } catch {
          if (!cancelled) {
            setAdvUsdQuote(null);
            setAdvUsdQuoteFailed(true);
          }
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [advModal, advForm.amount, advForm.currency, advForm.advanceDate]);

  // ── Employee CRUD ──────────────────────────────────────────────────────────

  const openEmployeeDossier = async (ref: Employee | string) => {
    const id = typeof ref === 'string' ? ref : ref.id;
    setDossierEmployeeId(id);
    setDossierLoading(true);
    setDossierData(null);
    try {
      const d = await httpClient.get<{
        employee: Employee;
        salaries: SalaryRecord[];
        advances: Advance[];
        openAdvancesUsd: number;
      }>(`/salary-records/employee-dossier/${id}`);
      setDossierData(d);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل ملف الموظف', 'error');
      setDossierEmployeeId(null);
    } finally {
      setDossierLoading(false);
    }
  };

  const closeDossier = () => {
    setDossierEmployeeId(null);
    setDossierData(null);
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
  };

  const saveEmployee = async () => {
    setSaving(true);
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
      void loadEmployees();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ في الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openQuickSalaryForEmployee = (e: Employee) => {
    setSalForm({
      employeeId: e.id,
      periodYear: salYear,
      periodMonth: salMonth,
      basicAmount: parseFloat(e.basic_salary) || 0,
      bonuses: 0,
      deductions: 0,
      currency: e.currency,
      paymentStatus: 'pending',
      notes: '',
    });
    setSalModal('create');
  };

  const openQuickAdvanceForEmployee = (e: Employee) => {
    setAdvForm({
      employeeId: e.id,
      amount: 0,
      currency: e.currency,
      advanceDate: today(),
      expectedRepay: '',
      notes: '',
    });
    setAdvModal('create');
  };

  const deleteEmployee = async (id: string) => {
    if (!confirm('هل تريد حذف هذا الموظف؟')) return;
    try {
      await httpClient.delete(`/employees/${id}`);
      showToast('تم الحذف', 'success');
      void loadEmployees();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    }
  };

  // ── Salary CRUD ────────────────────────────────────────────────────────────

  const openCreateSal = () => { setSalForm(emptySalary(employees)); setSalModal('create'); };
  const openEditSal = (s: SalaryRecord) => {
    setSalForm({
      employeeId: s.employee_id,
      periodYear: s.period_year,
      periodMonth: s.period_month,
      basicAmount: parseFloat(s.basic_amount),
      bonuses: parseFloat(s.bonuses),
      deductions: parseFloat(s.deductions),
      currency: s.currency,
      paymentStatus: s.payment_status,
      notes: s.notes ?? '',
    });
    setSalModal(s);
  };

  const saveSalary = async () => {
    setSaving(true);
    try {
      if (salModal === 'create') {
        await httpClient.post('/salary-records', {
          ...salForm,
          notes: salForm.notes || undefined,
        });
        showToast('تم إضافة سجل الراتب', 'success');
      } else {
        await httpClient.put(`/salary-records/${(salModal as SalaryRecord).id}`, {
          basicAmount: salForm.basicAmount,
          bonuses: salForm.bonuses,
          deductions: salForm.deductions,
          currency: salForm.currency,
          paymentStatus: salForm.paymentStatus,
          notes: salForm.notes || undefined,
        });
        showToast('تم تحديث الراتب', 'success');
      }
      setSalModal(null);
      void loadSalaries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ في الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openSalaryPay = (salary: SalaryRecord) => {
    const sameCurrency = cashboxes.find((c) => c.is_active && c.currency_code === salary.currency);
    setSalaryPayModal(salary);
    setSalaryPayCashboxId(sameCurrency?.id ?? '');
  };

  const paySalary = async () => {
    if (!salaryPayModal) return;
    if (!salaryPayCashboxId) {
      showToast('يجب اختيار صندوق لدفع صافي الراتب', 'error');
      return;
    }
    setPayingSalary(true);
    try {
      await httpClient.post(`/salary-records/${salaryPayModal.id}/pay`, { cashboxId: salaryPayCashboxId });
      showToast('تم دفع صافي الراتب وربطه بسند دفع وحركة صندوق', 'success');
      setSalaryPayModal(null);
      setSalaryPayCashboxId('');
      void loadSalaries();
      void loadAdvances();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر دفع الراتب', 'error');
    } finally {
      setPayingSalary(false);
    }
  };

  const openSalaryDetails = async (salary: SalaryRecord) => {
    setSalaryDetails({ salary, deductions: [] });
    setSalaryDetailsLoading(true);
    try {
      const deductions = await httpClient.get<SalaryAdvanceDeduction[]>(`/salary-records/${salary.id}/advance-deductions`);
      setSalaryDetails({ salary, deductions });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل تفاصيل خصم السلف', 'error');
      setSalaryDetails(null);
    } finally {
      setSalaryDetailsLoading(false);
    }
  };

  const deleteSalary = async (id: string) => {
    if (!confirm('هل تريد حذف هذا السجل؟')) return;
    try {
      await httpClient.delete(`/salary-records/${id}`);
      showToast('تم الحذف', 'success');
      void loadSalaries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    }
  };

  // ── Advance CRUD ───────────────────────────────────────────────────────────

  const openCreateAdv = () => { setAdvForm(emptyAdv(employees)); setAdvModal('create'); };
  const openEditAdv = (a: Advance) => {
    setAdvForm({
      employeeId: a.employee_id,
      amount: parseFloat(a.amount),
      currency: a.currency,
      advanceDate: a.advance_date,
      expectedRepay: a.expected_repay ?? '',
      notes: a.notes ?? '',
    });
    setAdvModal(a);
  };

  const saveAdvance = async () => {
    setSaving(true);
    try {
      if (advModal === 'create') {
        await httpClient.post('/employee-advances', {
          ...advForm,
          expectedRepay: advForm.expectedRepay || undefined,
          notes: advForm.notes || undefined,
        });
        showToast('تم إضافة السلفة', 'success');
      } else {
        const adv = advModal as Advance;
        const canEditAmount = adv.status === 'pending' && parseFloat(adv.repaid_amount) === 0;
        const body: Record<string, unknown> = {
          notes: advForm.notes || undefined,
          expectedRepay: advForm.expectedRepay || null,
        };
        if (canEditAmount) {
          body.amount = advForm.amount;
          body.currency = advForm.currency;
        }
        await httpClient.put(`/employee-advances/${adv.id}`, body);
        showToast('تم التحديث', 'success');
      }
      setAdvModal(null);
      void loadAdvances();
      void loadSalaries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateAdvanceRepayment = async (a: Advance) => {
    const input = prompt(`المبلغ المسدّد حتى الآن (الإجمالي):\nالسلفة: ${fmt(a.amount)} ${a.currency}`, a.repaid_amount);
    if (input === null) return;
    const repaid = parseFloat(input);
    if (isNaN(repaid) || repaid < 0 || repaid > parseFloat(a.amount)) {
      showToast('قيمة غير صالحة', 'error'); return;
    }
    const newStatus = repaid >= parseFloat(a.amount) ? 'repaid' : repaid > 0 ? 'partially_repaid' : 'pending';
    try {
      await httpClient.put(`/employee-advances/${a.id}`, { repaidAmount: repaid, status: newStatus });
      showToast('تم تحديث السداد', 'success');
      void loadAdvances();
      void loadSalaries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    }
  };

  const deleteAdvance = async (id: string) => {
    if (!confirm('هل تريد حذف هذه السلفة؟')) return;
    try {
      await httpClient.delete(`/employee-advances/${id}`);
      showToast('تم الحذف', 'success');
      void loadAdvances();
      void loadSalaries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطأ', 'error');
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const filteredEmployees = useMemo(() =>
    employees.filter(e =>
      !empSearch ||
      e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
      e.code.toLowerCase().includes(empSearch.toLowerCase()) ||
      (e.position ?? '').toLowerCase().includes(empSearch.toLowerCase())
    ), [employees, empSearch]);

  const activeCount = employees.filter(e => e.is_active).length;

  const exportCsv = () => {
    const today = new Date().toISOString().split('T')[0];
    if (activeTab === 'employees') {
      downloadCsv(
        `employees-${today}.csv`,
        ['الرمز', 'الاسم', 'الوظيفة', 'الراتب الأساسي', 'العملة', 'نوع الراتب', 'الهاتف', 'الحالة'],
        filteredEmployees.map((e) => [
          e.code,
          e.name,
          e.position ?? '',
          parseFloat(e.basic_salary) || 0,
          e.currency,
          SALARY_TYPE_AR[e.salary_type === 'weekly' ? 'weekly' : 'monthly'],
          e.phone ?? '',
          e.is_active ? 'نشط' : 'غير نشط',
        ]),
      );
      showToast('تم تنزيل الملف', 'success');
      return;
    }

    if (activeTab === 'salaries') {
      downloadCsv(
        `salary-records-${salYear}-${String(salMonth).padStart(2, '0')}-${today}.csv`,
        ['الموظف', 'دورة الراتب', 'الشهر', 'الأساسي', 'المكافآت', 'الاستقطاعات', 'الصافي', 'العملة', 'الحالة'],
        salaries.map((s) => [
          s.employee_name,
          SALARY_TYPE_AR[s.employee_salary_type === 'weekly' ? 'weekly' : 'monthly'],
          `${MONTHS_AR[s.period_month - 1]} ${s.period_year}`,
          parseFloat(s.basic_amount) || 0,
          parseFloat(s.bonuses) || 0,
          parseFloat(s.deductions) || 0,
          parseFloat(s.net_amount) || 0,
          s.currency,
          SALARY_STATUS_AR[s.payment_status],
        ]),
      );
      showToast('تم تنزيل الملف', 'success');
      return;
    }

    const statusLabel = advStatusFilter ? ADVANCE_STATUS_AR[advStatusFilter] ?? advStatusFilter : 'كل الحالات';
    downloadCsv(
      `employee-advances-${today}.csv`,
      ['الموظف', 'المبلغ', '≈ USD', 'سعر→USD', 'المسدّد', '≈ مسدّد USD', 'المتبقي', '≈ متبقي USD', 'العملة', 'التاريخ', 'موعد السداد', 'الحالة', 'البيان'],
      advances.map((a) => {
        const remaining = parseFloat(a.amount) - parseFloat(a.repaid_amount);
        return [
          a.employee_name,
          parseFloat(a.amount) || 0,
          a.amount_usd_equivalent ?? '',
          a.exchange_rate_to_usd ?? '',
          parseFloat(a.repaid_amount) || 0,
          a.repaid_usd_equivalent ?? '',
          remaining,
          a.outstanding_usd_equivalent ?? '',
          a.currency,
          a.advance_date,
          a.expected_repay || '',
          ADVANCE_STATUS_AR[a.status] ?? statusLabel,
          a.notes || '',
        ];
      }),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const today = new Date().toISOString().split('T')[0];
    if (activeTab === 'employees') {
      const result = await exportPdfTable({
        title: 'الموظفون',
        subtitle: empSearch.trim() ? `بحث: ${empSearch.trim()}` : undefined,
        defaultFileName: `employees-${today}.pdf`,
        headers: ['الرمز', 'الاسم', 'الوظيفة', 'الراتب الأساسي', 'نوع الراتب', 'الهاتف', 'الحالة'],
        rows: filteredEmployees.map((e) => [
          e.code,
          e.name,
          e.position ?? '—',
          `${fmt(e.basic_salary)} ${e.currency}`,
          SALARY_TYPE_AR[e.salary_type === 'weekly' ? 'weekly' : 'monthly'],
          e.phone ?? '—',
          e.is_active ? 'نشط' : 'غير نشط',
        ]),
      });
      if (result.saved) showToast('تم حفظ ملف PDF', 'success');
      else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
      return;
    }

    if (activeTab === 'salaries') {
      const empLabel = salEmpFilter ? employees.find((e) => e.id === salEmpFilter)?.name : '';
      const subtitle = `${MONTHS_AR[salMonth - 1]} ${salYear}${empLabel ? ` | الموظف: ${empLabel}` : ''}`;
      const result = await exportPdfTable({
        title: 'كشف الرواتب',
        subtitle,
        defaultFileName: `salary-records-${salYear}-${String(salMonth).padStart(2, '0')}-${today}.pdf`,
        headers: ['الموظف', 'دورة الراتب', 'الشهر', 'الأساسي', 'المكافآت', 'الاستقطاعات', 'الصافي', 'العملة', 'الحالة'],
        rows: salaries.map((s) => [
          s.employee_name,
          SALARY_TYPE_AR[s.employee_salary_type === 'weekly' ? 'weekly' : 'monthly'],
          `${MONTHS_AR[s.period_month - 1]} ${s.period_year}`,
          fmt(s.basic_amount),
          fmt(s.bonuses),
          fmt(s.deductions),
          fmt(s.net_amount),
          s.currency,
          SALARY_STATUS_AR[s.payment_status],
        ]),
      });
      if (result.saved) showToast('تم حفظ ملف PDF', 'success');
      else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
      return;
    }

    const empLabel = advEmpFilter ? employees.find((e) => e.id === advEmpFilter)?.name : '';
    const statusLabel = advStatusFilter ? ADVANCE_STATUS_AR[advStatusFilter] ?? advStatusFilter : '';
    const subtitleParts: string[] = [];
    if (empLabel) subtitleParts.push(`الموظف: ${empLabel}`);
    if (statusLabel) subtitleParts.push(`الحالة: ${statusLabel}`);

    const result = await exportPdfTable({
      title: 'السلف',
      subtitle: subtitleParts.length ? subtitleParts.join(' | ') : undefined,
      defaultFileName: `employee-advances-${today}.pdf`,
      headers: ['الموظف', 'المبلغ', '≈ USD', 'سعر→USD', 'المسدّد', '≈ مسدّد USD', 'المتبقي', '≈ متبقي USD', 'العملة', 'التاريخ', 'موعد السداد', 'الحالة', 'البيان'],
      rows: advances.map((a) => {
        const remaining = parseFloat(a.amount) - parseFloat(a.repaid_amount);
        return [
          a.employee_name,
          fmt(a.amount),
          a.amount_usd_equivalent != null ? `${fmt(a.amount_usd_equivalent)} $` : '—',
          a.exchange_rate_to_usd != null ? fmt(a.exchange_rate_to_usd) : '—',
          fmt(a.repaid_amount),
          a.repaid_usd_equivalent != null ? `${fmt(a.repaid_usd_equivalent)} $` : '—',
          fmt(remaining),
          a.outstanding_usd_equivalent != null ? `${fmt(a.outstanding_usd_equivalent)} $` : '—',
          a.currency,
          a.advance_date,
          a.expected_repay || '—',
          ADVANCE_STATUS_AR[a.status] ?? a.status,
          a.notes || '—',
        ];
      }),
    });
    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  // ── Tab content ────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'employees', label: 'الموظفون', icon: '👥' },
    { key: 'salaries', label: 'كشف الرواتب', icon: '💰' },
    { key: 'advances', label: 'السلف', icon: '🔄' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">الرواتب والسلف</h2>
        <div className="flex gap-2">
          {activeTab === 'employees' && (
            <button type="button" className="toolbar-btn primary" onClick={openCreateEmp}>+ موظف جديد</button>
          )}
          {activeTab === 'salaries' && (
            <button type="button" className="toolbar-btn primary" onClick={openCreateSal} disabled={employees.length === 0}>
              + إضافة راتب
            </button>
          )}
          {activeTab === 'advances' && (
            <button type="button" className="toolbar-btn primary" onClick={openCreateAdv} disabled={employees.length === 0}>
              + سلفة جديدة
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => {
              if (activeTab === 'employees') void loadEmployees();
              if (activeTab === 'salaries') void loadSalaries();
              if (activeTab === 'advances') void loadAdvances();
            }}
          >
            ↻ تحديث
          </button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>
            تصدير Excel (CSV)
          </button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>
            تصدير PDF
          </button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>

      {/* Summary cards (salaries tab) */}
      {activeTab === 'salaries' && summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="stat-card">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">موظف نشط</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.salary.total_records}</div>
            <div className="stat-label">سجل الشهر</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-yellow-600">{summary.salary.pending}</div>
            <div className="stat-label">معلق</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-green-600">{summary.salary.paid}</div>
            <div className="stat-label">مدفوع</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{fmt(summary.salary.total_net)}</div>
            <div className="stat-label">إجمالي صافي</div>
          </div>
        </div>
      )}

      {/* Summary cards (advances tab) */}
      {activeTab === 'advances' && summary && (
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div className="stat-card">
            <div className="stat-value text-orange-600">{summary.advances.open_advances}</div>
            <div className="stat-label">سلف مفتوحة</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-red-600">{fmt(summary.advances.outstanding)}</div>
            <div className="stat-label">متبقي للتحصيل</div>
          </div>
        </div>
      )}

      {/* Summary cards (employees tab) */}
      {activeTab === 'employees' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-md">
          <div className="stat-card">
            <div className="stat-value">{employees.length}</div>
            <div className="stat-label">إجمالي الموظفين</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-green-600">{activeCount}</div>
            <div className="stat-label">نشط</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-gray-500">{employees.length - activeCount}</div>
            <div className="stat-label">غير نشط</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b flex gap-0">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── EMPLOYEES TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'employees' && (
        <div className="space-y-3">
          <div className="card">
            <input
              type="text"
              className="form-input w-full max-w-md"
              placeholder="بحث بالاسم، الرمز، الوظيفة..."
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
            />
          </div>
          <div className="card overflow-auto">
            {loadingEmp ? (
              <p className="p-4 text-gray-500">جاري التحميل...</p>
            ) : (
              <table className="data-grid text-sm w-full">
                <thead>
                  <tr>
                    <th>الرمز</th>
                    <th>الاسم</th>
                    <th>الوظيفة</th>
                    <th>الراتب الأساسي</th>
                    <th>نوع الراتب</th>
                    <th>الهاتف</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(e => (
                    <tr key={e.id}>
                      <td className="font-mono">{e.code}</td>
                      <td className="font-medium">{e.name}</td>
                      <td>{e.position || '—'}</td>
                      <td>{fmt(e.basic_salary)} {e.currency}</td>
                      <td>
                        <span className="text-xs font-medium text-indigo-700">
                          {SALARY_TYPE_AR[e.salary_type === 'weekly' ? 'weekly' : 'monthly']}
                        </span>
                      </td>
                      <td>{e.phone || '—'}</td>
                      <td>
                        <span className={`status-badge ${e.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {e.is_active ? 'نشط' : 'غير نشط'}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-green-800 hover:bg-green-50" title="تسجيل راتب للفترة المحددة في كشف الرواتب" onClick={() => { openQuickSalaryForEmployee(e); setActiveTab('salaries'); }}>تسليم راتب</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-indigo-800 hover:bg-indigo-50" onClick={() => void openEmployeeDossier(e.id)}>ملف الموظف</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-amber-800 hover:bg-amber-50" title="سلفة جديدة لهذا الموظف" onClick={() => { openQuickAdvanceForEmployee(e); setActiveTab('advances'); }}>سلفة</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2" onClick={() => openEditEmp(e)}>تعديل</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-red-600 hover:bg-red-50" onClick={() => deleteEmployee(e.id)}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingEmp && filteredEmployees.length === 0 && (
              <p className="p-4 text-center text-gray-400">لا موظفين — أضف موظفاً جديداً</p>
            )}
          </div>
        </div>
      )}

      {/* ── SALARIES TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'salaries' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="card flex flex-wrap gap-3">
            <select className="form-input" title="سنة كشف الرواتب" aria-label="سنة كشف الرواتب" value={salYear} onChange={e => setSalYear(Number(e.target.value))}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="form-input" title="شهر كشف الرواتب" aria-label="شهر كشف الرواتب" value={salMonth} onChange={e => setSalMonth(Number(e.target.value))}>
              {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select className="form-input" title="فلترة الرواتب حسب الموظف" aria-label="فلترة الرواتب حسب الموظف" value={salEmpFilter} onChange={e => setSalEmpFilter(e.target.value)}>
              <option value="">كل الموظفين</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div className="card overflow-auto">
            {loadingSal ? (
              <p className="p-4 text-gray-500">جاري التحميل...</p>
            ) : (
              <table className="data-grid text-sm w-full">
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>دورة الراتب</th>
                    <th>الشهر</th>
                    <th>الإجمالي</th>
                    <th>سلف مخصومة</th>
                    <th>الصافي المستحق</th>
                    <th>المدفوع</th>
                    <th>المتبقي</th>
                    <th>العملة</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {salaries.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.employee_name}</td>
                      <td>
                        <span className="text-xs text-indigo-700 font-medium">
                          {SALARY_TYPE_AR[s.employee_salary_type === 'weekly' ? 'weekly' : 'monthly']}
                        </span>
                      </td>
                      <td>{MONTHS_AR[s.period_month - 1]} {s.period_year}</td>
                      <td className="text-left">{fmt(Number(s.basic_amount) + Number(s.bonuses))}</td>
                      <td className="text-left text-amber-700">{fmt(s.advance_deductions ?? 0)}</td>
                      <td className="text-left font-bold">{fmt(s.net_amount)}</td>
                      <td className="text-left text-green-700">{fmt(s.paid_amount ?? 0)}</td>
                      <td className="text-left text-red-600">{fmt(Math.max(0, Number(s.net_amount) - Number(s.paid_amount ?? 0)))}</td>
                      <td>{s.currency}</td>
                      <td>
                        <span className={`status-badge ${SALARY_STATUS_CSS[s.payment_status]}`}>
                          {SALARY_STATUS_AR[s.payment_status]}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-indigo-800 hover:bg-indigo-50" title="راتب وسلف ومكافآت" onClick={() => void openEmployeeDossier(s.employee_id)}>ملف</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-blue-700 hover:bg-blue-50" onClick={() => void openSalaryDetails(s)}>تفاصيل</button>
                          {s.payment_status === 'pending' && (
                            <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-green-700 hover:bg-green-50" onClick={() => openSalaryPay(s)}>تسليم راتب</button>
                          )}
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2" onClick={() => openEditSal(s)}>تعديل</button>
                          <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-red-600 hover:bg-red-50" onClick={() => deleteSalary(s.id)}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingSal && salaries.length === 0 && (
              <p className="p-4 text-center text-gray-400">
                لا رواتب لـ {MONTHS_AR[salMonth - 1]} {salYear}
                {employees.length === 0 && ' — أضف موظفين أولاً'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── ADVANCES TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'advances' && (
        <div className="space-y-3">
          <div className="card flex flex-wrap gap-3">
            <select className="form-input" title="فلترة السلف حسب الموظف" aria-label="فلترة السلف حسب الموظف" value={advEmpFilter} onChange={e => setAdvEmpFilter(e.target.value)}>
              <option value="">كل الموظفين</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select className="form-input" title="فلترة السلف حسب الحالة" aria-label="فلترة السلف حسب الحالة" value={advStatusFilter} onChange={e => setAdvStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              {Object.entries(ADVANCE_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="card overflow-auto">
            {loadingAdv ? (
              <p className="p-4 text-gray-500">جاري التحميل...</p>
            ) : (
              <table className="data-grid text-sm w-full">
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>المبلغ</th>
                    <th>≈ USD</th>
                    <th>سعر→USD</th>
                    <th>المسدّد</th>
                    <th>≈ مسدّد USD</th>
                    <th>المتبقي</th>
                    <th>≈ متبقي USD</th>
                    <th>العملة</th>
                    <th>التاريخ</th>
                    <th>موعد السداد</th>
                    <th>الحالة</th>
                    <th>البيان</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map(a => {
                    const remaining = parseFloat(a.amount) - parseFloat(a.repaid_amount);
                    return (
                      <tr key={a.id}>
                        <td className="font-medium">{a.employee_name}</td>
                        <td className="text-left">{fmt(a.amount)}</td>
                        <td className="text-left text-xs text-slate-600">{a.amount_usd_equivalent != null ? `${fmt(a.amount_usd_equivalent)} $` : '—'}</td>
                        <td className="text-left text-xs font-mono">{a.exchange_rate_to_usd != null ? fmt(a.exchange_rate_to_usd) : '—'}</td>
                        <td className="text-left text-green-700">{fmt(a.repaid_amount)}</td>
                        <td className="text-left text-xs text-slate-600">{a.repaid_usd_equivalent != null ? `${fmt(a.repaid_usd_equivalent)} $` : '—'}</td>
                        <td className={`text-left font-medium ${remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{fmt(remaining)}</td>
                        <td className={`text-left text-xs ${remaining > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                          {a.outstanding_usd_equivalent != null ? `${fmt(a.outstanding_usd_equivalent)} $` : '—'}
                        </td>
                        <td>{a.currency}</td>
                        <td>{a.advance_date}</td>
                        <td>{a.expected_repay || '—'}</td>
                        <td>
                          <span className={`status-badge ${ADVANCE_STATUS_CSS[a.status]}`}>
                            {ADVANCE_STATUS_AR[a.status]}
                          </span>
                        </td>
                        <td className="max-w-[160px] truncate text-xs text-gray-700" title={a.notes ?? ''}>{a.notes?.trim() ? a.notes : '—'}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-indigo-800 hover:bg-indigo-50" title="ملف الموظف" onClick={() => void openEmployeeDossier(a.employee_id)}>ملف</button>
                            {a.status !== 'repaid' && a.status !== 'cancelled' && (
                              <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-blue-700 hover:bg-blue-50" onClick={() => updateAdvanceRepayment(a)}>سداد</button>
                            )}
                            <button type="button" className="toolbar-btn text-xs py-0.5 px-2" onClick={() => openEditAdv(a)}>تعديل</button>
                            <button type="button" className="toolbar-btn text-xs py-0.5 px-2 text-red-600 hover:bg-red-50" onClick={() => deleteAdvance(a.id)}>حذف</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!loadingAdv && advances.length === 0 && (
              <p className="p-4 text-center text-gray-400">
                لا سلف مسجّلة
                {employees.length === 0 && ' — أضف موظفين أولاً'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── EMPLOYEE DOSSIER (راتب + سلف + مكافآت) ───────────────────────── */}
      {dossierEmployeeId !== null && (
        <Modal
          wide
          title={dossierData?.employee ? `ملف الموظف — ${dossierData.employee.name}` : 'ملف الموظف'}
          onClose={closeDossier}
        >
          {dossierLoading && <p className="text-gray-500 py-6 text-center">جاري التحميل…</p>}
          {!dossierLoading && dossierData && (() => {
            const { employee: em, salaries: salRows, advances: advRows, openAdvancesUsd } = dossierData;
            const salSorted = [...salRows].sort((a, b) =>
              b.period_year - a.period_year || b.period_month - a.period_month,
            );
            const advSorted = [...advRows].sort((a, b) =>
              (b.advance_date || '').localeCompare(a.advance_date || ''),
            );
            return (
              <div className="space-y-5 text-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded border p-2 bg-white">
                    <div className="text-xs text-gray-500">الرمز</div>
                    <div className="font-mono font-medium">{em.code}</div>
                  </div>
                  <div className="rounded border p-2 bg-white">
                    <div className="text-xs text-gray-500">الراتب الأساسي</div>
                    <div className="font-medium">{fmt(em.basic_salary)} {em.currency}</div>
                  </div>
                  <div className="rounded border p-2 bg-white">
                    <div className="text-xs text-gray-500">نوع الراتب</div>
                    <div className="font-medium text-indigo-800">{SALARY_TYPE_AR[em.salary_type === 'weekly' ? 'weekly' : 'monthly']}</div>
                  </div>
                  <div className="rounded border p-2 bg-amber-50 border-amber-200">
                    <div className="text-xs text-amber-900/80">سلف مفتوحة (مرجع USD)</div>
                    <div className="font-bold text-amber-950">{fmt(openAdvancesUsd)} USD</div>
                  </div>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p><span className="text-gray-500">الوظيفة:</span> {em.position || '—'}</p>
                  <p><span className="text-gray-500">الهاتف:</span> {em.phone || '—'}</p>
                  <p><span className="text-gray-500">الحالة:</span> {em.is_active ? 'نشط' : 'غير نشط'}</p>
                  {em.notes?.trim() ? <p><span className="text-gray-500">ملاحظات:</span> {em.notes}</p> : null}
                </div>

                <section>
                  <h4 className="font-bold text-base mb-2 border-b pb-1">سجل الرواتب والمكافآت والاستقطاعات</h4>
                  {salSorted.length === 0 ? (
                    <p className="text-gray-400 py-2">لا سجلات رواتب بعد.</p>
                  ) : (
                    <div className="overflow-x-auto border rounded">
                      <table className="data-grid text-xs w-full min-w-[720px]">
                        <thead>
                          <tr>
                            <th>الشهر / السنة</th>
                            <th>أساسي</th>
                            <th>مكافآت</th>
                            <th>استقطاعات</th>
                            <th>صافي</th>
                            <th>عملة</th>
                            <th>الحالة</th>
                            <th>ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salSorted.map(s => (
                            <tr key={s.id}>
                              <td>{MONTHS_AR[s.period_month - 1]} {s.period_year}</td>
                              <td className="text-left">{fmt(s.basic_amount)}</td>
                              <td className="text-left text-green-700">{fmt(s.bonuses)}</td>
                              <td className="text-left text-red-600">{fmt(s.deductions)}</td>
                              <td className="text-left font-semibold">{fmt(s.net_amount)}</td>
                              <td>{s.currency}</td>
                              <td>
                                <span className={`status-badge ${SALARY_STATUS_CSS[s.payment_status]}`}>
                                  {SALARY_STATUS_AR[s.payment_status]}
                                </span>
                              </td>
                              <td className="max-w-[140px] truncate text-xs" title={s.notes ?? ''}>{s.notes?.trim() || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="font-bold text-base mb-2 border-b pb-1">السلف (أصل العملة + ما يعادل USD)</h4>
                  {advSorted.length === 0 ? (
                    <p className="text-gray-400 py-2">لا سلف مسجّلة.</p>
                  ) : (
                    <div className="overflow-x-auto border rounded">
                      <table className="data-grid text-xs w-full min-w-[900px]">
                        <thead>
                          <tr>
                            <th>المبلغ</th>
                            <th>≈ USD</th>
                            <th>سعر→USD</th>
                            <th>مسدّد</th>
                            <th>≈ مسدّد USD</th>
                            <th>متبقي</th>
                            <th>≈ متبقي USD</th>
                            <th>عملة</th>
                            <th>تاريخ</th>
                            <th>الحالة</th>
                            <th>بيان</th>
                          </tr>
                        </thead>
                        <tbody>
                          {advSorted.map(a => {
                            const remaining = parseFloat(a.amount) - parseFloat(a.repaid_amount);
                            return (
                              <tr key={a.id}>
                                <td className="text-left">{fmt(a.amount)}</td>
                                <td className="text-left">{a.amount_usd_equivalent != null ? `${fmt(a.amount_usd_equivalent)} $` : '—'}</td>
                                <td className="text-left font-mono">{a.exchange_rate_to_usd != null ? fmt(a.exchange_rate_to_usd) : '—'}</td>
                                <td className="text-left text-green-700">{fmt(a.repaid_amount)}</td>
                                <td className="text-left">{a.repaid_usd_equivalent != null ? `${fmt(a.repaid_usd_equivalent)} $` : '—'}</td>
                                <td className={`text-left font-medium ${remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{fmt(remaining)}</td>
                                <td className={`text-left ${remaining > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                                  {a.outstanding_usd_equivalent != null ? `${fmt(a.outstanding_usd_equivalent)} $` : '—'}
                                </td>
                                <td>{a.currency}</td>
                                <td>{a.advance_date}</td>
                                <td>
                                  <span className={`status-badge ${ADVANCE_STATUS_CSS[a.status]}`}>{ADVANCE_STATUS_AR[a.status]}</span>
                                </td>
                                <td className="max-w-[120px] truncate" title={a.notes ?? ''}>{a.notes?.trim() || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <div className="flex justify-end pt-2">
                  <button type="button" className="toolbar-btn primary" onClick={closeDossier}>إغلاق</button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* ── EMPLOYEE MODAL ────────────────────────────────────────────────── */}
      {empModal !== null && (
        <Modal title={empModal === 'create' ? 'موظف جديد' : `تعديل: ${(empModal as Employee).name}`} onClose={() => setEmpModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">الرمز *</label>
                <input className="form-input w-full" title="رمز الموظف" aria-label="رمز الموظف" value={empForm.code} onChange={e => setEmpForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الاسم *</label>
                <input className="form-input w-full" title="اسم الموظف" aria-label="اسم الموظف" value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الوظيفة</label>
                <input className="form-input w-full" title="وظيفة الموظف" aria-label="وظيفة الموظف" value={empForm.position} onChange={e => setEmpForm(f => ({ ...f, position: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الهاتف</label>
                <input className="form-input w-full" title="هاتف الموظف" aria-label="هاتف الموظف" value={empForm.phone} onChange={e => setEmpForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الراتب الأساسي</label>
                <input type="number" min="0" step="0.01" className="form-input w-full" title="الراتب الأساسي" aria-label="الراتب الأساسي" value={empForm.basicSalary} onChange={e => setEmpForm(f => ({ ...f, basicSalary: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">العملة</label>
                <select className="form-input w-full" title="عملة راتب الموظف" aria-label="عملة راتب الموظف" value={empForm.currency} onChange={e => setEmpForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-slate-600 mt-1">عملة المشروع المرجعية: USD. يمكن تسجيل سلفة بليرة أو غيرها؛ يُعرض ما يعادلها بالدولار تلقائياً عند إدخال السلفة.</p>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">نوع الراتب (دورة التسليم)</label>
                <div className="flex flex-wrap gap-4 mt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" name="salaryType" checked={empForm.salaryType === 'monthly'} onChange={() => setEmpForm(f => ({ ...f, salaryType: 'monthly' }))} />
                    شهري
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" name="salaryType" checked={empForm.salaryType === 'weekly'} onChange={() => setEmpForm(f => ({ ...f, salaryType: 'weekly' }))} />
                    أسبوعي
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">يُحدد كيفية تخطيط التسليم؛ كشف الرواتب يبقى شهرياً ويمكن ضبط المبلغ يدوياً للأسابيع داخل الشهر.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">تاريخ التعيين</label>
                <input type="date" className="form-input w-full" title="تاريخ التعيين" aria-label="تاريخ التعيين" value={empForm.hireDate} onChange={e => setEmpForm(f => ({ ...f, hireDate: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 mt-5">
                <input type="checkbox" id="empActive" checked={empForm.isActive} onChange={e => setEmpForm(f => ({ ...f, isActive: e.target.checked }))} />
                <label htmlFor="empActive" className="text-sm">نشط</label>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">ملاحظات / بيان</label>
                <textarea className="form-input w-full" rows={2} title="ملاحظات الموظف" aria-label="ملاحظات الموظف" value={empForm.notes} onChange={e => setEmpForm(f => ({ ...f, notes: e.target.value }))} placeholder="اختياري" />
              </div>
            </div>
            <div className="flex gap-2 pt-2 justify-end">
              <button type="button" className="toolbar-btn" onClick={() => setEmpModal(null)}>إلغاء</button>
              <button type="button" className="toolbar-btn primary" onClick={saveEmployee} disabled={saving || !empForm.code || !empForm.name}>
                {saving ? '...' : 'حفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── SALARY MODAL ──────────────────────────────────────────────────── */}
      {salaryPayModal && (
        <Modal title={`دفع راتب - ${salaryPayModal.employee_name}`} onClose={() => setSalaryPayModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="stat-card">
                <div className="stat-value">{fmt(Number(salaryPayModal.basic_amount) + Number(salaryPayModal.bonuses))} {salaryPayModal.currency}</div>
                <div className="stat-label">إجمالي الراتب</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-amber-700">{fmt(salaryPayModal.advance_deductions ?? 0)} {salaryPayModal.currency}</div>
                <div className="stat-label">سلف مخصومة</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-red-700">{fmt(salaryPayModal.manual_deductions ?? 0)} {salaryPayModal.currency}</div>
                <div className="stat-label">استقطاعات أخرى</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-green-700">{fmt(salaryPayModal.net_amount)} {salaryPayModal.currency}</div>
                <div className="stat-label">صافي الدفع</div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الصندوق *</label>
              <select className="form-input w-full" title="صندوق دفع الراتب" aria-label="صندوق دفع الراتب" value={salaryPayCashboxId} onChange={(e) => setSalaryPayCashboxId(e.target.value)}>
                <option value="">اختر الصندوق</option>
                {cashboxes
                  .filter((c) => c.is_active && c.currency_code === salaryPayModal.currency)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}) - {fmt(c.current_balance)} {c.currency_code}
                    </option>
                  ))}
              </select>
              {cashboxes.filter((c) => c.is_active && c.currency_code === salaryPayModal.currency).length === 0 && (
                <p className="text-xs text-red-600 mt-1">لا يوجد صندوق نشط بنفس عملة الراتب.</p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="toolbar-btn" onClick={() => setSalaryPayModal(null)}>إلغاء</button>
              <button type="button" className="toolbar-btn primary" onClick={() => void paySalary()} disabled={payingSalary || !salaryPayCashboxId}>
                {payingSalary ? 'جار الدفع...' : 'تأكيد الدفع'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {salaryDetails && (
        <Modal title={`تفاصيل الراتب - ${salaryDetails.salary.employee_name}`} onClose={() => setSalaryDetails(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="stat-card">
                <div className="stat-value">{fmt(Number(salaryDetails.salary.basic_amount) + Number(salaryDetails.salary.bonuses))}</div>
                <div className="stat-label">إجمالي الراتب</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-amber-700">{fmt(salaryDetails.salary.advance_deductions ?? 0)}</div>
                <div className="stat-label">إجمالي السلف المخصومة</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-green-700">{fmt(salaryDetails.salary.net_amount)}</div>
                <div className="stat-label">الصافي</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{salaryDetails.salary.currency}</div>
                <div className="stat-label">العملة</div>
              </div>
            </div>
            {salaryDetailsLoading ? (
              <p className="text-center text-gray-500 py-4">جاري التحميل...</p>
            ) : (
              <table className="data-grid text-sm w-full">
                <thead>
                  <tr>
                    <th>السلفة</th>
                    <th>التاريخ</th>
                    <th>أصل السلفة</th>
                    <th>المخصوم بهذا الراتب</th>
                    <th>المتبقي</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryDetails.deductions.map((d) => (
                    <tr key={d.id}>
                      <td className="font-mono">{d.employee_advance_id.slice(0, 8)}...</td>
                      <td>{d.advance_date}</td>
                      <td className="text-left">{fmt(d.original_amount)} {d.currency}</td>
                      <td className="text-left text-amber-700">{fmt(d.deducted_salary_amount)} {d.salary_currency}</td>
                      <td className="text-left">{fmt(d.remaining_balance)} {d.currency}</td>
                      <td>{ADVANCE_STATUS_AR[d.advance_status] ?? d.advance_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!salaryDetailsLoading && salaryDetails.deductions.length === 0 && (
              <p className="text-sm text-gray-500">لا توجد سلف مخصومة على هذا الراتب بعد.</p>
            )}
          </div>
        </Modal>
      )}

      {salModal !== null && (
        <Modal title={salModal === 'create' ? 'إضافة راتب' : 'تعديل الراتب'} onClose={() => setSalModal(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">الموظف *</label>
              <select className="form-input w-full" title="موظف الراتب" aria-label="موظف الراتب" value={salForm.employeeId} onChange={e => {
                const emp = employees.find(x => x.id === e.target.value);
                setSalForm(f => ({
                  ...f,
                  employeeId: e.target.value,
                  basicAmount: emp ? parseFloat(emp.basic_salary) : f.basicAmount,
                  currency: emp?.currency ?? f.currency,
                }));
              }} disabled={salModal !== 'create'}>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
              </select>
              {(() => {
                const emp = employees.find(x => x.id === salForm.employeeId);
                if (!emp) return null;
                const st = emp.salary_type === 'weekly' ? 'weekly' : 'monthly';
                return (
                  <p className="text-xs text-indigo-800 bg-indigo-50 rounded px-2 py-1.5 mt-1">
                    نوع الراتب في بطاقة الموظف: <strong>{SALARY_TYPE_AR[st]}</strong>
                    {st === 'weekly' && ' — يمكنك تعديل مبلغ هذا الشهر ليتوافق مع عدد الأسابيع المستحقة.'}
                  </p>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">السنة</label>
                <select className="form-input w-full" title="سنة الراتب" aria-label="سنة الراتب" value={salForm.periodYear} onChange={e => setSalForm(f => ({ ...f, periodYear: Number(e.target.value) }))} disabled={salModal !== 'create'}>
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الشهر</label>
                <select className="form-input w-full" title="شهر الراتب" aria-label="شهر الراتب" value={salForm.periodMonth} onChange={e => setSalForm(f => ({ ...f, periodMonth: Number(e.target.value) }))} disabled={salModal !== 'create'}>
                  {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الراتب الأساسي</label>
                <input type="number" min="0" step="0.01" className="form-input w-full" title="الراتب الأساسي" aria-label="الراتب الأساسي" value={salForm.basicAmount} onChange={e => setSalForm(f => ({ ...f, basicAmount: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">المكافآت</label>
                <input type="number" min="0" step="0.01" className="form-input w-full" title="مكافآت الراتب" aria-label="مكافآت الراتب" value={salForm.bonuses} onChange={e => setSalForm(f => ({ ...f, bonuses: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">استقطاعات أخرى</label>
                <input type="number" min="0" step="0.01" className="form-input w-full" title="استقطاعات أخرى" aria-label="استقطاعات أخرى" value={salForm.deductions} onChange={e => setSalForm(f => ({ ...f, deductions: parseFloat(e.target.value) || 0 }))} />
                {salModal === 'create' && salaryOpenAdvancesHint > 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 mt-1">
                    سلف مفتوحة تُضاف للخصومات (محوّلة لعملة هذا السجل <strong>{salForm.currency}</strong>):{' '}
                    <strong>{fmt(salaryOpenAdvancesHint)} {salForm.currency}</strong>
                    <span className="block mt-0.5 text-[11px] text-amber-900/90">أساس احتساب السلف: الدولار ثم التحويل بسعر الصرف عند الحفظ.</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">العملة</label>
                <select className="form-input w-full" title="عملة الراتب" aria-label="عملة الراتب" value={salForm.currency} onChange={e => setSalForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الحالة</label>
                <select className="form-input w-full" title="حالة دفع الراتب" aria-label="حالة دفع الراتب" value={salForm.paymentStatus} onChange={e => setSalForm(f => ({ ...f, paymentStatus: e.target.value as any }))}>
                  {Object.entries(SALARY_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <div className="card p-2 bg-blue-50 text-sm">
                  الصافي المتوقع:{' '}
                  <strong>
                    {fmt(
                      salForm.basicAmount +
                        salForm.bonuses -
                        salForm.deductions -
                        (salModal === 'create' ? salaryOpenAdvancesHint : 0),
                    )}{' '}
                    {salForm.currency}
                  </strong>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ملاحظات</label>
              <textarea className="form-input w-full" rows={2} title="ملاحظات الراتب" aria-label="ملاحظات الراتب" value={salForm.notes} onChange={e => setSalForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-2 justify-end">
              <button type="button" className="toolbar-btn" onClick={() => setSalModal(null)}>إلغاء</button>
              <button type="button" className="toolbar-btn primary" onClick={saveSalary} disabled={saving || !salForm.employeeId}>
                {saving ? '...' : 'حفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── ADVANCE MODAL ─────────────────────────────────────────────────── */}
      {advModal !== null && (
        <Modal title={advModal === 'create' ? 'سلفة جديدة' : `تعديل سلفة: ${(advModal as Advance).employee_name}`} onClose={() => setAdvModal(null)}>
          <div className="space-y-3">
            {advModal === 'create' && (
              <div>
                <label className="block text-sm font-medium mb-1">الموظف *</label>
                <select className="form-input w-full" title="موظف السلفة" aria-label="موظف السلفة" value={advForm.employeeId} onChange={e => {
                  const emp = employees.find(x => x.id === e.target.value);
                  setAdvForm(f => ({ ...f, employeeId: e.target.value, currency: emp?.currency ?? f.currency }));
                }}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {advModal === 'create' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">المبلغ *</label>
                    <input type="number" min="0.01" step="0.01" className="form-input w-full" title="مبلغ السلفة" aria-label="مبلغ السلفة" value={advForm.amount} onChange={e => setAdvForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">العملة</label>
                    <select className="form-input w-full" title="عملة السلفة" aria-label="عملة السلفة" value={advForm.currency} onChange={e => setAdvForm(f => ({ ...f, currency: e.target.value }))}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">تاريخ السلفة</label>
                    <input type="date" className="form-input w-full" title="تاريخ السلفة" aria-label="تاريخ السلفة" value={advForm.advanceDate} onChange={e => setAdvForm(f => ({ ...f, advanceDate: e.target.value }))} />
                  </div>
                </>
              )}
              {advModal !== 'create' && (advModal as Advance).status === 'pending' && parseFloat((advModal as Advance).repaid_amount) === 0 && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">المبلغ</label>
                    <input type="number" min="0.01" step="0.01" className="form-input w-full" title="مبلغ السلفة" aria-label="مبلغ السلفة" value={advForm.amount} onChange={e => setAdvForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">العملة</label>
                    <select className="form-input w-full" title="عملة السلفة" aria-label="عملة السلفة" value={advForm.currency} onChange={e => setAdvForm(f => ({ ...f, currency: e.target.value }))}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">موعد السداد المتوقع</label>
                <input type="date" className="form-input w-full" title="موعد السداد المتوقع" aria-label="موعد السداد المتوقع" value={advForm.expectedRepay} onChange={e => setAdvForm(f => ({ ...f, expectedRepay: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">البيان (ملاحظات)</label>
              <textarea className="form-input w-full" rows={2} title="بيان السلفة" aria-label="بيان السلفة" value={advForm.notes} onChange={e => setAdvForm(f => ({ ...f, notes: e.target.value }))} placeholder="سبب السلفة أو تفاصيل إضافية" />
            </div>
            {(() => {
              const editing = advModal !== null && advModal !== 'create' ? (advModal as Advance) : null;
              const showUsd =
                advModal === 'create' ||
                (editing?.status === 'pending' && parseFloat(editing.repaid_amount) === 0);
              if (!showUsd || advForm.amount <= 0) return null;
              return (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm space-y-1">
                  <p className="font-medium text-slate-800">ما يعادل بالدولار (أساس المشروع)</p>
                  {advUsdQuote != null ? (
                    <>
                      <p>
                        المبلغ ≈ <strong>{fmt(advUsdQuote.usdEquivalent)} USD</strong>
                        {advForm.currency !== 'USD' && (
                          <span className="text-slate-600"> ({fmt(advForm.amount)} {advForm.currency})</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-600">
                        سعر التحويل إلى USD للعرض: <span className="font-mono">{fmt(advUsdQuote.rate)}</span>
                        {' — '}يُثبّت على السجل عند الحفظ حسب تاريخ السلفة.
                      </p>
                    </>
                  ) : advUsdQuoteFailed ? (
                    <p className="text-xs text-red-700">تعذر جلب سعر الصرف لهذا التاريخ والعملة. أضف سعر صرف ثم أعد المحاولة.</p>
                  ) : (
                    <p className="text-xs text-slate-500">جاري تقدير ما يعادل الدولار…</p>
                  )}
                </div>
              );
            })()}
            <div className="flex gap-2 pt-2 justify-end">
              <button type="button" className="toolbar-btn" onClick={() => setAdvModal(null)}>إلغاء</button>
              <button type="button" className="toolbar-btn primary" onClick={saveAdvance} disabled={saving || (advModal === 'create' && (!advForm.employeeId || advForm.amount <= 0))}>
                {saving ? '...' : 'حفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
