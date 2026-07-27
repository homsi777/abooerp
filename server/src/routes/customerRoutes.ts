import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { syncCustomerOpeningBalance } from '../services/customerOpeningBalanceService.js';
import { HttpError } from '../utils/errors.js';
import { parseDataScope } from '../utils/scope.js';

const router = Router();

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptyToUndefined(value: unknown) {
  if (value === '' || value === null || value === undefined) return undefined;
  return value;
}

const optionalUuid = z.preprocess(
  emptyToUndefined,
  z.string().uuid({ message: 'معرّف غير صالح' }).optional(),
);

// ── Validation schemas ────────────────────────────────────────────────────────

const customerBaseSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1, 'اسم العميل مطلوب'),
  phone: z.string().optional(),
  second_phone: z.string().optional(),
  company_name: z.string().optional(),
  customer_type: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  is_account_customer: z.boolean().default(false),
  credit_limit: z.coerce.number().nonnegative().default(0),
  default_currency_code: z.string().default('SYP'),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  tax_number: z.string().optional(),
  notes: z.string().optional(),
  branch_id: optionalUuid,
  agent_id: optionalUuid,
  status: z.enum(['active', 'inactive']).default('active'),
  opening_balance_amount: z.coerce.number().nonnegative().default(0),
  opening_balance_side: z.enum(['debit', 'credit']).default('debit'),
});

const customerCreateSchema = customerBaseSchema.superRefine((data, ctx) => {
  if (data.is_account_customer && !String(data.phone ?? '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'الهاتف مطلوب للعميل الحسابي لربطه بالذمم والكشوفات.',
    });
  }
  if (!data.is_account_customer && Number(data.opening_balance_amount ?? 0) > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['opening_balance_amount'],
      message: 'الرصيد الافتتاحي متاح للعملاء الحسابيين فقط.',
    });
  }
});

const customerUpdateSchema = customerBaseSchema.partial();

function assertAccountCustomerPhone(isAccountCustomer: boolean, phone?: string | null) {
  if (isAccountCustomer && !String(phone ?? '').trim()) {
    throw new HttpError(400, 'الهاتف مطلوب للعميل الحسابي لربطه بالذمم والكشوفات.');
  }
}

function parseCustomerBody(body: unknown, mode: 'create' | 'update') {
  const schema = mode === 'create' ? customerCreateSchema : customerUpdateSchema;
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  const field = first?.path?.join('.') || 'body';
  throw new HttpError(400, first?.message || `بيانات غير صالحة (${field})`);
}

// ── Helper: resolve company_id for request ────────────────────────────────────
function getCompanyId(req: any): string | undefined {
  return req.requestUserContext?.companyId as string | undefined;
}

function getUserId(req: any): string | undefined {
  return req.requestUserContext?.userId as string | undefined;
}

function getUserType(req: any): string {
  return String(req.requestUserContext?.userType ?? '').toLowerCase();
}

// ── Auto-generate customer code ───────────────────────────────────────────────
async function generateCustomerCode(companyId: string | undefined): Promise<string> {
  const prefix = 'CUS';
  const result = await pool.query(
    `select count(*) as cnt from customers where company_id = $1 or company_id is null`,
    [companyId ?? null],
  );
  const cnt = parseInt((result.rows[0] as any).cnt, 10) + 1;
  return `${prefix}-${String(cnt).padStart(5, '0')}`;
}

