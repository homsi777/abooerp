/**
 * Smoke: مطابقة الوكيل ↔ الفرع الرئيسي — الرقة / الحسكة / القامشلي
 * يُنشئ شحنات تجريبية (دفعة يومية نموذجية) ويتحقق من الأرقام.
 */
import { pool, testDatabaseConnection } from '../db/pool.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { FinanceService } from '../services/financeService.js';
import { FinanceRepository } from '../repositories/financeRepository.js';
import { buildAgentMainBranchReconciliationPackage } from '../services/accountingReportsService.js';

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

type AgentRow = { id: string; name: string; governorate: string; commission_percentage: string };

const DESTINATIONS: Array<{
  governorate: string;
  freightCharge: number;
  transferFee: number;
  hawalaAmount: number;
  transferServiceFee: number;
}> = [
  {
    governorate: 'الرقة',
    freightCharge: 25,
    transferFee: 565,
    hawalaAmount: 1130,
    transferServiceFee: 35.5,
  },
  {
    governorate: 'الحسكة',
    freightCharge: 40,
    transferFee: 320,
    hawalaAmount: 680,
    transferServiceFee: 18,
  },
  {
    governorate: 'القامشلي',
    freightCharge: 15,
    transferFee: 210,
    hawalaAmount: 450,
    transferServiceFee: 12.5,
  },
];

async function run() {
  await testDatabaseConnection();
  const company = await pool.query<{ id: string }>(`select id from companies order by created_at limit 1`);
  ensure(Boolean(company.rowCount), 'No company in database');
  const companyId = company.rows[0].id;

  const branch = await pool.query<{ id: string }>(
    `select id from branches where company_id = $1 order by created_at limit 1`,
    [companyId],
  );
  ensure(Boolean(branch.rowCount), 'No branch');
  const branchId = branch.rows[0].id;

  const srs = await pool.query<{ id: string }>(`select id from senders_receivers limit 2`);
  ensure((srs.rowCount ?? 0) >= 1, 'Need sender/receiver');
  const senderId = srs.rows[0].id;
  const receiverId = srs.rows[1]?.id ?? senderId;

  await pool.query(
    `delete from shipments where company_id = $1 and shipment_no like 'TEST-RECON-%'`,
    [companyId],
  );

  const agents = await pool.query<AgentRow>(
    `
    select a.id, a.name, a.governorate, a.commission_percentage::text
    from agents a
    join branches b on b.id = a.branch_id
    where b.company_id = $1::uuid
      and a.is_active = true
      and a.governorate in ('الرقة', 'الحسكة', 'القامشلي')
    `,
    [companyId],
  );
  ensure((agents.rowCount ?? 0) >= 3, `Expected 3 agents (الرقة/الحسكة/القامشلي), found ${agents.rowCount ?? 0}`);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `TEST-RECON-${Date.now()}`;

  for (const dest of DESTINATIONS) {
    const agent = agents.rows.find((a) => a.governorate === dest.governorate);
    ensure(Boolean(agent), `Missing agent for ${dest.governorate}`);
    const pct = Number(agent!.commission_percentage ?? 0) > 0 ? Number(agent!.commission_percentage) : 15;
    const base = money(dest.freightCharge + dest.transferFee);
    const commission = money((base * pct) / 100);
    const shipmentNo = `${prefix}-${dest.governorate}`;

    await pool.query(
      `
      insert into shipments (
        company_id, branch_id, agent_id, sender_id, receiver_id,
        shipment_no, destination_city, pieces_count, status,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd,
        freight_charge, transfer_fee, hawala_amount, transfer_service_fee,
        agent_commission_base_type, agent_commission_base_amount,
        agent_commission_percentage_snapshot, agent_commission_amount_snapshot,
        created_at
      )
      values (
        $1, $2, $3, $4, $5,
        $6, $7, 1, 'DELIVERED',
        $8, 'USD', 1, $8,
        $9, $10, $11, $12,
        'FREIGHT_CHARGE', $13,
        $14, $15,
        $16::timestamptz
      )
      `,
      [
        companyId,
        branchId,
        agent!.id,
        senderId,
        receiverId,
        shipmentNo,
        dest.governorate,
        base + dest.hawalaAmount + dest.transferServiceFee,
        dest.freightCharge,
        dest.transferFee,
        dest.hawalaAmount,
        dest.transferServiceFee,
        base,
        pct,
        commission,
        `${today}T12:00:00.000Z`,
      ],
    );
  }

  const agentRepo = new AgentRepository();
  const financeRepo = new FinanceRepository();
  const financeService = new FinanceService(financeRepo, agentRepo);
  const fromAt = `${today}T00:00:00.000Z`;
  const toAt = `${today}T23:59:59.999Z`;

  console.log('\n=== مطابقة الوكيل ↔ الفرع الرئيسي — دفعة', today, '===');

  for (const dest of DESTINATIONS) {
    const agent = agents.rows.find((a) => a.governorate === dest.governorate)!;
    const raw = await agentRepo.getAgentFinancialStatement(companyId, agent.id, {
      currencyCode: 'USD',
      fromAt,
      toAt,
    });
    ensure(Boolean(raw), `No statement for ${dest.governorate}`);
    const pkg = buildAgentMainBranchReconciliationPackage(raw!);
    const mb = pkg.mainBranch;

    console.log(`\n--- ${agent.name} (${dest.governorate}) ---`);
    console.log('  مسبق في الفرع:', mb.prepaidRetainedAtMainBranch);
    console.log('  تحصيل مع الوكيل:', mb.collectionCollectedByAgent);
    console.log('  حوالات (أصل+أجور):', mb.hawalaRemittanceTotal);
    console.log('  عمولة شحن:', mb.totalShippingCommissionDueToAgent);
    console.log('  عمولة على المسبق:', mb.commissionOnPrepaidAtMainBranch);
    console.log('  صافي مطلوب من الوكيل:', mb.netRequiredFromAgentAfterCommission);
    console.log('  فارق المطابقة:', mb.reconciliationGap);

    if (dest.governorate === 'الرقة') {
      const pct =
        Number(agent.commission_percentage ?? 0) > 0 ? Number(agent.commission_percentage) : 15;
      const expectedCommission = money(((dest.freightCharge + dest.transferFee) * pct) / 100);
      const expectedNet = money(
        dest.transferFee + dest.hawalaAmount + dest.transferServiceFee - expectedCommission,
      );
      ensure(money(mb.prepaidRetainedAtMainBranch) === dest.freightCharge, 'Raqqa prepaid mismatch');
      ensure(money(mb.collectionCollectedByAgent) === dest.transferFee, 'Raqqa collect mismatch');
      ensure(money(mb.totalShippingCommissionDueToAgent) === expectedCommission, 'Raqqa commission mismatch');
      ensure(money(mb.netRequiredFromAgentAfterCommission) === expectedNet, 'Raqqa net mismatch');
      console.log('  ✓ الرقة: تطابق مع منطق المحاسب (مثال الدفعة اليومية)');
    }
  }

  const raqqaAgent = agents.rows.find((a) => a.governorate === 'الرقة')!;
  const apiPkg = await financeService.getAgentBranchReconciliationPackage(companyId, raqqaAgent.id, {
    currencyCode: 'USD',
    fromAt,
    toAt,
  });
  ensure(Boolean(apiPkg?.mainBranch), 'FinanceService agent-branch-reconciliation failed');

  console.log('\n✓ phaseAgentBranchReconciliationSmoke passed');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
