import { pool } from '../db/pool.js';

// ─── Salary Records ───────────────────────────────────────────────────────────

export interface SalaryRecordInput {
  companyId: string;
  branchId?: string | null;
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  basicAmount: number;
  bonuses?: number;
  deductions?: number;
  currency?: string;
  paymentStatus?: 'pending' | 'paid' | 'cancelled';
  paidAt?: string | null;
  notes?: string;
  createdBy?: string;
}

export interface SalaryRecord {
  id: string;
  company_id: string;
  branch_id: string | null;
  employee_id: string;
  period_year: number;
  period_month: number;
  basic_amount: string;
  bonuses: string;
  deductions: string;
  net_amount: string;
  currency: string;
  payment_status: 'pending' | 'paid' | 'cancelled';
  paid_at: string | null;
  notes: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  employee_name?: string;
  employee_code?: string;
  employee_salary_type?: 'monthly' | 'weekly';
}

// ─── Advances ─────────────────────────────────────────────────────────────────

export interface AdvanceInput {
  companyId: string;
  branchId?: string | null;
  employeeId: string;
  amount: number;
  currency?: string;
  advanceDate?: string;
  expectedRepay?: string | null;
  notes?: string;
  createdBy?: string;
  /** مضاعف USD لكل وحدة من عملة السلفة (مثل سجل أسعار الصرف). */
  exchangeRateToUsd: number;
}

export interface EmployeeAdvance {
  id: string;
  company_id: string;
  branch_id: string | null;
  employee_id: string;
  amount: string;
  repaid_amount: string;
  currency: string;
  exchange_rate_to_usd: string;
  advance_date: string;
  expected_repay: string | null;
  status: 'pending' | 'partially_repaid' | 'repaid' | 'cancelled';
  notes: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  employee_name?: string;
  employee_code?: string;
  /** حقول محسوبة في list (اختيارية في getById حسب الاستعلام). */
  amount_usd_equivalent?: string;
  repaid_usd_equivalent?: string;
  outstanding_usd_equivalent?: string;
}

export class SalaryRepository {
  // ── Salary Records ──────────────────────────────────────────────────────────

