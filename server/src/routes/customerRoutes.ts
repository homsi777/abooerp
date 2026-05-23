import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const customerCreateSchema = z.object({
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
  branch_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});

const customerUpdateSchema = customerCreateSchema.partial();

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

// ── Get customer shipments ─────────────────────────────────────────────────────
router.get(
  '/:id/shipments',
  requirePermissions(['customers.view', 'shipments.read']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page = '1', limit: limitStr = '20' } = req.query as Record<string, string>;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limitStr, 10);

    // Shipments linked to this customer (via sender/receiver who is the customer, or direct customer_id if present)
    const result = await pool.query(
      `
      select s.id, s.tracking_number, s.status, s.original_amount, s.currency_code,
             s.created_at, s.destination_city,
             sr_s.full_name as sender_name, sr_r.full_name as receiver_name
      from shipments s
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      left join senders_receivers sr_r on sr_r.id = s.receiver_id
      where s.deleted_at is null
        and (
          exists (
            select 1 from senders_receivers sr
            where sr.id in (s.sender_id, s.receiver_id)
              and sr.phone = (select phone from customers where id = $1 limit 1)
          )
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
    const body = customerCreateSchema.parse(req.body);
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

    const result = await pool.query(
      `
      insert into customers (
        code, name, phone, second_phone, company_name, customer_type,
        is_account_customer, credit_limit, default_currency_code,
        city, area, address, tax_number, notes,
        branch_id, agent_id, company_id, created_by_user_id, status
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
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

    res.status(201).json({ success: true, data: result.rows[0] });
  }),
);

// ── Update customer ───────────────────────────────────────────────────────────
router.put(
  '/:id',
  requirePermissions(['customers.manage']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = customerUpdateSchema.parse(req.body);
    const scope = parseDataScope(req);
    const userType = getUserType(req);

    // Check customer exists
    const existing = await pool.query(`select * from customers where id = $1`, [id]);
    if (!existing.rows[0]) throw new HttpError(404, 'العميل غير موجود');

    const customer = existing.rows[0] as any;

    // Agent scope enforcement
    if (userType === 'agent' && scope.agentId && customer.agent_id !== scope.agentId) {
      throw new HttpError(403, 'غير مصرح لك بتعديل هذا العميل');
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    const updatableFields: (keyof typeof body)[] = [
      'name', 'phone', 'second_phone', 'company_name', 'customer_type',
      'is_account_customer', 'credit_limit', 'default_currency_code',
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

    values.push(new Date());
    setClauses.push(`updated_at = $${values.length}`);
    values.push(id);

    const result = await pool.query(
      `update customers set ${setClauses.join(', ')} where id = $${values.length} returning *`,
      values,
    );

    res.json({ success: true, data: result.rows[0] });
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

export default router;
