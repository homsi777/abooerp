import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermissions, requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import type { EmployeeAdvance, SalaryRepository } from '../repositories/salaryRepository.js';
import type { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import type { EmployeeRepository } from '../repositories/employeeRepository.js';
import { resolveExchangeRateToUsd } from '../utils/resolveExchangeRateToUsd.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

function userId(req: any): string | undefined {
  return req.requestUserContext?.userId as string | undefined;
}

// ── Salary record schemas ────────────────────────────────────────────────────

const salaryCreateSchema = z.object({
  employeeId: z.string().uuid(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  basicAmount: z.number().min(0),
  bonuses: z.number().min(0).optional(),
  deductions: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  paymentStatus: z.enum(['pending', 'paid', 'cancelled']).optional(),
  notes: z.string().optional(),
  branchId: z.string().uuid().optional(),
});

const salaryUpdateSchema = z.object({
  basicAmount: z.number().min(0).optional(),
  bonuses: z.number().min(0).optional(),
  deductions: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  paymentStatus: z.enum(['pending', 'paid', 'cancelled']).optional(),
  notes: z.string().optional(),
});

// ── Advance schemas ─────────────────────────────────────────────────────────

const advanceCreateSchema = z.object({
  employeeId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  advanceDate: z.string().optional(),
  expectedRepay: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().uuid().optional(),
});

const advanceUpdateSchema = z.object({
  repaidAmount: z.number().min(0).optional(),
  status: z.enum(['pending', 'partially_repaid', 'repaid', 'cancelled']).optional(),
  expectedRepay: z.string().nullable().optional(),
  notes: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
});

/** المتبقي من السلفة بما يعادل USD (أساس المشروع) لخصم الراتب المعلّق. */
function advanceOutstandingForPayroll(a: EmployeeAdvance): number {
  if (a.status === 'cancelled' || a.status === 'repaid') return 0;
  const rate = parseFloat(String(a.exchange_rate_to_usd ?? '1')) || 1;
  const out = Math.max(0, parseFloat(a.amount) - parseFloat(a.repaid_amount));
  return Number((out * rate).toFixed(2));
}

function periodFromAdvanceDate(advanceDate: string | Date): { y: number; m: number } {
  const s = typeof advanceDate === 'string' ? advanceDate : advanceDate.toISOString();
  const part = s.slice(0, 10);
  const [ys, ms] = part.split('-');
  return { y: parseInt(ys, 10) || 2000, m: parseInt(ms, 10) || 1 };
}

async function syncAdvanceOutstandingToPendingSalary(
  repository: SalaryRepository,
  exchangeRepo: ExchangeRateRepository,
  companyId: string,
  before: EmployeeAdvance | null,
  after: EmployeeAdvance,
) {
  const oldOut = before ? advanceOutstandingForPayroll(before) : 0;
  const newOut = advanceOutstandingForPayroll(after);
  const deltaUsd = newOut - oldOut;
  const { y, m } = periodFromAdvanceDate(after.advance_date);
  const salCur = await repository.getPendingSalaryCurrencyForPeriod(companyId, after.employee_id, y, m);
  const delta = await usdDeltaToSalaryDeductionCurrency(exchangeRepo, companyId, deltaUsd, salCur, y, m);
  await repository.adjustPendingSalaryDeductions(companyId, after.employee_id, y, m, delta);
}

/** يحوّل فرق السلفة (بالدولار) إلى مبلغ بعملة سجل الراتب المعلّق. */
async function usdDeltaToSalaryDeductionCurrency(
  exchangeRepo: ExchangeRateRepository,
  companyId: string,
  deltaUsd: number,
  salaryCurrency: string | null,
  periodY: number,
  periodM: number,
): Promise<number> {
  if (!Number.isFinite(deltaUsd) || deltaUsd === 0) return 0;
  const cur = (salaryCurrency ?? 'USD').trim().toUpperCase();
  if (cur === 'USD') return Number(deltaUsd.toFixed(2));
  const d = `${periodY}-${String(periodM).padStart(2, '0')}-15`;
  const unitToUsd = await resolveExchangeRateToUsd(exchangeRepo, companyId, cur, d);
  return Number((deltaUsd / unitToUsd).toFixed(2));
}

export function createSalaryRouter(
  repository: SalaryRepository,
  exchangeRateRepository: ExchangeRateRepository,
  employeeRepository: EmployeeRepository,
) {
  const router = Router();
  const auditService = new AuditService();

  // ── Salary Records ─────────────────────────────────────────────────────────

  router.get(
    '/salary-records/summary',
    requirePermissions(['hr.salaries.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1), 10);
      const data = await repository.getSummary(companyId, year, month);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/salary-records',
    requirePermissions(['hr.salaries.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.listSalaries(companyId, {
        employeeId: req.query.employeeId as string | undefined,
        year: req.query.year ? parseInt(String(req.query.year), 10) : undefined,
        month: req.query.month ? parseInt(String(req.query.month), 10) : undefined,
        status: req.query.status as string | undefined,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/salary-records/employee-dossier/:employeeId',
    requireAnyPermissions(['hr.employees.read', 'hr.salaries.read', 'hr.advances.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const employeeId = String(req.params.employeeId);
      const employee = await employeeRepository.getById(employeeId, companyId);
      if (!employee) throw new HttpError(404, 'Employee not found.');
      const [salaries, advances, openAdvancesUsd] = await Promise.all([
        repository.listSalaries(companyId, { employeeId }),
        repository.listAdvances(companyId, { employeeId }),
        repository.sumOpenAdvanceBalance(companyId, employeeId),
      ]);
      res.json({
        success: true,
        data: { employee, salaries, advances, openAdvancesUsd },
      });
    }),
  );

  router.get(
    '/salary-records/:id',
    requirePermissions(['hr.salaries.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.getSalaryById(String(req.params.id), companyId);
      if (!data) throw new HttpError(404, 'Salary record not found.');
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/salary-records',
    requirePermissions(['hr.salaries.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = salaryCreateSchema.parse(req.body);
      const openUsd = await repository.sumOpenAdvanceBalance(companyId, body.employeeId);
      const salCur = (body.currency ?? 'USD').trim().toUpperCase();
      const periodDate = `${body.periodYear}-${String(body.periodMonth).padStart(2, '0')}-15`;
      let openMerged = openUsd;
      if (salCur !== 'USD') {
        const r = await resolveExchangeRateToUsd(exchangeRateRepository, companyId, salCur, periodDate);
        openMerged = Number((openUsd / r).toFixed(2));
      }
      const deductions = (body.deductions ?? 0) + openMerged;
      let data;
      try {
        data = await repository.createSalary({
          companyId,
          branchId: body.branchId ?? null,
          employeeId: body.employeeId,
          periodYear: body.periodYear,
          periodMonth: body.periodMonth,
          basicAmount: body.basicAmount,
          bonuses: body.bonuses ?? 0,
          deductions,
          currency: body.currency,
          paymentStatus: body.paymentStatus,
          notes: body.notes,
          createdBy: userId(req),
        });
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new HttpError(409, `راتب الموظف لشهر ${body.periodMonth}/${body.periodYear} مسجّل مسبقاً.`);
        }
        throw err;
      }
      auditService.logAsync({ req, action: 'SALARY_CREATED', entityType: 'salary_record', entityId: data.id, metadata: { employeeId: data.employee_id, period: `${data.period_year}-${data.period_month}` } });
      res.status(201).json({ success: true, data });
    }),
  );

  router.put(
    '/salary-records/:id',
    requirePermissions(['hr.salaries.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = salaryUpdateSchema.parse(req.body);
      const data = await repository.updateSalary(String(req.params.id), companyId, body);
      if (!data) throw new HttpError(404, 'Salary record not found.');
      auditService.logAsync({ req, action: 'SALARY_UPDATED', entityType: 'salary_record', entityId: data.id, metadata: { status: data.payment_status } });
      res.json({ success: true, data });
    }),
  );

  router.delete(
    '/salary-records/:id',
    requirePermissions(['hr.salaries.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repository.deleteSalary(String(req.params.id), companyId);
      if (!removed) throw new HttpError(404, 'Salary record not found.');
      auditService.logAsync({ req, action: 'SALARY_DELETED', entityType: 'salary_record', entityId: String(req.params.id) });
      res.json({ success: true });
    }),
  );

  // ── Advances ───────────────────────────────────────────────────────────────

  router.get(
    '/employee-advances',
    requirePermissions(['hr.advances.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.listAdvances(companyId, {
        employeeId: req.query.employeeId as string | undefined,
        status: req.query.status as string | undefined,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/employee-advances/outstanding-total',
    requireAnyPermissions(['hr.advances.read', 'hr.salaries.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : '';
      if (!employeeId) throw new HttpError(400, 'employeeId is required.');
      const target = String(req.query.targetCurrency ?? 'USD').trim().toUpperCase();
      let total = await repository.sumOpenAdvanceBalance(companyId, employeeId);
      if (target !== 'USD') {
        const d = new Date().toISOString().slice(0, 10);
        const r = await resolveExchangeRateToUsd(exchangeRateRepository, companyId, target, d);
        total = Number((total / r).toFixed(2));
      }
      res.json({ success: true, data: { outstandingTotal: total, targetCurrency: target } });
    }),
  );

  router.get(
    '/advance-usd-quote',
    requireAnyPermissions(['hr.advances.read', 'hr.advances.write', 'hr.salaries.read', 'hr.salaries.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const amount = parseFloat(String(req.query.amount ?? '0'));
      const currency = String(req.query.currency ?? 'USD').trim().toUpperCase();
      const date = String(req.query.date ?? new Date().toISOString()).slice(0, 10);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, 'amount must be a positive number.');
      }
      const rate = await resolveExchangeRateToUsd(exchangeRateRepository, companyId, currency, date);
      res.json({ success: true, data: { rate, usdEquivalent: Number((amount * rate).toFixed(2)) } });
    }),
  );

  router.get(
    '/employee-advances/:id',
    requirePermissions(['hr.advances.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.getAdvanceById(String(req.params.id), companyId);
      if (!data) throw new HttpError(404, 'Advance not found.');
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/employee-advances',
    requirePermissions(['hr.advances.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = advanceCreateSchema.parse(req.body);
      const cur = (body.currency ?? 'USD').trim().toUpperCase();
      const advDate = (body.advanceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const exchangeRateToUsd = await resolveExchangeRateToUsd(exchangeRateRepository, companyId, cur, advDate);
      const data = await repository.createAdvance({
        companyId,
        branchId: body.branchId ?? null,
        employeeId: body.employeeId,
        amount: body.amount,
        currency: body.currency,
        advanceDate: body.advanceDate,
        expectedRepay: body.expectedRepay,
        notes: body.notes,
        createdBy: userId(req),
        exchangeRateToUsd,
      });
      await syncAdvanceOutstandingToPendingSalary(repository, exchangeRateRepository, companyId, null, data);
      auditService.logAsync({ req, action: 'ADVANCE_CREATED', entityType: 'employee_advance', entityId: data.id, metadata: { employeeId: data.employee_id, amount: data.amount } });
      res.status(201).json({ success: true, data });
    }),
  );

  router.put(
    '/employee-advances/:id',
    requirePermissions(['hr.advances.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const body = advanceUpdateSchema.parse(req.body);
      const existing = await repository.getAdvanceById(String(req.params.id), companyId);
      if (!existing) throw new HttpError(404, 'Advance not found.');
      if (body.amount !== undefined || body.currency !== undefined) {
        if (existing.status !== 'pending' || parseFloat(existing.repaid_amount) > 0) {
          throw new HttpError(400, 'تعديل المبلغ أو العملة متاح فقط للسلفة المعلقة دون أي سداد.');
        }
      }
      let exchangeRateToUsd: number | undefined;
      if (
        existing.status === 'pending' &&
        parseFloat(existing.repaid_amount) === 0 &&
        (body.amount !== undefined || body.currency !== undefined)
      ) {
        const newCur = (body.currency ?? existing.currency).trim().toUpperCase();
        const dateStr = String(existing.advance_date).slice(0, 10);
        exchangeRateToUsd = await resolveExchangeRateToUsd(exchangeRateRepository, companyId, newCur, dateStr);
      }
      const data = await repository.updateAdvance(String(req.params.id), companyId, {
        repaidAmount: body.repaidAmount,
        status: body.status,
        notes: body.notes,
        expectedRepay: body.expectedRepay,
        amount: body.amount,
        currency: body.currency,
        exchangeRateToUsd,
      });
      if (!data) throw new HttpError(404, 'Advance not found.');
      await syncAdvanceOutstandingToPendingSalary(repository, exchangeRateRepository, companyId, existing, data);
      auditService.logAsync({ req, action: 'ADVANCE_UPDATED', entityType: 'employee_advance', entityId: data.id, metadata: { status: data.status, repaidAmount: data.repaid_amount } });
      res.json({ success: true, data });
    }),
  );

  router.delete(
    '/employee-advances/:id',
    requirePermissions(['hr.advances.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const existing = await repository.getAdvanceById(String(req.params.id), companyId);
      if (!existing) throw new HttpError(404, 'Advance not found.');
      const removed = await repository.deleteAdvance(String(req.params.id), companyId);
      if (!removed) throw new HttpError(404, 'Advance not found.');
      const oldOutUsd = advanceOutstandingForPayroll(existing);
      if (oldOutUsd > 0) {
        const { y, m } = periodFromAdvanceDate(existing.advance_date);
        const salCur = await repository.getPendingSalaryCurrencyForPeriod(companyId, existing.employee_id, y, m);
        const delta = await usdDeltaToSalaryDeductionCurrency(
          exchangeRateRepository,
          companyId,
          -oldOutUsd,
          salCur,
          y,
          m,
        );
        await repository.adjustPendingSalaryDeductions(companyId, existing.employee_id, y, m, delta);
      }
      auditService.logAsync({ req, action: 'ADVANCE_DELETED', entityType: 'employee_advance', entityId: String(req.params.id) });
      res.json({ success: true });
    }),
  );

  return router;
}