// ── List customers ────────────────────────────────────────────────────────────
router.get(
  '/',
  requirePermissions(['customers.view']),
  asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const companyId = getCompanyId(req);
    const userType = getUserType(req);

    const {
      search,
      customer_type,
      is_account_customer,
      city,
      branch_id,
      agent_id,
      status,
      page = '1',
      limit: limitStr = '50',
    } = req.query as Record<string, string | undefined>;

    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];

    // Company scope
    if (companyId) {
      conditions.push(`(c.company_id = $${values.length + 1} or c.company_id is null)`);
      values.push(companyId);
    }

    // Agent scope: agent users see only their customers
    if (userType === 'agent' && scope.agentId) {
      conditions.push(`c.agent_id = $${values.length + 1}`);
      values.push(scope.agentId);
    }

    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      conditions.push(`(c.name ilike $${idx} or c.phone ilike $${idx} or c.code ilike $${idx} or c.company_name ilike $${idx})`);
    }
    if (customer_type) {
      conditions.push(`c.customer_type = $${values.length + 1}`);
      values.push(customer_type);
    }
    if (is_account_customer !== undefined && is_account_customer !== '') {
      conditions.push(`c.is_account_customer = $${values.length + 1}`);
      values.push(is_account_customer === 'true');
    }
    if (city) {
      conditions.push(`c.city ilike $${values.length + 1}`);
      values.push(`%${city}%`);
    }
    if (branch_id) {
      conditions.push(`c.branch_id = $${values.length + 1}`);
      values.push(branch_id);
    }
    if (agent_id) {
      conditions.push(`c.agent_id = $${values.length + 1}`);
      values.push(agent_id);
    }
    if (status) {
      conditions.push(`c.status = $${values.length + 1}`);
      values.push(status);
    }

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limitStr, 10);

    const where = conditions.join(' and ');

    const countResult = await pool.query(
      `select count(*) as total from customers c where ${where}`,
      values,
    );

    const dataResult = await pool.query(
      `
      select
        c.*,
        b.name as branch_name,
        a.name as agent_name
      from customers c
      left join branches b on b.id = c.branch_id
      left join agents   a on a.id = c.agent_id
      where ${where}
      order by c.created_at desc
      limit $${values.length + 1} offset $${values.length + 2}
      `,
      [...values, parseInt(limitStr, 10), offset],
    );

    res.json({
      success: true,
      data: dataResult.rows,
      total: parseInt((countResult.rows[0] as any).total, 10),
      page: parseInt(page, 10),
      limit: parseInt(limitStr, 10),
    });
  }),
);

// ── Search customers (for smart picker) ──────────────────────────────────────
router.get(
  '/search',
  requirePermissions(['customers.view']),
  asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const companyId = getCompanyId(req);
    const userType = getUserType(req);
    const { q = '' } = req.query as Record<string, string>;

    const conditions: string[] = ['c.status = \'active\''];
    const values: unknown[] = [];

    if (companyId) {
      conditions.push(`(c.company_id = $${values.length + 1} or c.company_id is null)`);
      values.push(companyId);
    }

    if (userType === 'agent' && scope.agentId) {
      conditions.push(`c.agent_id = $${values.length + 1}`);
      values.push(scope.agentId);
    }

    if (q) {
      values.push(`%${q}%`);
      const idx = values.length;
      conditions.push(`(c.name ilike $${idx} or c.phone ilike $${idx} or c.code ilike $${idx})`);
    }

    const result = await pool.query(
      `
      select id, code, name, phone, city, is_account_customer, customer_type, agent_id
      from customers c
      where ${conditions.join(' and ')}
      order by c.name
      limit 20
      `,
      values,
    );

    res.json({ success: true, data: result.rows });
  }),
);

// ── Get single customer ───────────────────────────────────────────────────────
router.get(
  '/:id',
  requirePermissions(['customers.view']),
  asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const userType = getUserType(req);
    const { id } = req.params;

    const result = await pool.query(
      `
      select
        c.*,
        b.name as branch_name,
        a.name as agent_name
      from customers c
      left join branches b on b.id = c.branch_id
      left join agents   a on a.id = c.agent_id
      where c.id = $1
      `,
      [id],
    );

    if (!result.rows[0]) throw new HttpError(404, 'العميل غير موجود');

    const customer = result.rows[0] as any;

    // Agent scope enforcement
    if (userType === 'agent' && scope.agentId && customer.agent_id !== scope.agentId) {
      throw new HttpError(403, 'غير مصرح لك بعرض هذا العميل');
    }

    res.json({ success: true, data: customer });
  }),
);

