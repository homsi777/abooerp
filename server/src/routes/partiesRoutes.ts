/**
 * /api/v1/parties — unified party endpoints
 *
 * GET /api/v1/parties/smart-search?query=...
 *   Returns mixed results from senders_receivers and customers,
 *   with type badges for the smart party picker UI.
 */

import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';

const router = Router();

router.get(
  '/smart-search',
  requirePermissions(['shipments.read']),
  asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const companyId = (req as any).requestUserContext?.companyId as string | undefined;
    const userType = String((req as any).requestUserContext?.userType ?? '').toLowerCase();
    const { query: q = '' } = req.query as Record<string, string>;

    const term = `%${q}%`;

    // ── 1. Quick contacts (senders_receivers) ────────────────────────────────
    const srConditions: string[] = ['sr.status = \'active\''];
    const srValues: unknown[] = [term, term];

    srConditions.push(`(sr.full_name ilike $1 or sr.phone ilike $2)`);

    if (userType === 'agent' && scope.agentId) {
      srValues.push(scope.agentId);
      srValues.push(scope.userId ?? '');
      srConditions.push(`(sr.agent_id = $${srValues.length - 1} or sr.created_by_user_id = $${srValues.length})`);
    }

    const srResult = await pool.query(
      `
      select
        sr.id,
        'quick_contact'   as type,
        sr.full_name      as display_name,
        sr.phone,
        sr.city,
        'زبون سريع'       as badge_label,
        'senders_receivers' as source_table,
        null::boolean     as is_account_customer
      from senders_receivers sr
      where ${srConditions.join(' and ')}
      order by sr.full_name
      limit 15
      `,
      srValues,
    );

    // ── 2. Registered customers ──────────────────────────────────────────────
    const cusConditions: string[] = ['c.status = \'active\''];
    const cusValues: unknown[] = [term, term];

    cusConditions.push(`(c.name ilike $1 or c.phone ilike $2 or c.code ilike $1)`);

    if (companyId) {
      cusValues.push(companyId);
      cusConditions.push(`(c.company_id = $${cusValues.length} or c.company_id is null)`);
    }

    if (userType === 'agent' && scope.agentId) {
      cusValues.push(scope.agentId);
      cusConditions.push(`c.agent_id = $${cusValues.length}`);
    }

    const cusResult = await pool.query(
      `
      select
        c.id,
        case when c.is_account_customer then 'account_customer' else 'customer' end as type,
        c.name                            as display_name,
        c.phone,
        c.city,
        case
          when c.is_account_customer then 'عميل حسابي'
          else 'عميل'
        end                               as badge_label,
        'customers'                       as source_table,
        c.is_account_customer
      from customers c
      where ${cusConditions.join(' and ')}
      order by c.is_account_customer desc, c.name
      limit 15
      `,
      cusValues,
    );

    // Merge and return
    const combined = [
      ...cusResult.rows,  // customers first (more prominent)
      ...srResult.rows,
    ].slice(0, 25);

    res.json({ success: true, data: combined });
  }),
);

export default router;
