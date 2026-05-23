import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import type { FinanceRepository } from '../repositories/financeRepository.js';
import type { ShipmentRepository } from '../repositories/shipmentRepository.js';
import { calculateShipmentFinancialBreakdown } from '../utils/shipmentFinancialBreakdown.js';

export type PaymentMode = 'UNPAID' | 'PAID_NOW' | 'PARTIAL';
/** Legacy payer kind — now superseded by financialResponsibilityType */
export type PayerPartyKind = 'SENDER' | 'RECEIVER' | 'CUSTOMER' | 'AGENT';
/** New: explicit financial responsibility classification */
export type FinancialResponsibilityType = 'AGENT' | 'ACCOUNT_CUSTOMER' | 'COMPANY_CASH' | 'FREE';

export type ShipmentFinancialInput = {
  paymentMode: PaymentMode;
  paidAmount?: number;
  cashboxId?: string;
  paymentMethod?: 'cash' | 'transfer' | 'other';
  /** New: explicit financial responsibility type (preferred over payerPartyKind) */
  financialResponsibilityType?: FinancialResponsibilityType;
  /** New: agent_id or customer_id for the responsible party */
  financialResponsibilityId?: string;
  /** Legacy: kept for backward compatibility. Use financialResponsibilityType instead. */
  payerPartyKind?: PayerPartyKind;
  /** When original_amount is zero */
  allowZeroAmountNote?: string;
};

type UserContext = {
  userId?: string;
  userType?: string;
};

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves which ledger party (if any) bears the shipment charge.
 * Returns null for COMPANY_CASH and FREE (no party debit created).
 *
 * Priority: financialResponsibilityType → shipment.financial_responsibility_type → auto-detect from agent_id → COMPANY_CASH.
 */
function resolveFinancialParty(
  shipment: Record<string, unknown>,
  financial: ShipmentFinancialInput,
): { partyType: 'agent' | 'customer' | 'sender_receiver'; partyId: string } | null {
  const responsibilityType: string =
    financial.financialResponsibilityType ??
    (shipment.financial_responsibility_type as string | null | undefined) ??
    // Auto-detect: if shipment has an agent, it is the financial responsible party
    (shipment.agent_id ? 'AGENT' : null) ??
    // Legacy fallback: honour explicit payerPartyKind if set
    (financial.payerPartyKind ? financial.payerPartyKind : 'COMPANY_CASH');

  switch (responsibilityType) {
    case 'AGENT': {
      const agentId =
        financial.financialResponsibilityId ??
        (shipment.financial_responsibility_id as string | null | undefined) ??
        (shipment.agent_id as string | null | undefined);
      if (!agentId) {
        throw new HttpError(400, 'لا يوجد وكيل محدد للمسؤولية المالية. يرجى ربط الشحنة بوكيل.');
      }
      return { partyType: 'agent', partyId: agentId };
    }

    case 'ACCOUNT_CUSTOMER': {
      const customerId =
        financial.financialResponsibilityId ??
        (shipment.financial_responsibility_id as string | null | undefined) ??
        (shipment.customer_id as string | null | undefined);
      if (!customerId) {
        throw new HttpError(400, 'لا يوجد عميل حسابي محدد للمسؤولية المالية.');
      }
      return { partyType: 'customer', partyId: customerId };
    }

    case 'COMPANY_CASH':
    case 'FREE':
      // No party debit — cashbox handles the cash directly (or shipment is free)
      return null;

    // ── Legacy support ──────────────────────────────────────────────────────────
    case 'AGENT_LEGACY':
    case 'SENDER':
      return { partyType: 'sender_receiver', partyId: String(shipment.sender_id) };

    case 'CUSTOMER': {
      const cid = shipment.customer_id as string | null | undefined;
      if (!cid) throw new HttpError(400, 'لا يوجد عميل مرتبط بالشحنة.');
      return { partyType: 'customer', partyId: cid };
    }

    case 'RECEIVER':
    default:
      // Legacy default — kept for backward compatibility with old postings
      return { partyType: 'sender_receiver', partyId: String(shipment.receiver_id) };
  }
}

