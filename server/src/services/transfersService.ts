import { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import type { FinanceRepository } from '../repositories/financeRepository.js';
import { computeBaseAmountUsd } from '../utils/money.js';
import { HttpError } from '../utils/errors.js';
import { TransfersRepository, TransferPayload } from '../repositories/transfersRepository.js';

export class TransfersService {
  private exchangeRateRepository = new ExchangeRateRepository();

  constructor(
    private repo: TransfersRepository,
    private financeRepository: FinanceRepository,
  ) {}

  private async resolveExchangeRateToUsd(options: {
    originalCurrency: string;
    companyId: string;
    baseCurrency?: string;
    effectiveDate?: string;
  }): Promise<number> {
    const normalizedCurrency = String(options.originalCurrency || '').toUpperCase();
    const baseCurrency = String(options.baseCurrency || 'USD').toUpperCase();
    if (!normalizedCurrency) {
      throw new HttpError(400, 'originalCurrency is required.');
    }
    if (normalizedCurrency === baseCurrency) {
      return 1;
    }
    const atDate = options.effectiveDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const byDate = await this.exchangeRateRepository.getRateByDateByCode(normalizedCurrency, atDate, options.companyId);
    if (byDate && byDate.rate > 0) {
      return byDate.rate;
    }
    const latest = await this.exchangeRateRepository.getLatestRateByCode(normalizedCurrency, options.companyId);
    if (latest && latest.rate > 0) {
      return latest.rate;
    }
    throw new HttpError(400, `Missing exchange rate for currency ${normalizedCurrency}.`);
  }

  async createTransfer(payload: TransferPayload, client?: PoolClient) {
    return this.repo.create(payload, client);
  }

  private async assertAgentBelongsToCompany(client: PoolClient, agentId: string, companyId: string) {
    const result = await client.query(
      `select a.id from agents a join branches b on b.id = a.branch_id where a.id = $1 and b.company_id = $2 and a.is_active = true limit 1`,
      [agentId, companyId],
    );
    if (!result.rowCount) throw new HttpError(400, 'الوكيل المحدد غير موجود أو غير نشط.');
  }

  private async assertCashbox(client: PoolClient, cashboxId: string, companyId: string, currency: string) {
    const result = await client.query(
      `select id, company_id, currency_code, is_active, agent_id, branch_id from cashboxes where id = $1 limit 1`,
      [cashboxId],
    );
    const cashbox = result.rows[0];
    if (!cashbox) throw new HttpError(400, 'الصندوق غير موجود.');
    if (String(cashbox.company_id) !== String(companyId)) throw new HttpError(403, 'الصندوق خارج نطاق الشركة.');
    if (!cashbox.is_active) throw new HttpError(400, 'الصندوق غير نشط.');
    if (String(cashbox.currency_code).toUpperCase() !== String(currency).toUpperCase()) {
      throw new HttpError(400, 'عملة الصندوق لا تطابق عملة الحوالة.');
    }
    return cashbox;
  }

  private async resolveAgentCashbox(client: PoolClient, companyId: string, agentId: string, currency: string) {
    const result = await client.query(
      `select id from cashboxes where company_id = $1 and agent_id = $2 and is_active = true and upper(currency_code) = upper($3) order by created_at asc limit 1`,
      [companyId, agentId, currency],
    );
    const id = result.rows[0]?.id as string | undefined;
    if (!id) throw new HttpError(400, 'لا يوجد صندوق نشط للوكيل بعملة الحوالة.');
    return id;
  }

  private async insertAgentTransferMovement(client: PoolClient, input: {
    agentId: string;
    transferId: string;
    branchId?: string | null;
    movementType: 'transfer_principal_collected' | 'transfer_service_fee_collected' | 'transfer_principal_paid' | 'transfer_agent_commission';
    direction: 'debit' | 'credit';
    amount: number;
    currency: string;
    exchangeRateToUsd: number;
    notes: string;
    userId?: string;
  }) {
    if (input.amount <= 0) return;
    await client.query(
      `
      insert into party_financial_movements(
        party_type, party_id, movement_type, branch_id, agent_id, direction, notes,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd,
        created_by_user_id, reference_type, reference_id, reference_no,
        debit_amount, credit_amount, currency_code, exchange_rate, posted_at
      ) values(
        'agent', $1, $2, $3, $1, $4, $5,
        $6, $7, $8, $9,
        $10, 'TRANSFER', $11::uuid, $11::text,
        case when $4 = 'debit' then $6::numeric else 0::numeric end,
        case when $4 = 'credit' then $6::numeric else 0::numeric end,
        $7, $8, now()
      )
      on conflict do nothing
      `,
      [
        input.agentId,
        input.movementType,
        input.branchId ?? null,
        input.direction,
        input.notes,
        input.amount,
        input.currency,
        input.exchangeRateToUsd,
        computeBaseAmountUsd(input.amount, input.exchangeRateToUsd),
        input.userId ?? null,
        input.transferId,
      ],
    );
  }

  async createTransferAndCollect(input: {
    payload: TransferPayload;
    collectionCashboxId: string;
    userId?: string;
    baseCurrency?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const originAgentId = input.payload.origin_agent_id;
      if (!originAgentId) throw new HttpError(400, 'يجب تحديد وكيل المصدر لتسجيل قبض الحوالة.');
      await this.assertAgentBelongsToCompany(client, originAgentId, input.payload.company_id);
      if (input.payload.destination_agent_id) {
        await this.assertAgentBelongsToCompany(client, input.payload.destination_agent_id, input.payload.company_id);
      }
      const collectionCashbox = await this.assertCashbox(client, input.collectionCashboxId, input.payload.company_id, input.payload.currency);
      if (String(collectionCashbox.agent_id ?? '') !== String(originAgentId)) {
        throw new HttpError(400, 'صندوق قبض الحوالة يجب أن يكون تابعاً لوكيل المصدر.');
      }
      const transfer = await this.repo.create({ ...input.payload, collection_cashbox_id: input.collectionCashboxId }, client);
      const rate = await this.resolveExchangeRateToUsd({
        originalCurrency: transfer.currency,
        companyId: input.payload.company_id,
        baseCurrency: input.baseCurrency,
      });
      const collected = Number(transfer.amount ?? 0) + Number(transfer.transfer_service_fee ?? 0);
      const voucher = await this.financeRepository.createReceiptVoucherWithClient(client, {
        voucherNo: `RV-TR-COL-${Date.now()}-${String(transfer.id).slice(0, 6)}`,
        branchId: transfer.branch_id ?? undefined,
        relatedEntityType: 'transfer_collection',
        relatedEntityId: transfer.id,
        status: 'confirmed',
        notes: `قبض أصل حوالة وأجرتها — ${transfer.sender_name} إلى ${transfer.receiver_name}`,
        originalAmount: collected,
        originalCurrency: transfer.currency,
        exchangeRateToUsd: rate,
        companyId: input.payload.company_id,
        cashboxId: input.collectionCashboxId,
        createdByUserId: input.userId,
      });
      await this.repo.markCollected(transfer.id, input.payload.company_id, {
        collectionCashboxId: input.collectionCashboxId,
        collectionReceiptVoucherId: String(voucher.id),
      }, client);
      await this.insertAgentTransferMovement(client, {
        agentId: originAgentId, transferId: transfer.id, branchId: transfer.branch_id,
        movementType: 'transfer_principal_collected', direction: 'debit',
        amount: Number(transfer.amount), currency: transfer.currency, exchangeRateToUsd: rate,
        notes: `أصل حوالة مقبوض بعهدة الوكيل — ${transfer.sender_name} إلى ${transfer.receiver_name}`, userId: input.userId,
      });
      await this.insertAgentTransferMovement(client, {
        agentId: originAgentId, transferId: transfer.id, branchId: transfer.branch_id,
        movementType: 'transfer_service_fee_collected', direction: 'debit',
        amount: Number(transfer.transfer_service_fee ?? 0), currency: transfer.currency, exchangeRateToUsd: rate,
        notes: `أجرة حوالة مقبوضة بعهدة الوكيل — ${transfer.sender_name} إلى ${transfer.receiver_name}`, userId: input.userId,
      });
      await client.query('commit');
      return this.repo.getById(transfer.id, input.payload.company_id);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async createAgentPortalTransfer(input: {
    companyId: string;
    originAgentId: string;
    senderName: string;
    receiverName: string;
    destinationCity: string;
    amount: number;
    currency: string;
    transferServiceFee: number;
    notes?: string;
    userId?: string;
    baseCurrency?: string;
  }) {
    const client = await pool.connect();
    try {
      const destination = await client.query(
        `
        select a.id
        from agents a
        join branches b on b.id = a.branch_id
        where b.company_id = $1
          and a.is_active = true
          and (
            lower(trim(coalesce(a.area, ''))) = lower(trim($2))
            or lower(trim(coalesce(a.city, ''))) = lower(trim($2))
            or lower(trim(coalesce(a.governorate, ''))) = lower(trim($2))
          )
        order by a.created_at asc
        `,
        [input.companyId, input.destinationCity],
      );
      if (destination.rowCount !== 1) {
        throw new HttpError(400, destination.rowCount ? 'يوجد أكثر من وكيل للوجهة. تواصل مع الإدارة لتحديد الوكيل.' : 'لا يوجد وكيل نشط مطابق للوجهة.');
      }
      const origin = await client.query(`select branch_id from agents where id = $1 limit 1`, [input.originAgentId]);
      if (!origin.rows[0]) throw new HttpError(403, 'AGENT_NOT_LINKED');
      const cashboxId = await this.resolveAgentCashbox(client, input.companyId, input.originAgentId, input.currency);
      const rate = await this.resolveExchangeRateToUsd({
        originalCurrency: input.currency, companyId: input.companyId, baseCurrency: input.baseCurrency,
      });
      return this.createTransferAndCollect({
        collectionCashboxId: cashboxId,
        userId: input.userId,
        baseCurrency: input.baseCurrency,
        payload: {
          company_id: input.companyId,
          branch_id: origin.rows[0].branch_id ?? undefined,
          origin_agent_id: input.originAgentId,
          destination_agent_id: String(destination.rows[0].id),
          agent_id: String(destination.rows[0].id),
          destination_city: input.destinationCity,
          sender_name: input.senderName,
          receiver_name: input.receiverName,
          amount: input.amount,
          currency: input.currency,
          main_amount: computeBaseAmountUsd(input.amount, rate),
          transfer_service_fee: input.transferServiceFee,
          transfer_service_fee_currency: input.currency,
          transfer_service_fee_main: computeBaseAmountUsd(input.transferServiceFee, rate),
          company_transfer_profit: input.transferServiceFee,
          company_transfer_profit_currency: input.currency,
          company_transfer_profit_main: computeBaseAmountUsd(input.transferServiceFee, rate),
          status: 'PENDING',
          notes: input.notes,
        },
      });
    } finally {
      client.release();
    }
  }

  async completeAgentPortalTransfer(input: {
    id: string;
    companyId: string;
    agentId: string;
    userId?: string;
    baseCurrency?: string;
  }) {
    const transfer = await this.repo.getByIdForAgent(input.id, input.companyId, input.agentId);
    if (!transfer || String(transfer.destination_agent_id ?? transfer.agent_id ?? '') !== String(input.agentId)) {
      throw new HttpError(404, 'TRANSFER_NOT_FOUND');
    }
    const client = await pool.connect();
    try {
      const cashboxId = await this.resolveAgentCashbox(client, input.companyId, input.agentId, String(transfer.currency ?? 'USD'));
      return this.completeTransfer({ ...input, cashboxId });
    } finally {
      client.release();
    }
  }

  async listTransfers(filters: { company_id: string; branch_id?: string; agent_id?: string; status?: string; search?: string }) {
    return this.repo.list(filters);
  }

  async listAgentPortalTransfers(input: {
    companyId: string;
    agentId: string;
    status?: string;
    search?: string;
    type?: 'independent' | 'shipment_linked';
    limit: number;
    offset: number;
  }) {
    return this.repo.listForAgent(input);
  }

  async getAgentPortalTransfer(id: string, companyId: string, agentId: string) {
    return this.repo.getByIdForAgent(id, companyId, agentId);
  }

  async getAgentPortalTransferByShipmentId(shipmentId: string, companyId: string, agentId: string) {
    return this.repo.getByShipmentIdForAgent(shipmentId, companyId, agentId);
  }

  async updateTransferStatus(id: string, company_id: string, status: string, client?: PoolClient) {
    return this.repo.updateStatus(id, company_id, status, client);
  }

  async deleteTransfer(input: { id: string; companyId: string; userId?: string; reason?: string }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const transfer = await this.repo.lockById(input.id, input.companyId, client);
      if (!transfer) {
        throw new HttpError(404, 'الحوالة غير موجودة.');
      }
      const status = String(transfer.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        throw new HttpError(400, 'لا يمكن حذف حوالة مكتملة. قم بإلغائها بدلاً من ذلك.');
      }
      if (status === 'CANCELLED') {
        throw new HttpError(400, 'لا يمكن حذف حوالة ملغاة.');
      }
      const cancelled = await this.repo.markCancelled(
        input.id,
        input.companyId,
        { cancelledByUserId: input.userId ?? null, cancellationReason: input.reason ?? 'حذف إداري' },
        client,
      );
      await client.query('commit');
      return cancelled;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async completeTransfer(input: {
    id: string;
    companyId: string;
    cashboxId: string;
    userId?: string;
    baseCurrency?: string;
    voucherNo?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const transfer = await this.repo.lockById(input.id, input.companyId, client);
      if (!transfer) {
        throw new HttpError(404, 'الحوالة غير موجودة.');
      }
      const status = String(transfer.status || '').toUpperCase();
      if (status === 'CANCELLED') {
        throw new HttpError(400, 'لا يمكن ترحيل حوالة ملغاة.');
      }
      if (status === 'COMPLETED') {
        await client.query('commit');
        return transfer;
      }

      const currency = String(transfer.currency ?? 'USD').toUpperCase();
      const payoutCashbox = await this.assertCashbox(client, input.cashboxId, input.companyId, currency);
      if (!transfer.shipment_id && !transfer.collection_receipt_voucher_id) {
        throw new HttpError(400, 'لا يمكن تسليم حوالة مستقلة قبل تسجيل قبضها من المصدر.');
      }
      const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
        originalCurrency: currency, companyId: input.companyId, baseCurrency: input.baseCurrency,
      });
      const voucher = await this.financeRepository.createPaymentVoucherWithClient(client, {
        voucherNo: input.voucherNo || `PV-TR-PAY-${Date.now()}-${String(transfer.id).slice(0, 6)}`,
        branchId: transfer.branch_id ?? undefined,
        shipmentId: transfer.shipment_id ?? undefined,
        relatedEntityType: 'transfer_payout',
        relatedEntityId: transfer.id,
        status: 'confirmed',
        notes: `دفع أصل حوالة للمستلم — ${transfer.sender_name} إلى ${transfer.receiver_name}`,
        originalAmount: Number(transfer.amount),
        originalCurrency: currency,
        exchangeRateToUsd,
        companyId: input.companyId,
        cashboxId: input.cashboxId,
        createdByUserId: input.userId,
      });
      const destinationAgentId = String(transfer.destination_agent_id ?? transfer.agent_id ?? '');
      if (destinationAgentId && String(payoutCashbox.agent_id ?? '') !== destinationAgentId) {
        throw new HttpError(400, 'صندوق تسليم الحوالة يجب أن يكون تابعاً لوكيل الوجهة.');
      }
      if (destinationAgentId) {
        await this.insertAgentTransferMovement(client, {
          agentId: destinationAgentId, transferId: transfer.id, branchId: transfer.branch_id,
          movementType: 'transfer_principal_paid', direction: 'credit',
          amount: Number(transfer.amount), currency, exchangeRateToUsd,
          notes: `دفع أصل حوالة للمستلم — ${transfer.sender_name} إلى ${transfer.receiver_name}`, userId: input.userId,
        });
        await this.insertAgentTransferMovement(client, {
          agentId: destinationAgentId, transferId: transfer.id, branchId: transfer.branch_id,
          movementType: 'transfer_agent_commission', direction: 'credit',
          amount: Number(transfer.agent_commission ?? 0), currency: transfer.agent_commission_currency ?? currency,
          exchangeRateToUsd, notes: `عمولة حوالة — ${transfer.sender_name} إلى ${transfer.receiver_name}`, userId: input.userId,
        });
      }

      const completed = await this.repo.markCompleted(
        transfer.id,
        input.companyId,
        { postedCashboxId: input.cashboxId, payoutPaymentVoucherId: String(voucher.id), postedByUserId: input.userId ?? null },
        client,
      );
      await client.query('commit');
      return completed;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelTransfer(input: { id: string; companyId: string; userId?: string; reason?: string }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const transfer = await this.repo.lockById(input.id, input.companyId, client);
      if (!transfer) {
        throw new HttpError(404, 'الحوالة غير موجودة.');
      }
      const status = String(transfer.status || '').toUpperCase();
      if (status === 'CANCELLED') {
        await client.query('commit');
        return transfer;
      }

      if (status === 'COMPLETED' && transfer.receipt_voucher_id) {
        await this.financeRepository.updateReceiptVoucherWithClient(client, String(transfer.receipt_voucher_id), {
          status: 'cancelled',
        });
      }
      if (status === 'COMPLETED' && transfer.payout_payment_voucher_id) {
        await this.financeRepository.updatePaymentVoucherWithClient(client, String(transfer.payout_payment_voucher_id), {
          status: 'cancelled',
        });
      }
      if (transfer.collection_receipt_voucher_id) {
        await this.financeRepository.updateReceiptVoucherWithClient(client, String(transfer.collection_receipt_voucher_id), {
          status: 'cancelled',
        });
      }
      await client.query(
        `update party_financial_movements set is_reversal = true, reverse_reason = $2 where reference_type = 'TRANSFER' and reference_id = $1 and is_reversal = false`,
        [transfer.id, input.reason ?? 'إلغاء الحوالة'],
      );

      const cancelled = await this.repo.markCancelled(
        transfer.id,
        input.companyId,
        { cancelledByUserId: input.userId ?? null, cancellationReason: input.reason ?? null },
        client,
      );
      await client.query('commit');
      return cancelled;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