// ── Get customer financial summary ────────────────────────────────────────────
router.get(
  '/:id/financial-summary',
  requirePermissions(['customers.view', 'customers.account.view']),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!uuidRegex.test(id)) throw new HttpError(400, 'معرّف العميل غير صالح');

    const customerResult = await pool.query(
      `select id, name, is_account_customer, default_currency_code, opening_balance_amount, opening_balance_side from customers where id = $1`,
      [id],
    );
    if (!customerResult.rows[0]) throw new HttpError(404, 'العميل غير موجود');
    const customer = customerResult.rows[0] as {
      id: string;
      name: string;
      is_account_customer: boolean;
      default_currency_code: string;
      opening_balance_amount: string | number;
      opening_balance_side: 'debit' | 'credit';
    };

    if (!customer.is_account_customer) {
      res.json({
        success: true,
        data: {
          isAccountCustomer: false,
          currencyCode: customer.default_currency_code,
          openingBalanceAmount: 0,
          openingBalanceSide: 'debit' as const,
          totalDebit: 0,
          totalCredit: 0,
          balance: 0,
          movementCount: 0,
          shipmentCount: 0,
        },
      });
      return;
    }

    const movementResult = await pool.query(
      `
      select
        pfm.original_currency as currency_code,
        coalesce(sum(case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_debit,
        coalesce(sum(case when pfm.direction in ('credit', 'outflow') then coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_credit,
        count(*)::int as movement_count
      from party_financial_movements pfm
      where pfm.party_type = 'customer'
        and pfm.party_id = $1::uuid
        and pfm.is_reversal = false
      group by pfm.original_currency
      order by movement_count desc
      limit 1
      `,
      [id],
    );

    const shipmentCountResult = await pool.query<{ count: string }>(
      `
      select count(*)::text as count
      from shipments s
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      where s.deleted_at is null
        and (
          s.customer_id = $1::uuid
          or (s.financial_responsibility_type = 'ACCOUNT_CUSTOMER' and s.financial_responsibility_id = $1::uuid)
          or lower(trim(coalesce(sr_s.full_name, ''))) = lower(trim((select name from customers where id = $1::uuid)))
          or lower(trim(coalesce(sr_r.full_name, ''))) = lower(trim((select name from customers where id = $1::uuid)))
        )
      `,
      [id],
    );

    const row = movementResult.rows[0] as {
      currency_code?: string;
      total_debit?: string | number;
      total_credit?: string | number;
      movement_count?: string | number;
    } | undefined;

    const totalDebit = Number(row?.total_debit ?? 0);
    const totalCredit = Number(row?.total_credit ?? 0);

    res.json({
      success: true,
      data: {
        isAccountCustomer: true,
        currencyCode: row?.currency_code ?? customer.default_currency_code,
        openingBalanceAmount: Number(customer.opening_balance_amount ?? 0),
        openingBalanceSide: customer.opening_balance_side ?? 'debit',
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
        movementCount: Number(row?.movement_count ?? 0),
        shipmentCount: Number(shipmentCountResult.rows[0]?.count ?? 0),
      },
    });
  }),
);

// ── Get customer shipments ─────────────────────────────────────────────────────
router.get(
  '/:id/shipments',
  requirePermissions(['customers.view', 'shipments.read']),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!uuidRegex.test(id)) throw new HttpError(400, 'معرّف العميل غير صالح');
    const { page = '1', limit: limitStr = '20' } = req.query as Record<string, string>;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limitStr, 10);

    const result = await pool.query(
      `
      select
        s.id,
        s.shipment_no,
        s.status,
        s.financial_status,
        s.original_amount,
        s.original_currency as currency_code,
        s.created_at,
        s.destination_city,
        sr_s.full_name as sender_name,
        sr_r.full_name as receiver_name
      from shipments s
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      left join senders_receivers sr_r on sr_r.id = s.receiver_id
      where s.deleted_at is null
        and (
          s.customer_id = $1::uuid
          or (s.financial_responsibility_type = 'ACCOUNT_CUSTOMER' and s.financial_responsibility_id = $1::uuid)
          or lower(trim(coalesce(sr_s.full_name, ''))) = lower(trim((select name from customers where id = $1::uuid)))
          or lower(trim(coalesce(sr_r.full_name, ''))) = lower(trim((select name from customers where id = $1::uuid)))
        )
      order by s.created_at desc
      limit $2 offset $3
      `,
      [id, parseInt(limitStr, 10), offset],
    );

    res.json({ success: true, data: result.rows });
  }),
);

