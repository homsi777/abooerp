import { pool } from '../db/pool.js';
import { computeAgentBalanceDue, computeAgentHawalaRemittanceDue, computeAgentShippingRemittanceDue, computeCommissionOnPrepaidPortion, resolvePrepaidAtMainBranch, } from '../utils/agentShipmentSettlement.js';
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function buildBranchScope(scope, values, alias) {
    const conditions = [];
    if (scope?.companyId) {
        values.push(scope.companyId);
        conditions.push(`${alias}.company_id = $${values.length}::uuid`);
    }
    if (scope?.branchId) {
        values.push(scope.branchId);
        conditions.push(`${alias}.branch_id = $${values.length}::uuid`);
    }
    return conditions;
}
export class AccountingReportsService {
    async getTrialBalance(scope, filters) {
        const currency = (filters.currencyCode ?? 'USD').toUpperCase();
        const fromAt = filters.fromAt;
        const toAt = filters.toAt ?? filters.asOf;
        const cashboxValues = [currency];
        const cashboxConditions = [`upper(cb.currency_code) = upper($1)`, 'cb.is_active = true'];
        if (scope?.companyId) {
            cashboxValues.push(scope.companyId);
            cashboxConditions.push(`cb.company_id = $${cashboxValues.length}::uuid`);
        }
        if (filters.branchId) {
            cashboxValues.push(filters.branchId);
            cashboxConditions.push(`cb.branch_id = $${cashboxValues.length}::uuid`);
        }
        else if (scope?.branchId) {
            cashboxValues.push(scope.branchId);
            cashboxConditions.push(`cb.branch_id = $${cashboxValues.length}::uuid`);
        }
        const cashboxes = await pool.query(`
      select cb.code, cb.name, coalesce(cb.current_balance, 0)::numeric as balance
      from cashboxes cb
      where ${cashboxConditions.join(' and ')}
      order by cb.code
      `, cashboxValues);
        const partyValues = [];
        const partyConditions = ['pfm.is_reversal = false', `pfm.party_type in ('agent', 'customer')`];
        if (scope?.companyId) {
            partyValues.push(scope.companyId);
            partyConditions.push(`exists (
        select 1 from branches b_scope
        where b_scope.id = pfm.branch_id and b_scope.company_id = $${partyValues.length}::uuid
      )`);
        }
        if (filters.branchId) {
            partyValues.push(filters.branchId);
            partyConditions.push(`pfm.branch_id = $${partyValues.length}::uuid`);
        }
        else if (scope?.branchId) {
            partyValues.push(scope.branchId);
            partyConditions.push(`pfm.branch_id = $${partyValues.length}::uuid`);
        }
        if (currency) {
            partyValues.push(currency);
            partyConditions.push(`upper(pfm.original_currency) = upper($${partyValues.length})`);
        }
        if (fromAt) {
            partyValues.push(fromAt);
            partyConditions.push(`coalesce(pfm.posted_at, pfm.created_at) >= $${partyValues.length}::timestamptz`);
        }
        if (toAt) {
            partyValues.push(toAt);
            partyConditions.push(`coalesce(pfm.posted_at, pfm.created_at) <= $${partyValues.length}::timestamptz`);
        }
        const partyAgg = await pool.query(`
      select
        pfm.party_type,
        coalesce(sum(case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_debit,
        coalesce(sum(case when pfm.direction in ('credit', 'outflow') then coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) else 0 end), 0)::numeric as total_credit
      from party_financial_movements pfm
      where ${partyConditions.join(' and ')}
      group by pfm.party_type
      `, partyValues);
        const expenseValues = [];
        const expenseConditions = [
            'pv.related_entity_type = \'expense\'',
            'pv.status = \'confirmed\'',
        ];
        const expenseScope = buildBranchScope(scope, expenseValues, 'pv');
        expenseConditions.push(...expenseScope);
        if (filters.branchId) {
            expenseValues.push(filters.branchId);
            expenseConditions.push(`pv.branch_id = $${expenseValues.length}::uuid`);
        }
        if (currency) {
            expenseValues.push(currency);
            expenseConditions.push(`upper(pv.original_currency) = upper($${expenseValues.length})`);
        }
        if (fromAt) {
            expenseValues.push(fromAt);
            expenseConditions.push(`pv.created_at >= $${expenseValues.length}::timestamptz`);
        }
        if (toAt) {
            expenseValues.push(toAt);
            expenseConditions.push(`pv.created_at <= $${expenseValues.length}::timestamptz`);
        }
        const expenseTotal = await pool.query(`
      select coalesce(sum(pv.original_amount), 0)::numeric as total
      from payment_vouchers pv
      where ${expenseConditions.join(' and ')}
      `, expenseValues);
        const shipmentValues = [];
        const shipmentConditions = ['s.deleted_at is null', `upper(s.status) <> 'CANCELLED'`];
        if (scope?.companyId) {
            shipmentValues.push(scope.companyId);
            shipmentConditions.push(`s.company_id = $${shipmentValues.length}::uuid`);
        }
        if (filters.branchId) {
            shipmentValues.push(filters.branchId);
            shipmentConditions.push(`s.branch_id = $${shipmentValues.length}::uuid`);
        }
        else if (scope?.branchId) {
            shipmentValues.push(scope.branchId);
            shipmentConditions.push(`s.branch_id = $${shipmentValues.length}::uuid`);
        }
        if (currency) {
            shipmentValues.push(currency);
            shipmentConditions.push(`upper(s.original_currency) = upper($${shipmentValues.length})`);
        }
        if (fromAt) {
            shipmentValues.push(fromAt);
            shipmentConditions.push(`coalesce(s.effective_date::timestamptz, s.created_at) >= $${shipmentValues.length}::timestamptz`);
        }
        if (toAt) {
            shipmentValues.push(toAt);
            shipmentConditions.push(`coalesce(s.effective_date::timestamptz, s.created_at) <= $${shipmentValues.length}::timestamptz`);
        }
        const shipmentRevenue = await pool.query(`
      select
        coalesce(sum(coalesce(s.freight_charge, 0) + coalesce(s.prepaid_amount, 0)), 0)::numeric as shipping_revenue,
        coalesce(sum(coalesce(s.transfer_service_fee, 0)), 0)::numeric as transfer_fee_revenue,
        coalesce(sum(coalesce(s.agent_commission_amount_snapshot, 0)), 0)::numeric as agent_commission_expense
      from shipments s
      where ${shipmentConditions.join(' and ')}
      `, shipmentValues);
        const rows = [];
        for (const cb of cashboxes.rows) {
            const balance = money(cb.balance);
            rows.push({
                accountCode: `CB-${cb.code}`,
                accountName: `صندوق: ${cb.name}`,
                section: 'asset',
                debit: balance >= 0 ? balance : 0,
                credit: balance < 0 ? -balance : 0,
                netDebit: balance,
                currencyCode: currency,
            });
        }
        for (const p of partyAgg.rows) {
            const debit = money(p.total_debit);
            const credit = money(p.total_credit);
            const net = debit - credit;
            const isAgent = p.party_type === 'agent';
            rows.push({
                accountCode: isAgent ? 'LIAB-AGENTS' : 'LIAB-CUSTOMERS',
                accountName: isAgent ? 'ذمم وكلاء (مجمّع)' : 'ذمم عملاء (مجمّع)',
                section: 'liability',
                debit: net < 0 ? -net : 0,
                credit: net > 0 ? net : 0,
                netDebit: net,
                currencyCode: currency,
            });
        }
        const rev = shipmentRevenue.rows[0] ?? {};
        const shippingRev = money(rev.shipping_revenue);
        const transferRev = money(rev.transfer_fee_revenue);
        const commissionExp = money(rev.agent_commission_expense);
        const expenseSum = money(expenseTotal.rows[0]?.total);
        if (shippingRev > 0) {
            rows.push({
                accountCode: 'REV-SHIPPING',
                accountName: 'إيرادات الشحن',
                section: 'revenue',
                debit: 0,
                credit: shippingRev,
                netDebit: -shippingRev,
                currencyCode: currency,
            });
        }
        if (transferRev > 0) {
            rows.push({
                accountCode: 'REV-TRANSFER-FEE',
                accountName: 'إيرادات أجور الحوالة',
                section: 'revenue',
                debit: 0,
                credit: transferRev,
                netDebit: -transferRev,
                currencyCode: currency,
            });
        }
        if (commissionExp > 0) {
            rows.push({
                accountCode: 'EXP-AGENT-COMM',
                accountName: 'عمولات وكلاء (شحن)',
                section: 'expense',
                debit: commissionExp,
                credit: 0,
                netDebit: commissionExp,
                currencyCode: currency,
            });
        }
        if (expenseSum > 0) {
            rows.push({
                accountCode: 'EXP-OPERATING',
                accountName: 'مصاريف تشغيلية',
                section: 'expense',
                debit: expenseSum,
                credit: 0,
                netDebit: expenseSum,
                currencyCode: currency,
            });
        }
        const totalDebit = money(rows.reduce((s, r) => s + r.debit, 0));
        const totalCredit = money(rows.reduce((s, r) => s + r.credit, 0));
        const difference = money(totalDebit - totalCredit);
        return {
            generatedAt: new Date().toISOString(),
            filters: { ...filters, currencyCode: currency },
            rows,
            totals: { totalDebit, totalCredit, difference },
            notes: [
                'ميزان مراجعة تشغيلي مبني على الصناديق، ذمم الأطراف، الشحنات، والمصاريف.',
                'العمولة على الشحن فقط — لا عمولة وكيل على الحوالات في هذا التقرير.',
            ],
        };
    }
    async getBalanceSheet(scope, filters) {
        const trial = await this.getTrialBalance(scope, filters);
        const currency = (filters.currencyCode ?? 'USD').toUpperCase();
        const assets = trial.rows.filter((r) => r.section === 'asset');
        const liabilities = trial.rows.filter((r) => r.section === 'liability');
        const equityRows = trial.rows.filter((r) => r.section === 'equity');
        const revenue = trial.rows.filter((r) => r.section === 'revenue');
        const expenses = trial.rows.filter((r) => r.section === 'expense');
        const totalAssets = money(assets.reduce((s, r) => s + r.netDebit, 0));
        const totalLiabilities = money(liabilities.reduce((s, r) => s + r.credit - r.debit, 0));
        const totalRevenue = money(revenue.reduce((s, r) => s + r.credit, 0));
        const totalExpenses = money(expenses.reduce((s, r) => s + r.debit, 0));
        const netIncome = money(totalRevenue - totalExpenses);
        const totalEquity = money(netIncome);
        const sections = [
            {
                id: 'assets',
                label: 'الأصول',
                total: totalAssets,
                lines: assets.map((a) => ({ label: a.accountName, amount: a.netDebit, reference: a.accountCode })),
            },
            {
                id: 'liabilities',
                label: 'الخصوم',
                total: totalLiabilities,
                lines: liabilities.map((l) => ({
                    label: l.accountName,
                    amount: money(l.credit - l.debit),
                    reference: l.accountCode,
                })),
            },
            {
                id: 'equity',
                label: 'حقوق الملكية / النتيجة',
                total: totalEquity,
                lines: [
                    { label: 'صافي الربح للفترة', amount: netIncome },
                    ...equityRows.map((e) => ({ label: e.accountName, amount: money(e.credit - e.debit), reference: e.accountCode })),
                ],
            },
        ];
        return {
            generatedAt: new Date().toISOString(),
            filters: { ...filters, currencyCode: currency },
            sections,
            summary: {
                totalAssets,
                totalLiabilities,
                totalEquity: totalEquity,
                totalLiabilitiesAndEquity: money(totalLiabilities + totalEquity),
                balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.02,
                netIncome,
                currencyCode: currency,
            },
            notes: [
                'قائمة مركز مالي تشغيلية — الأصول من أرصدة الصناديق، الخصوم من ذمم الأطراف.',
                'النتيجة = إيرادات الشحن وأجور الحوالة ناقص عمولات ومصاريف للفترة.',
            ],
        };
    }
    async listPeriodClosures(scope, limit = 50) {
        const values = [];
        const conditions = [];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`apc.company_id = $${values.length}::uuid`);
        }
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`(apc.branch_id = $${values.length}::uuid or apc.branch_id is null)`);
        }
        values.push(String(limit));
        const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const result = await pool.query(`
      select
        apc.id,
        apc.branch_id,
        b.name as branch_name,
        apc.period_start::text,
        apc.period_end::text,
        apc.currency_code,
        apc.closed_at::text,
        apc.notes,
        apc.snapshot,
        u.username as closed_by_username
      from accounting_period_closures apc
      left join branches b on b.id = apc.branch_id
      left join users u on u.id = apc.closed_by_user_id
      ${where}
      order by apc.closed_at desc
      limit $${values.length}
      `, values);
        return result.rows;
    }
    async closePeriod(scope, input) {
        if (!scope?.companyId)
            throw new Error('Company scope required');
        const currency = (input.currencyCode ?? 'USD').toUpperCase();
        const fromAt = `${input.periodStart}T00:00:00.000Z`;
        const toAt = `${input.periodEnd}T23:59:59.999Z`;
        const trial = await this.getTrialBalance(scope, {
            fromAt,
            toAt,
            branchId: input.branchId ?? scope.branchId,
            currencyCode: currency,
        });
        const balanceSheet = await this.getBalanceSheet(scope, {
            fromAt,
            toAt,
            branchId: input.branchId ?? scope.branchId,
            currencyCode: currency,
        });
        const overlap = await pool.query(`
      select id from accounting_period_closures
      where company_id = $1::uuid
        and upper(currency_code) = upper($2)
        and ($3::uuid is null and branch_id is null or branch_id = $3::uuid)
        and period_start <= $5::date
        and period_end >= $4::date
      limit 1
      `, [scope.companyId, currency, input.branchId ?? null, input.periodStart, input.periodEnd]);
        if (overlap.rowCount) {
            throw new Error('توجد فترة مغلقة متداخلة مع التواريخ المحددة.');
        }
        const result = await pool.query(`
      insert into accounting_period_closures(
        company_id, branch_id, period_start, period_end, currency_code,
        closed_by_user_id, notes, snapshot
      )
      values ($1, $2, $3::date, $4::date, $5, $6, $7, $8::jsonb)
      returning id, period_start::text, period_end::text, currency_code, closed_at::text, notes
      `, [
            scope.companyId,
            input.branchId ?? null,
            input.periodStart,
            input.periodEnd,
            currency,
            input.closedByUserId ?? null,
            input.notes?.trim() || null,
            JSON.stringify({ trialBalance: trial, balanceSheet }),
        ]);
        return result.rows[0];
    }
    async isDateInClosedPeriod(companyId, dateIso, branchId) {
        const d = dateIso.slice(0, 10);
        const result = await pool.query(`
      select 1 from accounting_period_closures
      where company_id = $1::uuid
        and period_start <= $2::date
        and period_end >= $2::date
        and ($3::uuid is null or branch_id is null or branch_id = $3::uuid)
      limit 1
      `, [companyId, d, branchId ?? null]);
        return Boolean(result.rowCount);
    }
}
/** Hawala-only reconciliation package derived from agent financial data. */
export function buildHawalaReconciliationPackage(full) {
    const shipments = (full.shipments ?? []).filter((s) => money(s.hawala_amount) > 0 || money(s.transfer_service_fee) > 0);
    const transfers = (full.transfers ?? []).filter((t) => !t.shipment_id || money(t.amount) > 0);
    const hawalaOnShipments = money(shipments.reduce((sum, s) => sum + money(s.hawala_amount), 0));
    const hawalaFeesOnShipments = money(shipments.reduce((sum, s) => sum + money(s.transfer_service_fee), 0));
    const remittanceOnShipments = shipments.reduce((sum, s) => sum + computeAgentHawalaRemittanceDue({
        hawalaAmount: s.hawala_amount,
        transferServiceFee: s.transfer_service_fee,
    }), 0);
    const standaloneTransfers = transfers.filter((t) => !t.shipment_id);
    const standalonePrincipal = money(standaloneTransfers.reduce((sum, t) => sum + money(t.amount), 0));
    const standaloneFees = money(standaloneTransfers.reduce((sum, t) => sum + money(t.transfer_service_fee), 0));
    const standaloneRemittance = money(standaloneTransfers.reduce((sum, t) => sum + money(t.agent_remittance_due), 0));
    return {
        agent: full.agent,
        generatedAt: full.generatedAt,
        lastReconciliation: full.lastReconciliation,
        summary: {
            hawalaPrincipalOnShipments: hawalaOnShipments,
            hawalaFeesOnShipments: hawalaFeesOnShipments,
            hawalaRemittanceOnShipments: remittanceOnShipments,
            standaloneTransferCount: standaloneTransfers.length,
            standaloneHawalaPrincipal: standalonePrincipal,
            standaloneHawalaFees: standaloneFees,
            standaloneRemittanceDue: standaloneRemittance,
            totalHawalaRemittanceDue: money(remittanceOnShipments + standaloneRemittance),
            agentTransferCommission: 0,
            commissionNote: 'لا عمولة وكيل على الحوالات أو أجور الحوالة',
            totalTransferPrincipalPaid: full.summary?.totalTransferPrincipalPaid ?? 0,
            totalTransferPrincipalCollected: full.summary?.totalTransferPrincipalCollected ?? 0,
            totalTransferServiceFeeCollected: full.summary?.totalTransferServiceFeeCollected ?? 0,
        },
        shipments,
        transfers,
        vouchers: full.vouchers ?? [],
    };
}
export function enrichAgentSettlementSummary(full) {
    const shipments = full.shipments ?? [];
    const shippingRemittance = money(shipments.reduce((sum, s) => sum +
        computeAgentShippingRemittanceDue({
            prepaidAmount: s.prepaid_amount,
            freightCharge: s.freight_charge,
            transferFee: s.transfer_fee,
            agentCommissionAmount: s.agent_commission_amount_snapshot,
        }), 0));
    const hawalaRemittance = money(shipments.reduce((sum, s) => sum +
        computeAgentHawalaRemittanceDue({
            hawalaAmount: s.hawala_amount,
            transferServiceFee: s.transfer_service_fee,
        }), 0));
    let prepaidAtMainBranch = 0;
    let commissionOnPrepaid = 0;
    let collectionOnAgent = 0;
    for (const s of shipments) {
        const row = s;
        const input = {
            prepaidAmount: row.prepaid_amount,
            freightCharge: row.freight_charge,
            transferFee: row.transfer_fee,
            agentCommissionAmount: row.agent_commission_amount_snapshot,
        };
        prepaidAtMainBranch += resolvePrepaidAtMainBranch(input);
        commissionOnPrepaid += computeCommissionOnPrepaidPortion(input);
        collectionOnAgent += money(row.transfer_fee);
    }
    const summary = full.summary ?? {};
    const standaloneRemittance = money(summary.totalTransferRemittanceDue ?? 0);
    const totalCommission = money(summary.totalShipmentCommission ?? 0);
    const grossOnAgent = money(collectionOnAgent + hawalaRemittance + standaloneRemittance);
    const netRequiredFromAgent = money(Math.max(grossOnAgent - totalCommission, 0));
    const totalRemittance = money(summary.totalAgentRemittanceDue ?? netRequiredFromAgent);
    const receipts = money(summary.totalReceipts ?? 0);
    const payments = money(summary.totalPayments ?? 0);
    const balanceDue = computeAgentBalanceDue({
        totalRemittanceDue: totalRemittance,
        totalShippingCommission: totalCommission,
        confirmedReceiptsFromAgent: receipts,
        confirmedPaymentsToAgent: payments,
    });
    return {
        ...full,
        settlement: {
            prepaidAtMainBranch: money(prepaidAtMainBranch),
            collectionOnAgent: money(collectionOnAgent),
            commissionOnPrepaid: money(commissionOnPrepaid),
            commissionOnCollect: money(totalCommission - commissionOnPrepaid),
            shippingRemittanceDue: shippingRemittance,
            hawalaRemittanceDue: hawalaRemittance,
            standaloneTransferRemittanceDue: standaloneRemittance,
            grossLiabilityOnAgent: grossOnAgent,
            netRequiredFromAgent,
            totalRemittanceDue: totalRemittance,
            totalShippingCommission: totalCommission,
            totalTransferCommission: 0,
            commissionNote: 'عمولة الوكيل على الشحن فقط — نسبة من العميل',
            confirmedReceipts: receipts,
            confirmedPayments: payments,
            netVoucherBalance: money(receipts - payments),
            agentBalanceDue: balanceDue,
            reconciliationGap: money(balanceDue),
        },
    };
}
/** Unified main-branch vs agent reconciliation (شحن + حوالات + مسبق + عمولة + سندات). */
export function buildAgentMainBranchReconciliationPackage(full) {
    const base = enrichAgentSettlementSummary(full);
    const hawala = buildHawalaReconciliationPackage(full);
    const settlement = base.settlement ?? {};
    const hawalaSummary = hawala.summary ?? {};
    const totalCommission = money(settlement.totalShippingCommission ?? 0);
    const receipts = money(settlement.confirmedReceipts ?? 0);
    const payments = money(settlement.confirmedPayments ?? 0);
    const hawalaRemittanceTotal = money(hawalaSummary.totalHawalaRemittanceDue ?? 0);
    const grossOnAgent = money((settlement.collectionOnAgent ?? 0) + hawalaRemittanceTotal);
    const netRequiredFromAgent = money(Math.max(grossOnAgent - totalCommission, 0));
    const reconciliationGap = computeAgentBalanceDue({
        totalRemittanceDue: netRequiredFromAgent,
        totalShippingCommission: totalCommission,
        confirmedReceiptsFromAgent: receipts,
        confirmedPaymentsToAgent: payments,
    });
    return {
        ...base,
        hawalaSection: hawala,
        mainBranch: {
            title: 'مطابقة الوكيل ↔ الفرع الرئيسي',
            prepaidRetainedAtMainBranch: money(settlement.prepaidAtMainBranch ?? 0),
            collectionCollectedByAgent: money(settlement.collectionOnAgent ?? 0),
            hawalaPrincipal: money((hawalaSummary.hawalaPrincipalOnShipments ?? 0) + (hawalaSummary.standaloneHawalaPrincipal ?? 0)),
            hawalaServiceFees: money((hawalaSummary.hawalaFeesOnShipments ?? 0) + (hawalaSummary.standaloneHawalaFees ?? 0)),
            hawalaRemittanceTotal,
            totalShippingCommissionDueToAgent: totalCommission,
            commissionOnPrepaidAtMainBranch: money(settlement.commissionOnPrepaid ?? 0),
            commissionOnCollection: money(settlement.commissionOnCollect ?? 0),
            commissionNote: settlement.commissionNote ?? 'عمولة الوكيل على الشحن فقط — لا عمولة على الحوالات',
            grossLiabilityOnAgentExcludingPrepaid: grossOnAgent,
            netRequiredFromAgentAfterCommission: netRequiredFromAgent,
            confirmedReceiptsFromAgent: receipts,
            confirmedPaymentsToAgent: payments,
            agentBalanceDue: reconciliationGap,
            reconciliationGap,
            companyOwesAgentUnpaidCommission: Math.max(totalCommission - payments, 0),
            prepaidNote: 'المبلغ المسبق محصّل في الفرع الرئيسي — لا يُطالب الوكيل بتوريده؛ يستحق الوكيل عمولته على هذا الجزء.',
            voucherNote: 'السند عند حركة نقد فعلية (توريد وكيل أو دفع عمولة) — الترحيل المالي تلقائي.',
        },
    };
}
