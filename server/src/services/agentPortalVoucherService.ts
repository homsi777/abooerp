import { pool } from '../db/pool.js';
import type { FinanceRepository, PaymentVoucherInput } from '../repositories/financeRepository.js';
import type { FinanceService } from './financeService.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import { computeBaseAmountUsd } from '../utils/money.js';
import { sendCompanyNotification } from './telegramService.js';

export type AgentPortalVoucherKind = 'remittance' | 'receipt_from_branch';

export interface AgentPortalVoucherRow {
  id: string;
  voucherNo: string;
  kind: AgentPortalVoucherKind;
  kindLabelAr: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  createdAt: string;
  counterpartyLabel: string;
}

const AGENT_VOUCHER_TYPES = ['agent_remittance', 'agent_receipt_from_branch'] as const;

function kindFromType(relatedEntityType: string | null | undefined): AgentPortalVoucherKind {
  return relatedEntityType === 'agent_receipt_from_branch' ? 'receipt_from_branch' : 'remittance';
}

function kindLabelAr(kind: AgentPortalVoucherKind): string {
  return kind === 'receipt_from_branch' ? 'استلام من الفرع الرئيسي' : 'توريد للفرع الرئيسي';
}

export class AgentPortalVoucherService {
  constructor(
    private repository: FinanceRepository,
    private financeService: FinanceService,
  ) {}

  isAgentPortalSettlementType(relatedEntityType: string | null | undefined): boolean {
    return AGENT_VOUCHER_TYPES.includes(relatedEntityType as (typeof AGENT_VOUCHER_TYPES)[number]);
  }

  private async resolveCashboxes(companyId: string, agentId: string, currency: string) {
    const agentCashbox = await this.repository.findAnyAgentCashbox(companyId, agentId);
    if (!agentCashbox) {
      throw new HttpError(400, 'لا يوجد صندوق مرتبط بهذا الوكيل. يرجى مراجعة الإدارة.');
    }
    if (String(agentCashbox.currency_code ?? 'USD').toUpperCase() !== currency.toUpperCase()) {
      throw new HttpError(400, `صندوق الوكيل بعملة ${agentCashbox.currency_code} — استخدم نفس العملة أو راجع الإدارة.`);
    }
    const hqCashboxId = await this.repository.findDefaultCompanyCashboxUsdId(companyId);
    if (!hqCashboxId) {
      throw new HttpError(400, 'صندوق الفرع الرئيسي غير مهيأ. يرجى مراجعة الإدارة.');
    }
    return {
      agentCashboxId: String(agentCashbox.id),
      hqCashboxId,
    };
  }

  async createDraftRequest(input: {
    companyId: string;
    agentId: string;
    branchId?: string;
    userId?: string;
    kind: AgentPortalVoucherKind;
    amount: number;
    currency?: string;
    description: string;
    baseCurrency?: string;
  }): Promise<AgentPortalVoucherRow> {
    const currency = String(input.currency ?? 'USD').toUpperCase();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpError(400, 'المبلغ يجب أن يكون أكبر من صفر.');
    }
    const description = String(input.description ?? '').trim();
    if (!description) {
      throw new HttpError(400, 'البيان مطلوب.');
    }

    const { agentCashboxId, hqCashboxId } = await this.resolveCashboxes(input.companyId, input.agentId, currency);
    const exchangeRateToUsd = await this.financeService.resolveExchangeRateToUsd({
      originalCurrency: currency,
      companyId: input.companyId,
      baseCurrency: input.baseCurrency,
    });

    const relatedEntityType =
      input.kind === 'receipt_from_branch' ? 'agent_receipt_from_branch' : 'agent_remittance';
    const cashboxId = input.kind === 'receipt_from_branch' ? hqCashboxId : agentCashboxId;
    const voucherNo = `APV-${input.kind === 'receipt_from_branch' ? 'IN' : 'OUT'}-${Date.now()}`;

    const payload: PaymentVoucherInput = {
      voucherNo,
      branchId: input.branchId,
      agentId: input.agentId,
      relatedEntityType,
      status: 'draft',
      notes: description,
      originalAmount: amount,
      originalCurrency: currency,
      exchangeRateToUsd,
      baseAmountUsd: computeBaseAmountUsd(amount, exchangeRateToUsd),
      createdByUserId: input.userId,
      companyId: input.companyId,
      cashboxId,
    };

    const created = await this.repository.createPaymentVoucher(payload);

    const agentRes = await pool.query<{ name: string; code: string }>(
      `select name, code from agents where id = $1::uuid limit 1`,
      [input.agentId],
    );
    const agentLabel = agentRes.rows[0]?.name ?? agentRes.rows[0]?.code ?? 'وكيل';

    void sendCompanyNotification(input.companyId, [
      `📋 <b>سند وكيل بانتظار الاعتماد</b>`,
      ``,
      `👤 الوكيل: ${agentLabel}`,
      `📌 النوع: ${kindLabelAr(input.kind)}`,
      `💰 المبلغ: ${amount.toFixed(2)} ${currency}`,
      `📝 البيان: ${description}`,
      `🔖 رقم السند: ${voucherNo}`,
      ``,
      `⏳ يرجى المراجعة والاعتماد من قسم السندات.`,
    ].join('\n'));

