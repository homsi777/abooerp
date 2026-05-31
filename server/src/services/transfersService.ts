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

  private async upsertTransferFeeSystemParty(client: PoolClient): Promise<string> {
    const { rows } = await client.query(
      `
      insert into senders_receivers(code, full_name, type, status, created_at, updated_at)
      values ('SR-SYS-TRANSFER-FEE', 'إيرادات الحوالات', 'both', 'active', now(), now())
      on conflict (code)
      do update set full_name = excluded.full_name, updated_at = now()
      returning id
      `,
    );
    return String(rows[0].id);
  }

  async createTransfer(payload: TransferPayload, client?: PoolClient) {
    return this.repo.create(payload, client);
  }

  async listTransfers(filters: { company_id: string; branch_id?: string; agent_id?: string; status?: string; search?: string }) {
    return this.repo.list(filters);
  }

  async listAgentPortalTransfers(input: {
    companyId: string;
    agentId: string;
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    return this.repo.listForAgent(input);
  }

  async getAgentPortalTransfer(id: string, companyId: string, agentId: string) {
    return this.repo.getByIdForAgent(id, companyId, agentId);
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

      const transferServiceFee = Number(transfer.transfer_service_fee ?? 0);
      const transferServiceFeeCurrency = String(transfer.transfer_service_fee_currency ?? transfer.currency ?? 'USD').toUpperCase();

      const cashboxResult = await client.query(
        `
        select id, company_id, currency_code, is_active
        from cashboxes
        where id = $1
        limit 1
        `,
        [input.cashboxId],
      );
      const cashbox = cashboxResult.rows[0];
      if (!cashbox) {
        throw new HttpError(400, 'الصندوق غير موجود.');
      }
      if (String(cashbox.company_id) !== String(input.companyId)) {
        throw new HttpError(403, 'هذا الصندوق غير مرتبط بحساب الشركة الحالية.');
      }
      if (cashbox.is_active === false) {
        throw new HttpError(400, 'الصندوق غير نشط ولا يمكن استخدامه في الترحيل.');
      }
      if (transferServiceFee > 0 && String(cashbox.currency_code).toUpperCase() !== transferServiceFeeCurrency) {
        throw new HttpError(400, 'عملة أجرة الحوالة لا تطابق عملة الصندوق.');
      }

      let receiptVoucherId: string | null = null;
      if (transferServiceFee > 0) {
        const senderReceiverId = await this.upsertTransferFeeSystemParty(client);
        const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
          originalCurrency: transferServiceFeeCurrency,
          companyId: input.companyId,
          baseCurrency: input.baseCurrency,
        });
        const voucherNo = input.voucherNo || `RV-${Date.now()}`;
        const voucher = await this.financeRepository.createReceiptVoucherWithClient(client, {
          voucherNo,
          branchId: transfer.branch_id ?? undefined,
          agentId: transfer.agent_id ?? undefined,
          shipmentId: transfer.shipment_id ?? undefined,
          senderReceiverId,
          relatedEntityType: 'transfer',
          relatedEntityId: transfer.id,
          status: 'confirmed',
          notes: `أجرة حوالة — ${transfer.sender_name} إلى ${transfer.receiver_name}`,
          originalAmount: transferServiceFee,
          originalCurrency: transferServiceFeeCurrency,
          exchangeRateToUsd,
          baseAmountUsd: computeBaseAmountUsd(transferServiceFee, exchangeRateToUsd),
          createdByUserId: input.userId ?? undefined,
          companyId: input.companyId,
          cashboxId: input.cashboxId,
        });
        receiptVoucherId = String(voucher.id);
      }

      const completed = await this.repo.markCompleted(
        transfer.id,
        input.companyId,
        { receiptVoucherId, postedCashboxId: input.cashboxId, postedByUserId: input.userId ?? null },
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
