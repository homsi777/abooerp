import { pool } from '../db/pool.js';
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function toUsd(amount, currency, rate) {
    if (currency.toUpperCase() === 'USD')
        return money(amount);
    return money(amount * (rate || 1));
}
function buildShipmentScope(scope, values, alias = 's') {
    const conditions = [
        `${alias}.deleted_at is null`,
        `upper(${alias}.status) <> 'CANCELLED'`,
    ];
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
export class ProfitLossReportService {
    async buildReport(scope, filters) {
        const reportCurrency = filters.currencyCode?.toUpperCase() ?? 'USD';
        const shipmentValues = [filters.fromAt, filters.toAt];
        const shipmentConditions = [
            ...buildShipmentScope(scope, shipmentValues, 's'),
            `s.created_at >= $1::timestamptz`,
            `s.created_at <= $2::timestamptz`,
        ];
        if (filters.branchId) {
            shipmentValues.push(filters.branchId);
            shipmentConditions.push(`s.branch_id = $${shipmentValues.length}::uuid`);
        }
        if (filters.currencyCode) {
            shipmentValues.push(filters.currencyCode.toUpperCase());
            shipmentConditions.push(`upper(s.original_currency) = $${shipmentValues.length}`);
        }
        const shipmentWhere = shipmentConditions.join(' and ');
        const shipmentRows = await pool.query(`
      select
        s.id,
        s.created_at,
        s.shipment_no,
        s.destination_city,
        coalesce(s.freight_charge, 0)::numeric as freight_charge,
        coalesce(s.prepaid_amount, 0)::numeric as prepaid_amount,
        coalesce(s.transfer_fee, 0)::numeric as transfer_fee,
        coalesce(s.transfer_service_fee, 0)::numeric as transfer_service_fee,
        coalesce(s.agent_commission_amount_snapshot, 0)::numeric as agent_commission,
        coalesce(s.exchange_rate_to_usd, 1)::numeric as exchange_rate_to_usd,
        s.original_currency,
        coalesce(ag.name, '-') as agent_name
      from shipments s
      left join agents ag on ag.id = s.agent_id
      where ${shipmentWhere}
      order by s.created_at asc, s.shipment_no asc
      `, shipmentValues);
        const revenueLines = [];
        const commissionLines = [];
        for (const row of shipmentRows.rows) {
            const cur = String(row.original_currency ?? 'USD');
            const rate = Number(row.exchange_rate_to_usd ?? 1);
            const freight = money(row.freight_charge);
            const prepaid = money(row.prepaid_amount);
            const collect = money(row.transfer_fee);
            const hawalaFee = money(row.transfer_service_fee);
            const commission = money(row.agent_commission);
            const shippingRevenue = freight + prepaid + collect;
            if (shippingRevenue > 0) {
                revenueLines.push({
                    section: 'revenue',
                    category: 'إيرادات الشحن',
                    at: row.created_at,
                    referenceNo: row.shipment_no,
                    description: `أجور شحن — ${row.destination_city ?? '-'}`,
                    partyName: row.agent_name,
                    amount: shippingRevenue,
                    currencyCode: cur,
                    amountUsd: toUsd(shippingRevenue, cur, rate),
                    notes: `تحصيل ${collect} | مسبق ${prepaid} | أجرة ${freight}`,
                    sourceType: 'shipment_shipping',
                    sourceId: String(row.id),
                });
            }
            if (hawalaFee > 0) {
                revenueLines.push({
                    section: 'revenue',
                    category: 'إيرادات أجور الحوالات',
                    at: row.created_at,
                    referenceNo: row.shipment_no,
                    description: `أجرة خدمة حوالة — ${row.destination_city ?? '-'}`,
                    partyName: row.agent_name,
                    amount: hawalaFee,
                    currencyCode: cur,
                    amountUsd: toUsd(hawalaFee, cur, rate),
                    notes: 'مرتبطة بشحنة',
                    sourceType: 'shipment_hawala_fee',
                    sourceId: String(row.id),
                });
            }
            if (commission > 0) {
                commissionLines.push({
                    section: 'direct_cost',
                    category: 'عمولة وكيل — شحن',
                    at: row.created_at,
                    referenceNo: row.shipment_no,
                    description: `عمولة وكيل على الشحنة ${row.shipment_no}`,
                    partyName: row.agent_name,
                    amount: commission,
                    currencyCode: cur,
                    amountUsd: toUsd(commission, cur, rate),
                    notes: 'تُخصم من إيراد الشحن فقط',
                    sourceType: 'agent_commission',
                    sourceId: String(row.id),
                });
            }
        }
        const transferValues = [filters.fromAt, filters.toAt];
        const transferConditions = [
            `coalesce(t.transfer_date, t.created_at) >= $1::timestamptz`,
            `coalesce(t.transfer_date, t.created_at) <= $2::timestamptz`,
            `upper(coalesce(t.status, 'PENDING')) <> 'CANCELLED'`,
        ];
        if (scope?.companyId) {
            transferValues.push(scope.companyId);
            transferConditions.push(`t.company_id = $${transferValues.length}::uuid`);
        }
        if (filters.branchId) {
            transferValues.push(filters.branchId);
            transferConditions.push(`t.branch_id = $${transferValues.length}::uuid`);
        }
        if (filters.currencyCode) {
            transferValues.push(filters.currencyCode.toUpperCase());
            transferConditions.push(`upper(coalesce(t.transfer_service_fee_currency, t.currency, 'USD')) = $${transferValues.length}`);
        }
        const transferRows = await pool.query(`
      select
        t.id,
        coalesce(t.transfer_date, t.created_at) as at,
        coalesce(s.shipment_no, t.id::text) as reference_no,
        coalesce(t.sender_name, '-') as sender_name,
        coalesce(t.receiver_name, '-') as receiver_name,
        coalesce(t.transfer_service_fee, 0)::numeric as transfer_service_fee,
        coalesce(t.company_transfer_profit, t.transfer_service_fee, 0)::numeric as company_profit,
        coalesce(t.transfer_service_fee_currency, t.currency, 'USD') as currency_code
      from transfers t
      left join shipments s on s.id = t.shipment_id
      where ${transferConditions.join(' and ')}
      order by coalesce(t.transfer_date, t.created_at) asc
      `, transferValues);
        for (const row of transferRows.rows) {
            const cur = String(row.currency_code ?? 'USD');
            const fee = money(row.transfer_service_fee);
            const profit = money(row.company_profit);
            if (fee > 0) {
                revenueLines.push({
                    section: 'revenue',
                    category: 'إيرادات أجور الحوالات',
                    at: row.at,
                    referenceNo: row.reference_no,
                    description: `حوالة ${row.sender_name} → ${row.receiver_name}`,
                    partyName: null,
                    amount: fee,
                    currencyCode: cur,
                    amountUsd: toUsd(fee, cur, 1),
                    notes: 'حوالة مستقلة',
                    sourceType: 'transfer_service_fee',
                    sourceId: String(row.id),
                });
            }
            if (profit > 0 && profit !== fee) {
                revenueLines.push({
                    section: 'revenue',
                    category: 'أرباح الحوالات',
                    at: row.at,
                    referenceNo: row.reference_no,
                    description: `ربح حوالة ${row.sender_name} → ${row.receiver_name}`,
                    partyName: null,
                    amount: profit,
                    currencyCode: cur,
                    amountUsd: toUsd(profit, cur, 1),
                    notes: 'صافي ربح الشركة من الحوالة',
                    sourceType: 'transfer_profit',
                    sourceId: String(row.id),
                });
            }
        }
        const expenseValues = [filters.fromAt, filters.toAt];
        const expenseConditions = [
            `pv.status = 'confirmed'`,
            `pv.created_at >= $1::timestamptz`,
            `pv.created_at <= $2::timestamptz`,
            `(pv.related_entity_type = 'expense' or pv.related_entity_type is null and pv.agent_id is null and pv.customer_id is null and coalesce(pv.notes, '') <> '')`,
        ];
        if (scope?.companyId) {
            expenseValues.push(scope.companyId);
            expenseConditions.push(`pv.company_id = $${expenseValues.length}::uuid`);
        }
        if (filters.branchId) {
            expenseValues.push(filters.branchId);
            expenseConditions.push(`pv.branch_id = $${expenseValues.length}::uuid`);
        }
        if (filters.currencyCode) {
            expenseValues.push(filters.currencyCode.toUpperCase());
            expenseConditions.push(`upper(pv.original_currency) = $${expenseValues.length}`);
        }
        const expenseRows = await pool.query(`
      select pv.id, pv.created_at, pv.voucher_no, pv.notes, pv.original_amount, pv.original_currency,
        coalesce(pv.exchange_rate_to_usd, 1)::numeric as exchange_rate_to_usd
      from payment_vouchers pv
      where ${expenseConditions.join(' and ')}
        and pv.related_entity_type = 'expense'
      order by pv.created_at asc
      `, expenseValues);
        const expenseLines = expenseRows.rows.map((row) => {
            const cur = String(row.original_currency ?? 'USD');
            const amount = money(row.original_amount);
            return {
                section: 'operating_expense',
                category: 'مصاريف تشغيلية',
                at: row.created_at,
                referenceNo: row.voucher_no,
                description: String(row.notes ?? 'مصروف'),
                partyName: null,
                amount,
                currencyCode: cur,
                amountUsd: toUsd(amount, cur, Number(row.exchange_rate_to_usd ?? 1)),
                notes: row.notes,
                sourceType: 'expense_voucher',
                sourceId: String(row.id),
            };
        });
        const salaryValues = [filters.fromAt, filters.toAt];
        const salaryConditions = [
            `sr.deleted_at is null`,
            `sr.payment_status = 'paid'`,
            `coalesce(sr.paid_at, sr.updated_at) >= $1::timestamptz`,
            `coalesce(sr.paid_at, sr.updated_at) <= $2::timestamptz`,
        ];
        if (scope?.companyId) {
            salaryValues.push(scope.companyId);
            salaryConditions.push(`sr.company_id = $${salaryValues.length}::uuid`);
        }
        if (filters.branchId) {
            salaryValues.push(filters.branchId);
            salaryConditions.push(`sr.branch_id = $${salaryValues.length}::uuid`);
        }
        if (filters.currencyCode) {
            salaryValues.push(filters.currencyCode.toUpperCase());
            salaryConditions.push(`upper(sr.currency) = $${salaryValues.length}`);
        }
        const salaryRows = await pool.query(`
      select sr.id, coalesce(sr.paid_at, sr.updated_at) as at, sr.net_amount, sr.currency, sr.notes,
        sr.period_year, sr.period_month, e.name as employee_name, e.code as employee_code
      from salary_records sr
      join employees e on e.id = sr.employee_id
      where ${salaryConditions.join(' and ')}
      order by coalesce(sr.paid_at, sr.updated_at) asc
      `, salaryValues);
        const salaryLines = salaryRows.rows.map((row) => {
            const cur = String(row.currency ?? 'USD');
            const amount = money(row.net_amount);
            return {
                section: 'operating_expense',
                category: 'رواتب وأجور',
                at: row.at,
                referenceNo: `${row.period_year}-${String(row.period_month).padStart(2, '0')}`,
                description: `راتب ${row.employee_name ?? '-'} (${row.employee_code ?? '-'})`,
                partyName: row.employee_name,
                amount,
                currencyCode: cur,
                amountUsd: toUsd(amount, cur, 1),
                notes: row.notes,
                sourceType: 'salary_record',
                sourceId: String(row.id),
            };
        });
        const liabilityValues = [filters.toAt];
        let companyParam = null;
        let branchParam = null;
        let currencyParam = null;
        const liabilityConditions = [
            `s.deleted_at is null`,
            `upper(s.status) <> 'CANCELLED'`,
            `s.created_at <= $1::timestamptz`,
            `s.agent_id is not null`,
        ];
        if (scope?.companyId) {
            liabilityValues.push(scope.companyId);
            companyParam = liabilityValues.length;
            liabilityConditions.push(`s.company_id = $${companyParam}::uuid`);
        }
        if (filters.branchId) {
            liabilityValues.push(filters.branchId);
            branchParam = liabilityValues.length;
            liabilityConditions.push(`s.branch_id = $${branchParam}::uuid`);
        }
        if (filters.currencyCode) {
            liabilityValues.push(filters.currencyCode.toUpperCase());
            currencyParam = liabilityValues.length;
            liabilityConditions.push(`upper(s.original_currency) = $${currencyParam}`);
        }
        const receiptFilters = [
            `rv.status = 'confirmed'`,
            `rv.agent_id is not null`,
            `rv.created_at <= $1::timestamptz`,
            ...(companyParam ? [`rv.company_id = $${companyParam}::uuid`] : []),
        ];
        const agentLiabilityRows = await pool.query(`
      with remittance as (
        select
          s.agent_id,
          s.original_currency as currency_code,
          coalesce(sum(
            greatest(
              coalesce(s.transfer_fee, 0)
              + coalesce(s.hawala_amount, 0)
              + coalesce(s.transfer_service_fee, 0)
              - coalesce(s.agent_commission_amount_snapshot, 0),
              0
            )
          ), 0)::numeric as total_remittance
        from shipments s
        where ${liabilityConditions.join(' and ')}
        group by s.agent_id, s.original_currency
      ),
      receipts as (
        select
          rv.agent_id,
          rv.original_currency as currency_code,
          coalesce(sum(rv.original_amount), 0)::numeric as total_receipts
        from receipt_vouchers rv
        where ${receiptFilters.join(' and ')}
        group by rv.agent_id, rv.original_currency
      )
      select
        ag.id as agent_id,
        ag.name as agent_name,
        ag.code as agent_code,
        r.currency_code,
        greatest(coalesce(r.total_remittance, 0) - coalesce(rc.total_receipts, 0), 0)::numeric as balance_due
      from remittance r
      join agents ag on ag.id = r.agent_id
      left join receipts rc on rc.agent_id = r.agent_id and rc.currency_code = r.currency_code
      where greatest(coalesce(r.total_remittance, 0) - coalesce(rc.total_receipts, 0), 0) > 0.009
      order by balance_due desc, ag.name asc
      `, liabilityValues);
        const agentLiabilityLines = agentLiabilityRows.rows.map((row) => ({
            section: 'agent_liability',
            category: 'ذمة على الوكيل',
            at: filters.toAt,
            referenceNo: row.agent_code ?? row.agent_id,
            description: `ذمة متبقية — ${row.agent_name}`,
            partyName: row.agent_name,
            amount: money(row.balance_due),
            currencyCode: String(row.currency_code ?? 'USD'),
            amountUsd: toUsd(money(row.balance_due), String(row.currency_code ?? 'USD'), 1),
            notes: 'مطلوب من الوكيل حتى تاريخ التقرير',
            sourceType: 'agent_balance',
            sourceId: String(row.agent_id),
        }));
        const customerValues = [filters.toAt];
        const customerConditions = [
            `pfm.party_type = 'customer'`,
            `pfm.is_reversal = false`,
            `coalesce(pfm.posted_at, pfm.created_at) <= $1::timestamptz`,
        ];
        if (scope?.companyId) {
            customerValues.push(scope.companyId);
            customerConditions.push(`c.company_id = $${customerValues.length}::uuid`);
        }
        if (filters.currencyCode) {
            customerValues.push(filters.currencyCode.toUpperCase());
            customerConditions.push(`upper(coalesce(pfm.currency_code, pfm.original_currency)) = $${customerValues.length}`);
        }
        const customerLiabilityRows = await pool.query(`
      select
        pfm.party_id as customer_id,
        coalesce(c.name, '-') as customer_name,
        coalesce(c.code, '-') as customer_code,
        coalesce(pfm.currency_code, pfm.original_currency) as currency_code,
        (
          coalesce(sum(coalesce(pfm.debit_amount, 0)), 0)
          - coalesce(sum(coalesce(pfm.credit_amount, 0)), 0)
        )::numeric as balance_due
      from party_financial_movements pfm
      join customers c on c.id = pfm.party_id
      where ${customerConditions.join(' and ')}
      group by pfm.party_id, c.name, c.code, coalesce(pfm.currency_code, pfm.original_currency)
      having (
        coalesce(sum(coalesce(pfm.debit_amount, 0)), 0)
        - coalesce(sum(coalesce(pfm.credit_amount, 0)), 0)
      ) > 0.009
      order by balance_due desc
      `, customerValues);
        const customerLiabilityLines = customerLiabilityRows.rows.map((row) => ({
            section: 'customer_liability',
            category: 'ذمة على العميل',
            at: filters.toAt,
            referenceNo: row.customer_code,
            description: `ذمة متبقية — ${row.customer_name}`,
            partyName: row.customer_name,
            amount: money(row.balance_due),
            currencyCode: String(row.currency_code ?? 'USD'),
            amountUsd: toUsd(money(row.balance_due), String(row.currency_code ?? 'USD'), 1),
            notes: 'رصيد مدين على العميل حتى تاريخ التقرير',
            sourceType: 'customer_balance',
            sourceId: String(row.customer_id),
        }));
        const sumUsd = (lines) => lines.reduce((s, line) => s + line.amountUsd, 0);
        const sumAmount = (lines) => lines.reduce((s, line) => s + line.amount, 0);
        const totalRevenueUsd = sumUsd(revenueLines);
        const totalDirectCostsUsd = sumUsd(commissionLines);
        const totalOperatingUsd = sumUsd(expenseLines) + sumUsd(salaryLines);
        const totalAgentLiabilitiesUsd = sumUsd(agentLiabilityLines);
        const totalCustomerLiabilitiesUsd = sumUsd(customerLiabilityLines);
        const sections = [
            { id: 'revenue', label: 'الإيرادات', total: sumAmount(revenueLines), totalUsd: totalRevenueUsd, currencyCode: reportCurrency, lines: revenueLines },
            { id: 'direct_cost', label: 'تكلفة مباشرة — عمولات الوكلاء', total: sumAmount(commissionLines), totalUsd: totalDirectCostsUsd, currencyCode: reportCurrency, lines: commissionLines },
            { id: 'operating_expense', label: 'مصاريف تشغيلية ورواتب', total: sumAmount(expenseLines) + sumAmount(salaryLines), totalUsd: totalOperatingUsd, currencyCode: reportCurrency, lines: [...expenseLines, ...salaryLines] },
            { id: 'agent_liability', label: 'ذمم الوكلاء المتبقية', total: sumAmount(agentLiabilityLines), totalUsd: totalAgentLiabilitiesUsd, currencyCode: reportCurrency, lines: agentLiabilityLines },
            { id: 'customer_liability', label: 'ذمم العملاء المتبقية', total: sumAmount(customerLiabilityLines), totalUsd: totalCustomerLiabilitiesUsd, currencyCode: reportCurrency, lines: customerLiabilityLines },
        ];
        return {
            generatedAt: new Date().toISOString(),
            filters,
            summary: {
                totalRevenue: money(totalRevenueUsd),
                totalDirectCosts: money(totalDirectCostsUsd),
                grossProfit: money(totalRevenueUsd - totalDirectCostsUsd),
                totalOperatingExpenses: money(totalOperatingUsd),
                netProfit: money(totalRevenueUsd - totalDirectCostsUsd - totalOperatingUsd),
                totalAgentLiabilities: money(totalAgentLiabilitiesUsd),
                totalCustomerLiabilities: money(totalCustomerLiabilitiesUsd),
                currencyCode: reportCurrency,
            },
            sections,
        };
    }
}
