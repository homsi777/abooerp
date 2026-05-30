import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { FinanceRepository } from './financeRepository.js';

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
  manualDeductions?: number;
  advanceDeductions?: number;
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
  manual_deductions?: string;
  advance_deductions?: string;
  net_amount: string;
  paid_amount?: string;
  currency: string;
  payment_status: 'pending' | 'paid' | 'cancelled';
  paid_at: string | null;
  salary_payment_voucher_id?: string | null;
  salary_cashbox_id?: string | null;
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

export interface SalaryAdvanceDeduction {
  id: string;
  company_id: string;
  salary_record_id: string;
  employee_advance_id: string;
  deducted_amount: string;
  currency: string;
  deducted_salary_amount: string;
  salary_currency: string;
  exchange_rate_to_usd: string;
  created_at: string;
  advance_date?: string;
  original_amount?: string;
  remaining_balance?: string;
  status?: string;
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
        basic_amount, bonuses, deductions, manual_deductions, advance_deductions, currency,
        payment_status, paid_at, notes, created_by
      ) values(
        $1, $2, $3, $4, $5,
        $6, coalesce($7, 0), coalesce($8, 0), coalesce($14, coalesce($8, 0)), coalesce($15, 0), coalesce($9, 'USD'),
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
        input.manualDeductions ?? null,
        input.advanceDeductions ?? null,
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

  async listSalaryAdvanceDeductions(companyId: string, salaryRecordId: string): Promise<SalaryAdvanceDeduction[]> {
    const result = await pool.query<SalaryAdvanceDeduction>(
      `
      select
        sad.*,
        ea.advance_date,
        ea.amount as original_amount,
        (ea.amount - ea.repaid_amount) as remaining_balance,
        ea.status
      from salary_advance_deductions sad
      join employee_advances ea on ea.id = sad.employee_advance_id
      where sad.company_id = $1::uuid
        and sad.salary_record_id = $2::uuid
      order by ea.advance_date asc, sad.created_at asc
      `,
      [companyId, salaryRecordId],
    );
    return result.rows;
  }

  async paySalary(
    id: string,
    companyId: string,
    input: { cashboxId: string; paidByUserId?: string; salaryExchangeRateToUsd?: number },
    financeRepository: FinanceRepository,
  ) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const salaryResult = await client.query(
        `
        select sr.*, e.name as employee_name, e.code as employee_code
        from salary_records sr
        join employees e on e.id = sr.employee_id
        where sr.id = $1::uuid
          and sr.company_id = $2::uuid
          and sr.deleted_at is null
        for update
        `,
        [id, companyId],
      );
      const salary = salaryResult.rows[0];
      if (!salary) throw new HttpError(404, 'Salary record not found.');
      if (salary.payment_status !== 'pending') throw new HttpError(400, 'يمكن دفع الرواتب المعلقة فقط.');

      const cashboxResult = await client.query(
        `
        select *
        from cashboxes
        where id = $1::uuid
          and company_id = $2::uuid
        for update
        `,
        [input.cashboxId, companyId],
      );
      const cashbox = cashboxResult.rows[0];
      if (!cashbox) throw new HttpError(400, 'الصندوق غير موجود.');
      if (cashbox.is_active === false) throw new HttpError(400, 'الصندوق غير نشط.');
      if (String(cashbox.currency_code).toUpperCase() !== String(salary.currency).toUpperCase()) {
        throw new HttpError(400, 'عملة الصندوق لا تطابق عملة الراتب.');
      }

      const existingDeductions = await client.query(
        `select count(*)::int as count from salary_advance_deductions where salary_record_id = $1::uuid`,
        [id],
      );

      const manualDeductions = Number(salary.manual_deductions ?? salary.deductions ?? 0);
      let advanceDeductions = Number(salary.advance_deductions ?? 0);
      const grossAfterManual = Math.max(0, Number(salary.basic_amount) + Number(salary.bonuses) - manualDeductions);

      if (Number(existingDeductions.rows[0]?.count ?? 0) === 0 && grossAfterManual > 0) {
        let remainingSalaryCapacity = grossAfterManual;
        const salaryRateToUsd = input.salaryExchangeRateToUsd && input.salaryExchangeRateToUsd > 0 ? input.salaryExchangeRateToUsd : 1;
        const advances = await client.query(
          `
          select *
          from employee_advances
          where company_id = $1::uuid
            and employee_id = $2::uuid
            and deleted_at is null
            and status in ('pending', 'partially_repaid')
            and amount > repaid_amount
          order by advance_date asc, created_at asc, id asc
          for update
          `,
          [companyId, salary.employee_id],
        );

        for (const adv of advances.rows) {
          if (remainingSalaryCapacity <= 0) break;
          const advanceRateToUsd = Number(adv.exchange_rate_to_usd || 1);
          const outstandingOriginal = Math.max(0, Number(adv.amount) - Number(adv.repaid_amount));
          const outstandingSalary = Number(((outstandingOriginal * advanceRateToUsd) / salaryRateToUsd).toFixed(2));
          const appliedSalary = Math.min(remainingSalaryCapacity, outstandingSalary);
          if (appliedSalary <= 0) continue;
          const deductedOriginal = Number(((appliedSalary * salaryRateToUsd) / advanceRateToUsd).toFixed(2));
          const nextRepaid = Number(adv.repaid_amount) + deductedOriginal;
          const nextStatus = nextRepaid + 0.0001 >= Number(adv.amount) ? 'repaid' : 'partially_repaid';

          await client.query(
            `
            insert into salary_advance_deductions(
              company_id, salary_record_id, employee_advance_id, deducted_amount,
              currency, deducted_salary_amount, salary_currency, exchange_rate_to_usd, created_by
            ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
            on conflict do nothing
            `,
            [
              companyId,
              id,
              adv.id,
              deductedOriginal,
              adv.currency,
              appliedSalary,
              salary.currency,
              advanceRateToUsd,
              input.paidByUserId ?? null,
            ],
          );
          await client.query(
            `
            update employee_advances
            set repaid_amount = least(amount, repaid_amount + $2::numeric),
                status = $3,
                updated_at = now()
            where id = $1::uuid
            `,
            [adv.id, deductedOriginal, nextStatus],
          );

          advanceDeductions += appliedSalary;
          remainingSalaryCapacity = Number((remainingSalaryCapacity - appliedSalary).toFixed(2));
        }
      }

      const paidAmount = Math.max(0, Number(salary.basic_amount) + Number(salary.bonuses) - manualDeductions - advanceDeductions);
      let voucher: any = null;
      if (paidAmount > 0) {
        const voucherNo = `SAL-${salary.period_year}${String(salary.period_month).padStart(2, '0')}-${String(salary.employee_code || 'EMP').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}-${String(Date.now()).slice(-6)}`;
        voucher = await financeRepository.createPaymentVoucherWithClient(client, {
          voucherNo,
          relatedEntityType: 'salary_record',
          relatedEntityId: id,
          status: 'confirmed',
          notes: `Salary payment ${salary.employee_name} ${salary.period_month}/${salary.period_year}`,
          originalAmount: paidAmount,
          originalCurrency: salary.currency,
          exchangeRateToUsd: input.salaryExchangeRateToUsd ?? 1,
          baseAmountUsd: Number((paidAmount * (input.salaryExchangeRateToUsd ?? 1)).toFixed(2)),
          createdByUserId: input.paidByUserId,
          companyId,
          branchId: salary.branch_id ?? undefined,
          cashboxId: input.cashboxId,
        });
      }

      const updated = await client.query(
        `
        update salary_records
        set manual_deductions = $3,
            advance_deductions = $4,
            deductions = $3 + $4,
            paid_amount = $5,
            payment_status = 'paid',
            paid_at = now(),
            salary_payment_voucher_id = $6,
            salary_cashbox_id = $7,
            updated_at = now()
        where id = $1::uuid and company_id = $2::uuid
        returning *
        `,
        [id, companyId, manualDeductions, advanceDeductions, paidAmount, voucher?.id ?? null, input.cashboxId],
      );

      const deductions = await client.query(
        `
        select sad.*, ea.advance_date, ea.amount as original_amount,
               (ea.amount - ea.repaid_amount) as remaining_balance, ea.status
        from salary_advance_deductions sad
        join employee_advances ea on ea.id = sad.employee_advance_id
        where sad.salary_record_id = $1::uuid
        order by ea.advance_date asc, sad.created_at asc
        `,
        [id],
      );

      await client.query('commit');
      return { salary: updated.rows[0], voucher, advanceDeductions: deductions.rows };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