// ── Create customer ───────────────────────────────────────────────────────────
router.post(
  '/',
  requirePermissions(['customers.manage']),
  asyncHandler(async (req, res) => {
    const body = parseCustomerBody(req.body, 'create');
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const scope = parseDataScope(req);
    const userType = getUserType(req);

    // Agent users: auto-link customer to their agent
    const effectiveAgentId =
      userType === 'agent' && scope.agentId
        ? scope.agentId
        : (body.agent_id ?? null);

    // Auto-generate code if not provided
    const code = body.code ?? (await generateCustomerCode(companyId));

    const client = await pool.connect();
    try {
      await client.query('begin');

      const result = await client.query(
        `
        insert into customers (
          code, name, phone, second_phone, company_name, customer_type,
          is_account_customer, credit_limit, default_currency_code,
          opening_balance_amount, opening_balance_side,
          city, area, address, tax_number, notes,
          branch_id, agent_id, company_id, created_by_user_id, status
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
        )
        returning *
        `,
        [
          code,
          body.name,
          body.phone ?? null,
          body.second_phone ?? null,
          body.company_name ?? null,
          body.customer_type,
          body.is_account_customer,
          body.credit_limit,
          body.default_currency_code,
          body.is_account_customer ? body.opening_balance_amount : 0,
          body.is_account_customer ? body.opening_balance_side : 'debit',
          body.city ?? null,
          body.area ?? null,
          body.address ?? null,
          body.tax_number ?? null,
          body.notes ?? null,
          body.branch_id ?? null,
          effectiveAgentId,
          companyId ?? null,
          userId ?? null,
          body.status,
        ],
      );

      const created = result.rows[0] as {
        id: string;
        code: string;
        is_account_customer: boolean;
        opening_balance_amount: number;
        opening_balance_side: 'debit' | 'credit';
        default_currency_code: string;
        branch_id: string | null;
        agent_id: string | null;
      };

      await syncCustomerOpeningBalance(
        {
          customerId: created.id,
          companyId,
          isAccountCustomer: Boolean(created.is_account_customer),
          amount: Number(created.opening_balance_amount ?? 0),
          side: created.opening_balance_side ?? 'debit',
          currencyCode: created.default_currency_code,
          branchId: created.branch_id,
          agentId: created.agent_id,
          userId: userId ?? null,
          referenceNo: created.code,
        },
        client,
      );

      await client.query('commit');
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }),
);

// ── Update customer ───────────────────────────────────────────────────────────
router.put(
  '/:id',
  requirePermissions(['customers.manage']),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!uuidRegex.test(id)) throw new HttpError(400, 'معرّف العميل غير صالح');
    const body = parseCustomerBody(req.body, 'update');
    const scope = parseDataScope(req);
    const userType = getUserType(req);

    const userId = getUserId(req);

    // Check customer exists
    const existing = await pool.query(`select * from customers where id = $1`, [id]);
    if (!existing.rows[0]) throw new HttpError(404, 'العميل غير موجود');

    const customer = existing.rows[0] as any;

    // Agent scope enforcement
    if (userType === 'agent' && scope.agentId && customer.agent_id !== scope.agentId) {
      throw new HttpError(403, 'غير مصرح لك بتعديل هذا العميل');
    }

    const nextIsAccountCustomer = body.is_account_customer ?? Boolean(customer.is_account_customer);
    const nextPhone = body.phone !== undefined ? body.phone : customer.phone;
    assertAccountCustomerPhone(nextIsAccountCustomer, nextPhone);

    const setClauses: string[] = [];
    const values: unknown[] = [];

    const updatableFields: (keyof typeof body)[] = [
      'name', 'phone', 'second_phone', 'company_name', 'customer_type',
      'is_account_customer', 'credit_limit', 'default_currency_code',
      'opening_balance_amount', 'opening_balance_side',
      'city', 'area', 'address', 'tax_number', 'notes',
      'branch_id', 'agent_id', 'status',
    ];

    for (const field of updatableFields) {
      if (body[field] !== undefined) {
        values.push(body[field]);
        setClauses.push(`${field} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      res.json({ success: true, data: customer });
      return;
    }

    if (!nextIsAccountCustomer) {
      values.push(0);
      setClauses.push(`opening_balance_amount = $${values.length}`);
      values.push('debit');
      setClauses.push(`opening_balance_side = $${values.length}`);
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      values.push(new Date());
      setClauses.push(`updated_at = $${values.length}`);
      values.push(id);

      const result = await client.query(
        `update customers set ${setClauses.join(', ')} where id = $${values.length} returning *`,
        values,
      );

      const updated = result.rows[0] as {
        id: string;
        code: string;
        is_account_customer: boolean;
        opening_balance_amount: number;
        opening_balance_side: 'debit' | 'credit';
        default_currency_code: string;
        branch_id: string | null;
        agent_id: string | null;
      };

      await syncCustomerOpeningBalance(
        {
          customerId: updated.id,
          companyId: customer.company_id ?? getCompanyId(req),
          isAccountCustomer: Boolean(updated.is_account_customer),
          amount: Number(updated.opening_balance_amount ?? 0),
          side: updated.opening_balance_side ?? 'debit',
          currencyCode: updated.default_currency_code,
          branchId: updated.branch_id,
          agentId: updated.agent_id,
          userId: userId ?? null,
          referenceNo: updated.code,
        },
        client,
      );

      await client.query('commit');
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }),
);

// ── Toggle active status ──────────────────────────────────────────────────────
router.patch(
  '/:id/toggle-status',
  requirePermissions(['customers.manage']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await pool.query(`select status from customers where id = $1`, [id]);
    if (!existing.rows[0]) throw new HttpError(404, 'العميل غير موجود');

    const newStatus = (existing.rows[0] as any).status === 'active' ? 'inactive' : 'active';

    const result = await pool.query(
      `update customers set status = $1, updated_at = now() where id = $2 returning *`,
      [newStatus, id],
    );

    res.json({ success: true, data: result.rows[0] });
  }),
);

export default router;