  async listSalaries(
    companyId: string,
    filters?: { employeeId?: string; year?: number; month?: number; status?: string },
  ): Promise<SalaryRecord[]> {
    const conditions = ['sr.company_id = $1', 'sr.deleted_at is null'];
    const values: any[] = [companyId];

    if (filters?.employeeId) {
      values.push(filters.employeeId);
      conditions.push(`sr.employee_id = $${values.length}`);
    }
    if (filters?.year) {
      values.push(filters.year);
      conditions.push(`sr.period_year = $${values.length}`);
    }
    if (filters?.month) {
      values.push(filters.month);
      conditions.push(`sr.period_month = $${values.length}`);
    }
    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`sr.payment_status = $${values.length}`);
    }

    const result = await pool.query<SalaryRecord>(
      `
      select
        sr.*,
        e.name  as employee_name,
        e.code  as employee_code,
        e.salary_type as employee_salary_type
      from salary_records sr
      join employees e on e.id = sr.employee_id
      where ${conditions.join(' and ')}
      order by sr.period_year desc, sr.period_month desc, e.name asc
      `,
      values,
    );
    return result.rows;
  }

  async getSalaryById(id: string, companyId: string): Promise<SalaryRecord | null> {
    const result = await pool.query<SalaryRecord>(
      `
      select sr.*, e.name as employee_name, e.code as employee_code,
        e.salary_type as employee_salary_type
      from salary_records sr
      join employees e on e.id = sr.employee_id
      where sr.id = $1 and sr.company_id = $2 and sr.deleted_at is null
      limit 1
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async createSalary(input: SalaryRecordInput): Promise<SalaryRecord> {
    const result = await pool.query<SalaryRecord>(
      `
      insert into salary_records(
        company_id, branch_id, employee_id, period_year, period_month,
        basic_amount, bonuses, deductions, currency,
        payment_status, paid_at, notes, created_by
      ) values(
        $1, $2, $3, $4, $5,
        $6, coalesce($7, 0), coalesce($8, 0), coalesce($9, 'USD'),
        coalesce($10, 'pending'), $11, $12, $13
      )
      returning *
      `,
      [
        input.companyId,
        input.branchId ?? null,
        input.employeeId,
        input.periodYear,
        input.periodMonth,
        input.basicAmount,
        input.bonuses ?? null,
        input.deductions ?? null,
        input.currency ?? null,
        input.paymentStatus ?? null,
        input.paidAt ?? null,
        input.notes ?? null,
        input.createdBy ?? null,
      ],
    );
    return result.rows[0];
  }

  async updateSalary(
    id: string,
    companyId: string,
    input: Partial<SalaryRecordInput>,
  ): Promise<SalaryRecord | null> {
    const paidAt = input.paymentStatus === 'paid' && !input.paidAt ? 'now()' : null;
    const result = await pool.query<SalaryRecord>(
      `
      update salary_records
      set
        basic_amount    = coalesce($3, basic_amount),
        bonuses         = coalesce($4, bonuses),
        deductions      = coalesce($5, deductions),
        currency        = coalesce($6, currency),
        payment_status  = coalesce($7, payment_status),
        paid_at         = case
                            when $7 = 'paid' and paid_at is null then now()
                            when $7 = 'cancelled' then null
                            else paid_at
                          end,
        notes           = coalesce($8, notes),
        updated_at      = now()
      where id = $1 and company_id = $2 and deleted_at is null
      returning *
      `,
      [
        id,
        companyId,
        input.basicAmount ?? null,
        input.bonuses ?? null,
        input.deductions ?? null,
        input.currency ?? null,
        input.paymentStatus ?? null,
        input.notes ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async deleteSalary(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `update salary_records set deleted_at = now() where id = $1 and company_id = $2 and deleted_at is null returning id`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ── Advances ────────────────────────────────────────────────────────────────

  async listAdvances(
    companyId: string,
    filters?: { employeeId?: string; status?: string },
  ): Promise<EmployeeAdvance[]> {
    const conditions = ['a.company_id = $1', 'a.deleted_at is null'];
    const values: any[] = [companyId];

    if (filters?.employeeId) {
      values.push(filters.employeeId);
      conditions.push(`a.employee_id = $${values.length}`);
    }
    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`a.status = $${values.length}`);
    }

    const result = await pool.query<EmployeeAdvance>(
      `
      select
        a.*,
        e.name as employee_name,
        e.code as employee_code,
        round((a.amount * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as amount_usd_equivalent,
        round((a.repaid_amount * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as repaid_usd_equivalent,
        round(((a.amount - a.repaid_amount) * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as outstanding_usd_equivalent
      from employee_advances a
      join employees e on e.id = a.employee_id
      where ${conditions.join(' and ')}
      order by a.advance_date desc
      `,
      values,
    );
    return result.rows;
  }

  async getAdvanceById(id: string, companyId: string): Promise<EmployeeAdvance | null> {
    const result = await pool.query<EmployeeAdvance>(
      `
      select a.*, e.name as employee_name, e.code as employee_code,
        round((a.amount * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as amount_usd_equivalent,
        round((a.repaid_amount * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as repaid_usd_equivalent,
        round(((a.amount - a.repaid_amount) * coalesce(a.exchange_rate_to_usd, 1))::numeric, 2)::text as outstanding_usd_equivalent
      from employee_advances a
      join employees e on e.id = a.employee_id
      where a.id = $1 and a.company_id = $2 and a.deleted_at is null
      limit 1
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async createAdvance(input: AdvanceInput): Promise<EmployeeAdvance> {
    const result = await pool.query<EmployeeAdvance>(
      `
      insert into employee_advances(
        company_id, branch_id, employee_id, amount,
        currency, exchange_rate_to_usd, advance_date, expected_repay, notes, created_by
      ) values(
        $1, $2, $3, $4,
        coalesce($5, 'USD'), $6, coalesce($7::date, current_date), $8, $9, $10
      )
      returning *
      `,
      [
        input.companyId,
        input.branchId ?? null,
        input.employeeId,
        input.amount,
        input.currency ?? null,
        input.exchangeRateToUsd,
        input.advanceDate ?? null,
        input.expectedRepay ?? null,
        input.notes ?? null,
        input.createdBy ?? null,
      ],
    );
    return result.rows[0];
  }

  async updateAdvance(
    id: string,
    companyId: string,
    input: {
      repaidAmount?: number;
      status?: string;
      notes?: string;
      expectedRepay?: string | null;
      amount?: number;
      currency?: string;
      exchangeRateToUsd?: number;
    },
  ): Promise<EmployeeAdvance | null> {
    const result = await pool.query<EmployeeAdvance>(
      `
      update employee_advances
      set
        repaid_amount  = coalesce($3, repaid_amount),
        status         = coalesce($4, status),
        notes          = coalesce($5, notes),
        expected_repay = coalesce($6, expected_repay),
        amount           = case
          when $7::numeric is not null
            and status = 'pending'
            and repaid_amount = 0
          then $7::numeric
          else amount
        end,
        currency         = case
          when $8::text is not null
            and status = 'pending'
            and repaid_amount = 0
          then $8::text
          else currency
        end,
        exchange_rate_to_usd = coalesce($9::numeric, exchange_rate_to_usd),
        updated_at     = now()
      where id = $1 and company_id = $2 and deleted_at is null
      returning *
      `,
      [
        id,
        companyId,
        input.repaidAmount ?? null,
        input.status ?? null,
        input.notes ?? null,
        input.expectedRepay ?? null,
        input.amount ?? null,
        input.currency ?? null,
        input.exchangeRateToUsd ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async deleteAdvance(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `update employee_advances set deleted_at = now() where id = $1 and company_id = $2 and deleted_at is null returning id`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ── Summary stats ────────────────────────────────────────────────────────────

  /** مجموع السلف المفتوحة (المتبقي) لموظف — يُدمج تلقائياً في خصومات الراتب عند الإنشاء ويُزامَن عند تغيّر السلف. */
  async sumOpenAdvanceBalance(companyId: string, employeeId: string): Promise<number> {
    const result = await pool.query<{ total: string }>(
      `
      select coalesce(sum((amount - repaid_amount) * coalesce(exchange_rate_to_usd, 1)), 0)::text as total
      from employee_advances
      where company_id = $1
        and employee_id = $2
        and deleted_at is null
        and status in ('pending', 'partially_repaid')
      `,
      [companyId, employeeId],
    );
    const n = Number(result.rows[0]?.total ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * يعدّل خصومات سجل الراتب «المعلّق» لنفس شهر/سنة سياق السلفة.
   * delta موجب = زيادة خصم (تقليل الصافي).
   */
  async adjustPendingSalaryDeductions(
    companyId: string,
    employeeId: string,
    periodYear: number,
    periodMonth: number,
    delta: number,
  ): Promise<void> {
    if (!Number.isFinite(delta) || delta === 0) return;
    await pool.query(
      `
      update salary_records
      set
        deductions = greatest(0::numeric, deductions + $5::numeric),
        updated_at = now()
      where company_id = $1
        and employee_id = $2
        and period_year = $3
        and period_month = $4
        and payment_status = 'pending'
        and deleted_at is null
      `,
      [companyId, employeeId, periodYear, periodMonth, delta],
    );
  }

  /** عملة سجل الراتب المعلّق لشهر معيّن (لتحويل خصم السلفة من USD إلى عملة الراتب). */
  async getPendingSalaryCurrencyForPeriod(
    companyId: string,
    employeeId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<string | null> {
    const result = await pool.query<{ currency: string }>(
      `
      select currency
      from salary_records
      where company_id = $1
        and employee_id = $2
        and period_year = $3
        and period_month = $4
        and payment_status = 'pending'
        and deleted_at is null
      limit 1
      `,
      [companyId, employeeId, periodYear, periodMonth],
    );
    return result.rows[0]?.currency ?? null;
  }

  async getSummary(companyId: string, year: number, month: number) {
    const [salaryStats, advanceStats] = await Promise.all([
      pool.query(
        `
        select
          count(*)                            as total_records,
          count(*) filter (where payment_status = 'pending')   as pending,
          count(*) filter (where payment_status = 'paid')      as paid,
          coalesce(sum(net_amount) filter (where payment_status != 'cancelled'), 0) as total_net,
          coalesce(sum(net_amount) filter (where payment_status = 'paid'), 0)       as total_paid
        from salary_records
        where company_id = $1 and period_year = $2 and period_month = $3 and deleted_at is null
        `,
        [companyId, year, month],
      ),
      pool.query(
        `
        select
          count(*) filter (where status in ('pending','partially_repaid')) as open_advances,
          coalesce(sum((amount - repaid_amount) * coalesce(exchange_rate_to_usd, 1)) filter (where status in ('pending','partially_repaid')), 0) as outstanding
        from employee_advances
        where company_id = $1 and deleted_at is null
        `,
        [companyId],
      ),
    ]);
    return {
      salary: salaryStats.rows[0],
      advances: advanceStats.rows[0],
    };
  }
}
