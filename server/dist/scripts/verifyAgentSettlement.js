import { pool } from '../db/pool.js';
import { computeAgentRemittanceDue, computeAgentBalanceDue } from '../utils/agentShipmentSettlement.js';
const agentId = process.argv[2] ?? '20e0f69b-7de1-4391-8ee2-ab09903c57c6';
async function main() {
    const shipments = await pool.query(`
    select shipment_no, freight_charge, transfer_fee, hawala_amount, transfer_service_fee,
      prepaid_amount, agent_commission_amount_snapshot
    from shipments
    where agent_id = $1 and deleted_at is null
    order by created_at
    `, [agentId]);
    let totalRemittance = 0;
    for (const s of shipments.rows) {
        const rem = computeAgentRemittanceDue({
            transferFee: s.transfer_fee,
            hawalaAmount: s.hawala_amount,
            transferServiceFee: s.transfer_service_fee,
            agentCommissionAmount: s.agent_commission_amount_snapshot,
        });
        totalRemittance += rem;
        console.log(s.shipment_no, rem, s);
    }
    const receipts = await pool.query(`select coalesce(sum(original_amount),0) as total from receipt_vouchers where agent_id = $1 and status = 'confirmed'`, [agentId]);
    const movements = await pool.query(`
    select coalesce(sum(debit_amount),0) as debit, coalesce(sum(credit_amount),0) as credit
    from party_financial_movements
    where party_type = 'agent' and party_id = $1 and is_reversal = false
    `, [agentId]);
    const commission = await pool.query(`select coalesce(sum(agent_commission_amount_snapshot),0) as total from shipments where agent_id = $1 and deleted_at is null`, [agentId]);
    const debit = Number(movements.rows[0]?.debit ?? 0);
    const creditMovements = Number(movements.rows[0]?.credit ?? 0);
    const commissionTotal = Number(commission.rows[0]?.total ?? 0);
    const receiptsTotal = Number(receipts.rows[0]?.total ?? 0);
    const ledgerBalance = debit - commissionTotal - receiptsTotal;
    console.log('\n--- Summary ---');
    console.log('totalRemittanceDue', totalRemittance);
    console.log('agentBalanceDue', computeAgentBalanceDue({ totalRemittanceDue: totalRemittance, totalShippingCommission: commissionTotal, confirmedReceiptsFromAgent: receiptsTotal }));
    console.log('movement debits', debit);
    console.log('commission credits (from shipments)', commissionTotal);
    console.log('receipt vouchers', receiptsTotal);
    console.log('ledger balance (debit - commission - receipts)', ledgerBalance);
    await pool.end();
}
main().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
});