/** Resolve a human-readable name for the financial party */
async function resolvePartyName(
  client: PoolClient,
  partyType: string,
  partyId: string,
): Promise<string> {
  if (partyType === 'customer') {
    const r = await client.query(`select name from customers where id = $1`, [partyId]);
    return r.rows[0]?.name ?? '';
  }
  if (partyType === 'agent') {
    const r = await client.query(`select name from agents where id = $1`, [partyId]);
    return r.rows[0]?.name ?? '';
  }
  const r = await client.query(`select full_name from senders_receivers where id = $1`, [partyId]);
  return r.rows[0]?.full_name ?? '';
}

export class ShipmentFinancialPostingService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly finance: FinanceRepository,
  ) {}

  async lockShipmentForUpdate(client: PoolClient, shipmentId: string, scope?: DataScope) {
    return this.shipments.lockShipmentForUpdate(client, shipmentId, scope);
  }

  /**
   * ترحيل أجرة الشحنة عند إتمام دورة التشغيل دون الاعتماد على POST /confirm فقط
   * (مثلاً: حفظ الشحنة كمسودة ثم التسليم، أو تغيير الحالة من شاشة الإدخال).
   */
  async ensurePostedFromLifecycle(shipmentId: string, scope?: DataScope, actorUserId?: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const row = await this.shipments.lockShipmentForUpdate(client, shipmentId, scope);
      if (!row) {
        await client.query('rollback');
        return;
      }
      const fs = String(row.financial_status ?? 'UNPOSTED');
      if (fs === 'POSTED' || fs === 'PARTIALLY_PAID' || fs === 'PAID') {
        await client.query('commit');
        return;
      }
      const charge = calculateShipmentFinancialBreakdown(row).totalDueOnDelivery;
      // Use stored responsibility type or auto-detect from agent_id
      const storedType = row.financial_responsibility_type as FinancialResponsibilityType | null | undefined;
      const financial: ShipmentFinancialInput = {
        paymentMode: 'UNPAID',
        // Preserve stored responsibility type if available; otherwise auto-detect via resolveFinancialParty
        ...(storedType ? { financialResponsibilityType: storedType } : {}),
        ...(charge <= 0
          ? { allowZeroAmountNote: 'ترحيل تلقائي — أجرة صفرية (من دورة التشغيل)' }
          : {}),
      };
      await this.postShipmentConfirmationFinancials({
        client,
        shipmentId,
        scope,
        userContext: { userId: actorUserId },
        financial,
        shipmentRow: row,
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Idempotent posting: skips if already POSTED / charge movement exists */
  async postShipmentConfirmationFinancials(params: {
    client: PoolClient;
    shipmentId: string;
    scope?: DataScope;
    userContext?: UserContext;
    financial: ShipmentFinancialInput;
    shipmentRow?: Record<string, unknown>;
  }): Promise<{ shipment: Record<string, unknown>; receiptVoucher?: Record<string, unknown> }> {
    const { client, shipmentId, scope, userContext } = params;
    let financial = params.financial;
    let row: Record<string, unknown>;
    if (params.shipmentRow) {
      row = params.shipmentRow;
    } else {
      const locked = await this.shipments.lockShipmentForUpdate(client, shipmentId, scope);
      if (!locked) {
        throw new HttpError(404, 'الشحنة غير موجودة أو خارج النطاق.');
      }
      row = locked;
    }

    const fs = String(row.financial_status ?? 'UNPOSTED');
    if (fs === 'POSTED' || fs === 'PARTIALLY_PAID' || fs === 'PAID') {
      throw new HttpError(409, 'تم ترحيل هذه الشحنة مالياً مسبقاً.');
    }

    const breakdown = calculateShipmentFinancialBreakdown(row);
    const charge = breakdown.totalDueOnDelivery;
    const currency = String(row.original_currency ?? 'USD');
    const rate = Number(row.exchange_rate_to_usd ?? 1);

    // Auto-fill note for zero-amount shipments so they don't block confirmation.
    if (charge <= 0 && !financial.allowZeroAmountNote?.trim()) {
      financial = { ...financial, allowZeroAmountNote: 'شحنة مؤكدة بدون أجرة' };
    }

    if (charge <= 0 && financial.paymentMode !== 'UNPAID') {
      throw new HttpError(400, 'لا يمكن تسجيل قبض لشحنة بلا أجرة.');
    }

    // Resolve the correct financial party using the new responsibility model
    const resolvedParty = resolveFinancialParty(row, financial);
    const partyType = resolvedParty?.partyType ?? null;
    const partyId = resolvedParty?.partyId ?? null;

    // Determine effective responsibility type for storage
    const effectiveResponsibilityType: string =
      financial.financialResponsibilityType ??
      (row.financial_responsibility_type as string | null | undefined) ??
      (row.agent_id ? 'AGENT' : partyType === 'customer' ? 'ACCOUNT_CUSTOMER' : 'COMPANY_CASH');

    const effectiveResponsibilityId: string | null =
      financial.financialResponsibilityId ??
      (row.financial_responsibility_id as string | null | undefined) ??
      (partyType === 'agent' ? partyId : partyType === 'customer' ? partyId : null);

    const shipmentNo = String(row.shipment_no ?? '');
    const branchId = (row.branch_id as string | null) ?? null;
    const agentId = (row.agent_id as string | null) ?? null;
    const companyId = row.company_id as string | undefined;

    let paid = 0;
    if (financial.paymentMode === 'PAID_NOW') {
      paid = charge;
    } else if (financial.paymentMode === 'PARTIAL') {
      paid = roundMoney(Number(financial.paidAmount ?? 0));
      if (paid <= 0 || paid >= charge - 0.0001) {
        throw new HttpError(400, 'الدفع الجزئي يتطلب مبلغاً أكبر من صفر وأقل من إجمالي الأجرة.');
      }
    }

    if (paid < 0 || paid > charge + 0.0001) {
      throw new HttpError(400, 'المبلغ المدفوع غير صالح مقارنة بأجرة الشحنة.');
    }

    if (paid > 0 && !financial.cashboxId) {
      throw new HttpError(400, 'يجب تحديد صندوق صحيح لتسجيل القبض.');
    }

    if (paid > 0 && financial.cashboxId) {
      await this.assertCashboxAllowed(client, financial.cashboxId, scope, row, currency);
    }

    // Resolve display name for the financial party
    const payerNameSnap =
      partyType && partyId ? await resolvePartyName(client, partyType, partyId) : '';

    // Insert debit charge movement ONLY if there is a financial ledger party (not COMPANY_CASH or FREE)
    if (charge > 0 && partyType && partyId) {
      const chargeNotes =
        effectiveResponsibilityType === 'AGENT'
          ? `أجرة شحن على عهدة الوكيل — الشحنة رقم ${shipmentNo}`
          : effectiveResponsibilityType === 'ACCOUNT_CUSTOMER'
          ? `أجرة شحن على حساب العميل — الشحنة رقم ${shipmentNo}`
          : `أجرة شحن — ${shipmentNo}`;
      void chargeNotes;
      const senderName = row.sender_id ? await resolvePartyName(client, 'sender_receiver', String(row.sender_id)) : '';
      await this.finance.insertShipmentBreakdownMovements(client, {
        partyType: partyType as 'agent' | 'customer' | 'sender_receiver',
        partyId,
        shipmentId,
        branchId,
        agentId,
        currency,
        exchangeRateToUsd: rate,
        createdByUserId: userContext?.userId ?? null,
        shipmentNo,
        senderName,
        breakdown,
      });
    }

    let receiptVoucher: Record<string, unknown> | undefined;
    if (paid > 0 && financial.cashboxId) {
      const voucherNo = `RV-SHP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const notes = `قبض على الشحنة رقم ${shipmentNo}`;
      receiptVoucher = await this.finance.createReceiptVoucherWithClient(client, {
        voucherNo,
        branchId: branchId ?? undefined,
        agentId: agentId ?? undefined,
        shipmentId,
        status: 'confirmed',
        notes,
        originalAmount: paid,
        originalCurrency: currency as any,
        exchangeRateToUsd: rate,
        baseAmountUsd: Number((paid * rate).toFixed(2)),
        createdByUserId: userContext?.userId ?? undefined,
        companyId: companyId ?? undefined,
        cashboxId: financial.cashboxId,
        // Link receipt to the correct party type (agent, customer, or sender_receiver)
        senderReceiverId: partyType === 'sender_receiver' && partyId ? partyId : undefined,
        customerId: partyType === 'customer' && partyId ? partyId : undefined,
      });
    }

    const remaining = roundMoney(charge - paid);
    let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'UNPAID';
    if (paid <= 0) paymentStatus = 'UNPAID';
    else if (remaining <= 0.01) paymentStatus = 'PAID';
    else paymentStatus = 'PARTIAL';

    let financialStatus = 'POSTED';
    if (paymentStatus === 'PAID') financialStatus = 'PAID';
    else if (paymentStatus === 'PARTIAL') financialStatus = 'PARTIALLY_PAID';

    // Determine payer_party_kind for backward-compat storage (AGENT now supported)
    const legacyPayerKind =
      effectiveResponsibilityType === 'AGENT'
        ? 'AGENT'
        : effectiveResponsibilityType === 'ACCOUNT_CUSTOMER'
        ? 'CUSTOMER'
        : (financial.payerPartyKind ?? (row.payer_party_kind as string | null | undefined) ?? null);

    await client.query(
      `
      update shipments
      set
        financial_status = $2::text,
        financial_posted_at = now(),
        financial_posted_by_user_id = $3::uuid,
        payer_party_kind = $4::text,
        payer_name_snapshot = $5::text,
        payment_status = $6::text,
        paid_amount = $7::numeric,
        remaining_amount = $8::numeric,
        default_cashbox_id = coalesce($9::uuid, default_cashbox_id),
        financial_notes = coalesce($10::text, financial_notes),
        financial_responsibility_type = coalesce($11::text, financial_responsibility_type),
        financial_responsibility_id = coalesce($12::uuid, financial_responsibility_id),
        updated_at = now()
      where id = $1::uuid
      `,
      [
        shipmentId,
        financialStatus,
        userContext?.userId ?? null,
        legacyPayerKind ?? null,
        payerNameSnap || null,
        paymentStatus,
        paid,
        remaining,
        financial.cashboxId ?? null,
        financial.allowZeroAmountNote ?? null,
        effectiveResponsibilityType ?? null,
        effectiveResponsibilityId ?? null,
      ],
    );

    const updated = await client.query(`select * from shipments where id = $1`, [shipmentId]);
    return { shipment: updated.rows[0], receiptVoucher };
  }

  private async assertCashboxAllowed(
    client: PoolClient,
    cashboxId: string,
    scope: DataScope | undefined,
    shipment: Record<string, unknown>,
    currency: string,
  ) {
    const r = await client.query(`select * from cashboxes where id = $1 for update`, [cashboxId]);
    const cb = r.rows[0];
    if (!cb) {
      throw new HttpError(400, 'الصندوق غير موجود.');
    }
    if (!cb.is_active) {
      throw new HttpError(400, 'الصندوق غير نشط.');
    }
    if (String(cb.currency_code).toUpperCase() !== currency.toUpperCase()) {
      throw new HttpError(400, 'عملة الصندوق لا تطابق عملة الشحنة.');
    }
    if (scope?.financeAgentScope && scope.agentId) {
      if (String(cb.agent_id ?? '') !== String(scope.agentId)) {
        throw new HttpError(403, 'لا يمكن استخدام صندوق غير مرتبط بوكيلك.');
      }
      if (String(shipment.agent_id ?? '') !== String(scope.agentId)) {
        throw new HttpError(403, 'الشحنة لا تنتمي إلى نطاق وكيلك.');
      }
    }
  }

  async recalculateShipmentPaymentStatus(shipmentId: string) {
    const sh = await pool.query(`select * from shipments where id = $1 and deleted_at is null`, [shipmentId]);
    const row = sh.rows[0];
    if (!row) return null;

    const charge = calculateShipmentFinancialBreakdown(row).totalDueOnDelivery;
    const paidRes = await pool.query(
      `
      select coalesce(sum(original_amount), 0)::numeric as paid
      from receipt_vouchers
      where shipment_id = $1 and status = 'confirmed'
      `,
      [shipmentId],
    );
    const paid = roundMoney(Number(paidRes.rows[0]?.paid ?? 0));
    const remaining = roundMoney(charge - paid);
    let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'UNPAID';
    if (paid <= 0) paymentStatus = 'UNPAID';
    else if (remaining <= 0.01) paymentStatus = 'PAID';
    else paymentStatus = 'PARTIAL';

    let financialStatus = row.financial_status as string;
    if (financialStatus === 'POSTED' || financialStatus === 'PARTIALLY_PAID' || financialStatus === 'PAID') {
      if (paymentStatus === 'PAID') financialStatus = 'PAID';
      else if (paymentStatus === 'PARTIAL') financialStatus = 'PARTIALLY_PAID';
      else financialStatus = 'POSTED';
    }

    await pool.query(
      `
      update shipments
      set payment_status = $2, paid_amount = $3, remaining_amount = $4, financial_status = $5, updated_at = now()
      where id = $1
      `,
      [shipmentId, paymentStatus, paid, remaining, financialStatus],
    );

    return { charge, paid, remaining, paymentStatus, financialStatus };
  }

  async reverseShipmentFinancialPosting(
    shipmentId: string,
    reason: string,
    scope?: DataScope,
    userId?: string,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const row = await this.shipments.lockShipmentForUpdate(client, shipmentId, scope);
      if (!row) {
        throw new HttpError(404, 'الشحنة غير موجودة.');
      }
      await client.query(
        `
        update shipments
        set financial_status = 'REVERSED', financial_notes = coalesce($2::text, financial_notes), updated_at = now()
        where id = $1
        `,
        [shipmentId, reason],
      );
      await client.query(
        `update party_financial_movements
         set is_reversal = true, reverse_reason = $2
         where shipment_id = $1
           and movement_type in ('shipment_charge', 'shipment_shipping_fee', 'sender_collection_trust', 'loading_dues', 'general_collection')
           and is_reversal = false`,
        [shipmentId, reason],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    void userId;
  }

  async recordAdditionalPayment(input: {
    shipmentId: string;
    amount: number;
    cashboxId: string;
    paymentMethod?: string;
    scope?: DataScope;
    actorUserId?: string;
    notes?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const row = await this.shipments.lockShipmentForUpdate(client, input.shipmentId, input.scope);
      if (!row) {
        await client.query('rollback');
        throw new HttpError(404, 'الشحنة غير موجودة.');
      }
      const fs = String(row.financial_status ?? 'UNPOSTED');
      if (fs === 'UNPOSTED') {
        throw new HttpError(400, 'يجب ترحيل الشحنة مالياً (تأكيد مع ترصيد) قبل تسجيل دفعة.');
      }
      const charge = calculateShipmentFinancialBreakdown(row).totalDueOnDelivery;
      const currency = String(row.original_currency ?? 'USD');
      const rate = Number(row.exchange_rate_to_usd ?? 1);
      const amt = roundMoney(input.amount);
      if (amt <= 0) {
        throw new HttpError(400, 'مبلغ الدفع غير صالح.');
      }
      const curRem = roundMoney(charge - Number(row.paid_amount ?? 0));
      if (amt > curRem + 0.01) {
        throw new HttpError(400, 'مبلغ الدفع يتجاوز المتبقي على الشحنة.');
      }

      await this.assertCashboxAllowed(client, input.cashboxId, input.scope, row, currency);

      const shipmentNo = String(row.shipment_no ?? '');
      const branchId = (row.branch_id as string | null) ?? null;
      const agentId = (row.agent_id as string | null) ?? null;
      const companyId = row.company_id as string | undefined;
      // Resolve the financial party for late payment receipt
      const resolvedForPayment = resolveFinancialParty(row, {
        paymentMode: 'PAID_NOW',
        financialResponsibilityType: (row.financial_responsibility_type as FinancialResponsibilityType | null | undefined) ?? undefined,
        financialResponsibilityId: (row.financial_responsibility_id as string | null | undefined) ?? undefined,
      });
      const partyType = resolvedForPayment?.partyType ?? null;
      const partyId = resolvedForPayment?.partyId ?? null;

      const voucherNo = `RV-SHP-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await this.finance.createReceiptVoucherWithClient(client, {
        voucherNo,
        branchId: branchId ?? undefined,
        agentId: agentId ?? undefined,
        shipmentId: input.shipmentId,
        status: 'confirmed',
        notes: input.notes ?? `قبض لاحق على الشحنة ${shipmentNo}`,
        originalAmount: amt,
        originalCurrency: currency as any,
        exchangeRateToUsd: rate,
        baseAmountUsd: Number((amt * rate).toFixed(2)),
        createdByUserId: input.actorUserId ?? undefined,
        companyId: companyId ?? undefined,
        cashboxId: input.cashboxId,
        senderReceiverId: partyType === 'sender_receiver' && partyId ? partyId : undefined,
        customerId: partyType === 'customer' && partyId ? partyId : undefined,
      });

      const paidRes = await client.query(
        `
        select coalesce(sum(original_amount), 0)::numeric as s
        from receipt_vouchers
        where shipment_id = $1::uuid and status = 'confirmed'
        `,
        [input.shipmentId],
      );
      const totalPaid = roundMoney(Number(paidRes.rows[0]?.s ?? 0));
      const rem = roundMoney(charge - totalPaid);
      let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'PARTIAL';
      if (totalPaid <= 0) paymentStatus = 'UNPAID';
      else if (rem <= 0.01) paymentStatus = 'PAID';
      let financialStatus = String(row.financial_status ?? 'POSTED');
      if (paymentStatus === 'PAID') financialStatus = 'PAID';
      else if (paymentStatus === 'PARTIAL') financialStatus = 'PARTIALLY_PAID';

      await client.query(
        `
        update shipments
        set paid_amount = $2::numeric,
            remaining_amount = $3::numeric,
            payment_status = $4::text,
            financial_status = $5::text,
            updated_at = now()
        where id = $1::uuid
        `,
        [input.shipmentId, totalPaid, rem, paymentStatus, financialStatus],
      );

      await client.query('commit');
      const updated = await pool.query(`select * from shipments where id = $1`, [input.shipmentId]);
      return updated.rows[0];
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async getShipmentFinancialCard(shipmentId: string, scope?: DataScope) {
    const row = await this.shipments.getById(shipmentId, scope);
    if (!row) {
      if (scope && (await this.shipments.existsInCompany(shipmentId, scope.companyId))) {
        throw new HttpError(403, 'غير مسموح بعرض البيانات المالية لهذه الشحنة.');
      }
      throw new HttpError(404, 'الشحنة غير موجودة.');
    }
    const movements = await this.finance.listPartyMovementsForShipment(shipmentId, scope);
    const vouchers = await pool.query(
      `select id, voucher_no, status, original_amount, original_currency, cashbox_id, created_at from receipt_vouchers where shipment_id = $1 order by created_at desc`,
      [shipmentId],
    );
    return {
      shipmentNo: row.shipment_no,
      payerPartyKind: row.payer_party_kind,
      payerNameSnapshot: row.payer_name_snapshot,
      financialResponsibilityType: row.financial_responsibility_type ?? null,
      financialResponsibilityId: row.financial_responsibility_id ?? null,
      totalCharge: calculateShipmentFinancialBreakdown(row).totalDueOnDelivery,
      paidAmount: Number(row.paid_amount ?? 0),
      remainingAmount: row.remaining_amount != null ? Number(row.remaining_amount) : calculateShipmentFinancialBreakdown(row).totalDueOnDelivery,
      currency: row.original_currency,
      financialStatus: row.financial_status ?? 'UNPOSTED',
      paymentStatus: row.payment_status,
      defaultCashboxId: row.default_cashbox_id,
      movements,
      receiptVouchers: vouchers.rows,
    };
  }
}
