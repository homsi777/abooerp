import { Router } from 'express';
import { requireAnyPermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { pool } from '../db/pool.js';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function buildShipmentScopeWhere(scope: ReturnType<typeof parseDataScope>, startIndex = 1, alias = 's') {
  const values: unknown[] = [];
  const conditions: string[] = [`${alias}.deleted_at is null`];
  if (scope.companyId) {
    values.push(scope.companyId);
    conditions.push(`${alias}.company_id = $${startIndex + values.length - 1}::uuid`);
  }
  if (scope.branchId) {
    values.push(scope.branchId);
    conditions.push(`${alias}.branch_id = $${startIndex + values.length - 1}::uuid`);
  }
  if (scope.agentId) {
    values.push(scope.agentId);
    conditions.push(`${alias}.agent_id = $${startIndex + values.length - 1}::uuid`);
  }
  return { values, conditions };
}

export function createDashboardRouter() {
  const router = Router();

  router.get(
    '/overview',
    requireAnyPermissions(['shipments.read', 'shipments.view', 'agent_portal.view', 'finance.read', 'finance.view']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const today = startOfToday();
      const monthStart = startOfMonth();
      const scoped = buildShipmentScopeWhere(scope);
      const whereSql = `where ${scoped.conditions.join(' and ')}`;

      const [
        shipmentsKpi,
        statusRows,
        financeRows,
        codRows,
        recentRows,
        agentRows,
        branchRows,
      ] = await Promise.all([
        pool.query(
          `
          select
            count(*)::int as total_shipments,
            count(*) filter (where s.created_at >= $${scoped.values.length + 1}::timestamptz)::int as today_shipments,
            count(*) filter (where s.created_at >= $${scoped.values.length + 2}::timestamptz)::int as month_shipments,
            count(*) filter (where coalesce(s.payment_status, 'UNPAID') <> 'PAID')::int as open_collection_shipments,
            count(*) filter (where s.financial_status = 'UNPOSTED')::int as unposted_shipments
          from shipments s
          ${whereSql}
          `,
          [...scoped.values, today, monthStart],
        ),
        pool.query(
          `
          select s.status, count(*)::int as count
          from shipments s
          ${whereSql}
          group by s.status
          order by count desc, s.status asc
          `,
          scoped.values,
        ),
        pool.query(
          `
          select
            pfm.original_currency as currency_code,
            coalesce(sum(case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_debit,
            coalesce(sum(case when pfm.direction in ('credit', 'outflow') then coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_credit,
            coalesce(sum(case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else -coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) end), 0)::numeric as net_balance
          from party_financial_movements pfm
          left join shipments s on s.id = pfm.shipment_id
          where pfm.is_reversal = false
            ${scope.companyId ? `and coalesce(s.company_id, (select company_id from branches where id = pfm.branch_id limit 1)) = $1::uuid` : ''}
            ${scope.branchId ? `and pfm.branch_id = $${scope.companyId ? 2 : 1}::uuid` : ''}
            ${scope.agentId ? `and pfm.agent_id = $${(scope.companyId ? 1 : 0) + (scope.branchId ? 1 : 0) + 1}::uuid` : ''}
          group by pfm.original_currency
          order by pfm.original_currency
          `,
          [scope.companyId, scope.branchId, scope.agentId].filter(Boolean),
        ),
        pool.query(
          `
          select
            s.original_currency as currency_code,
            coalesce(sum(
              (
                case
                  when coalesce(s.transfer_fee, 0) <> 0 or coalesce(s.additional_charges, 0) <> 0 or coalesce(s.prepaid_amount, 0) <> 0 or coalesce(s.discount_amount, 0) <> 0
                  then greatest(coalesce(s.original_amount, 0) - coalesce(s.transfer_fee, 0) - coalesce(s.additional_charges, 0) + coalesce(s.prepaid_amount, 0) + coalesce(s.discount_amount, 0), 0)
                  else coalesce(s.freight_charge, s.original_amount, 0)
                end
              )
              + coalesce(s.transfer_fee, 0)
              + coalesce(s.additional_charges, 0)
              - coalesce(s.prepaid_amount, 0)
              - coalesce(s.discount_amount, 0)
            ), 0)::numeric as total_due,
            coalesce(sum(coalesce(s.paid_amount, 0)), 0)::numeric as collected,
            coalesce(sum(greatest(
              (
                (
                  case
                    when coalesce(s.transfer_fee, 0) <> 0 or coalesce(s.additional_charges, 0) <> 0 or coalesce(s.prepaid_amount, 0) <> 0 or coalesce(s.discount_amount, 0) <> 0
                    then greatest(coalesce(s.original_amount, 0) - coalesce(s.transfer_fee, 0) - coalesce(s.additional_charges, 0) + coalesce(s.prepaid_amount, 0) + coalesce(s.discount_amount, 0), 0)
                    else coalesce(s.freight_charge, s.original_amount, 0)
                  end
                )
                + coalesce(s.transfer_fee, 0)
                + coalesce(s.additional_charges, 0)
                - coalesce(s.prepaid_amount, 0)
                - coalesce(s.discount_amount, 0)
              ) - coalesce(s.paid_amount, 0),
              0
            )), 0)::numeric as remaining
          from shipments s
          ${whereSql}
          group by s.original_currency
          order by s.original_currency
          `,
          scoped.values,
        ),
        pool.query(
          `
          select
            s.id,
            s.shipment_no,
            s.created_at,
            s.status,
            s.payment_status,
            s.original_currency,
            s.original_amount,
            s.destination_city,
            b.name as branch_name,
            ag.name as agent_name,
            sr_s.full_name as sender_name,
            sr_r.full_name as receiver_name
          from shipments s
          left join branches b on b.id = s.branch_id
          left join agents ag on ag.id = s.agent_id
          left join senders_receivers sr_s on sr_s.id = s.sender_id
          left join senders_receivers sr_r on sr_r.id = s.receiver_id
          ${whereSql}
          order by s.created_at desc
          limit 10
          `,
          scoped.values,
        ),
        pool.query(
          `
          select
            ag.id,
            ag.name,
            count(s.id)::int as shipment_count,
            count(s.id) filter (where coalesce(s.payment_status, 'UNPAID') <> 'PAID')::int as open_collection_count
          from agents ag
          left join branches b on b.id = ag.branch_id
          left join shipments s on s.agent_id = ag.id and s.deleted_at is null
          where ($1::uuid is null or b.company_id = $1::uuid)
            and ($2::uuid is null or ag.branch_id = $2::uuid)
            and ($3::uuid is null or ag.id = $3::uuid)
          group by ag.id, ag.name
          having count(s.id) > 0
          order by shipment_count desc, ag.name asc
          limit 6
          `,
          [scope.companyId ?? null, scope.branchId ?? null, scope.agentId ?? null],
        ),
        pool.query(
          `
          select
            (select count(*)::int from branches b where ($1::uuid is null or b.company_id = $1::uuid) and ($2::uuid is null or b.id = $2::uuid)) as branches_count,
            (select count(*)::int from agents a left join branches b on b.id = a.branch_id where ($1::uuid is null or b.company_id = $1::uuid) and ($2::uuid is null or a.branch_id = $2::uuid) and ($3::uuid is null or a.id = $3::uuid)) as agents_count
          `,
          [scope.companyId ?? null, scope.branchId ?? null, scope.agentId ?? null],
        ),
      ]);

      res.json({
        success: true,
        data: {
          scope: {
            companyId: scope.companyId ?? null,
            branchId: scope.branchId ?? null,
            agentId: scope.agentId ?? null,
            isAgentScope: Boolean(scope.agentId),
          },
          shipments: shipmentsKpi.rows[0] ?? {},
          statuses: statusRows.rows,
          finance: financeRows.rows,
          cod: codRows.rows,
          recentShipments: recentRows.rows,
          topAgents: agentRows.rows,
          operations: branchRows.rows[0] ?? { branches_count: 0, agents_count: 0 },
          generatedAt: new Date().toISOString(),
        },
      });
    }),
  );

  return router;
}