    return this.toMobileRow(created, input.kind);
  }

  async listForAgent(companyId: string, agentId: string): Promise<AgentPortalVoucherRow[]> {
    const result = await pool.query(
      `
      select *
      from payment_vouchers
      where company_id = $1::uuid
        and agent_id = $2::uuid
        and related_entity_type = any($3::text[])
      order by created_at desc
      limit 200
      `,
      [companyId, agentId, AGENT_VOUCHER_TYPES],
    );
    return result.rows.map((row) => this.toMobileRow(row, kindFromType(row.related_entity_type)));
  }

  async confirmDraftPaymentVoucher(
    id: string,
    scope: DataScope | undefined,
    fxContext: { companyId?: string; baseCurrency?: string; actorUserId?: string },
  ) {
    const existing = await this.repository.getPaymentVoucherById(id, scope);
    if (!existing) return null;
    if (existing.status !== 'draft') {
      throw new HttpError(400, 'يمكن اعتماد سندات الوكيل في حالة مسودة فقط.');
    }
    const relatedType = String(existing.related_entity_type ?? '');
    if (!this.isAgentPortalSettlementType(relatedType)) {
      return null;
    }

    const companyId = String(existing.company_id ?? fxContext.companyId ?? '');
    const agentId = String(existing.agent_id ?? '');
    if (!companyId || !agentId) {
      throw new HttpError(400, 'سند الوكيل غير مكتمل البيانات.');
    }

    const currency = String(existing.original_currency ?? 'USD');
    const { agentCashboxId, hqCashboxId } = await this.resolveCashboxes(companyId, agentId, currency);
    const amount = Number(existing.original_amount);
    const rate = Number(existing.exchange_rate_to_usd ?? 1);
    const baseUsd = Number(existing.base_amount_usd ?? computeBaseAmountUsd(amount, rate));
    const notes = String(existing.notes ?? '').trim() || kindLabelAr(kindFromType(relatedType));
    const pairNo = String(existing.voucher_no);

    const client = await pool.connect();
    try {
      await client.query('begin');

      if (relatedType === 'agent_remittance') {
        const confirmedPv = await client.query(
          `
          update payment_vouchers
          set status = 'confirmed', agent_id = null, updated_at = now()
          where id = $1::uuid and status = 'draft'
          returning *
          `,
          [id],
        );
        const pv = confirmedPv.rows[0];
        if (!pv) throw new HttpError(409, 'تعذر اعتماد السند — ربما تم اعتماده مسبقاً.');
        await this.repository.insertCashboxAndMovementForPayment(client, pv);

        await this.repository.createReceiptVoucherWithClient(client, {
          voucherNo: `${pairNo}-HQ-IN`,
          branchId: existing.branch_id ?? undefined,
          agentId,
          relatedEntityType: 'cashbox_transfer',
          status: 'confirmed',
          notes: `توريد وكيل — ${notes}`,
          originalAmount: amount,
          originalCurrency: currency,
          exchangeRateToUsd: rate,
          baseAmountUsd: baseUsd,
          createdByUserId: fxContext.actorUserId,
          companyId,
          cashboxId: hqCashboxId,
        });
      } else {
        const confirmedPv = await client.query(
          `
          update payment_vouchers
          set status = 'confirmed', updated_at = now()
          where id = $1::uuid and status = 'draft'
          returning *
          `,
          [id],
        );
        const pv = confirmedPv.rows[0];
        if (!pv) throw new HttpError(409, 'تعذر اعتماد السند — ربما تم اعتماده مسبقاً.');
        await this.repository.insertCashboxAndMovementForPayment(client, pv);

        await this.repository.createReceiptVoucherWithClient(client, {
          voucherNo: `${pairNo}-AGENT-IN`,
          branchId: existing.branch_id ?? undefined,
          relatedEntityType: 'cashbox_transfer',
          status: 'confirmed',
          notes: `استلام وكيل من الفرع — ${notes}`,
          originalAmount: amount,
          originalCurrency: currency,
          exchangeRateToUsd: rate,
          baseAmountUsd: baseUsd,
          createdByUserId: fxContext.actorUserId,
          companyId,
          cashboxId: agentCashboxId,
        });
      }

      await client.query('commit');
      const updated = await this.repository.getPaymentVoucherById(id, scope);
      return updated;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private toMobileRow(row: Record<string, unknown>, kind: AgentPortalVoucherKind): AgentPortalVoucherRow {
    return {
      id: String(row.id),
      voucherNo: String(row.voucher_no ?? ''),
      kind,
      kindLabelAr: kindLabelAr(kind),
      status: String(row.status ?? 'draft'),
      amount: Number(row.original_amount ?? 0),
      currency: String(row.original_currency ?? 'USD'),
      description: String(row.notes ?? ''),
      createdAt: String(row.created_at ?? ''),
      counterpartyLabel: 'الفرع الرئيسي',
    };
  }
}
