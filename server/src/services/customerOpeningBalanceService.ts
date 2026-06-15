import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
import { resolveExchangeRateToUsd } from '../utils/resolveExchangeRateToUsd.js';

export type OpeningBalanceSide = 'debit' | 'credit';

export interface SyncCustomerOpeningBalanceInput {
  customerId: string;
  companyId?: string | null;
  isAccountCustomer: boolean;
  amount: number;
  side: OpeningBalanceSide;
  currencyCode: string;
  branchId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  referenceNo?: string | null;
}

const exchangeRateRepository = new ExchangeRateRepository();

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function syncCustomerOpeningBalance(
  input: SyncCustomerOpeningBalanceInput,
  client?: PoolClient,
): Promise<void> {
  const db = client ?? pool;
  const amount = roundMoney(Math.max(0, Number(input.amount ?? 0)));

  await db.query(
    `
    delete from party_financial_movements
    where party_type = 'customer'
      and party_id = $1::uuid
      and movement_type = 'customer_opening_balance'
      and is_reversal = false
    `,
    [input.customerId],
  );

  if (!input.isAccountCustomer || amount <= 0) {
    return;
  }

  const side: OpeningBalanceSide = input.side === 'credit' ? 'credit' : 'debit';
  const direction = side === 'debit' ? 'debit' : 'credit';
  const currencyCode = String(input.currencyCode || 'USD').trim().toUpperCase();
  const exchangeRateToUsd = await resolveExchangeRateToUsd(
    exchangeRateRepository,
    String(input.companyId ?? ''),
    currencyCode,
    new Date().toISOString().slice(0, 10),
  );
  const baseAmountUsd = roundMoney(amount * exchangeRateToUsd);
  const debitAmount = side === 'debit' ? amount : 0;
  const creditAmount = side === 'credit' ? amount : 0;
  const notes =
    side === 'debit'
      ? 'رصيد/دين افتتاحي — عليه (ذمة على العميل)'
      : 'رصيد افتتاحي — له (ذمة للعميل)';

  await db.query(
    `
    insert into party_financial_movements(
      party_type, party_id, movement_type, voucher_type, voucher_id,
      branch_id, agent_id, direction, notes,
      original_amount, original_currency, exchange_rate_to_usd, base_amount_usd,
      created_by_user_id,
      reference_type, reference_id, reference_no,
      debit_amount, credit_amount, currency_code, exchange_rate, posted_at,
      metadata
    ) values (
      'customer', $1::uuid, 'customer_opening_balance', null, null,
      $2::uuid, $3::uuid, $4, $5,
      $6, $7, $8, $9,
      $10::uuid,
      'CUSTOMER', $1::uuid, $11,
      $12, $13, $7, $8, now(),
      jsonb_build_object('opening_balance_side', $14::text)
    )
    `,
    [
      input.customerId,
      input.branchId ?? null,
      input.agentId ?? null,
      direction,
      notes,
      amount,
      currencyCode,
      exchangeRateToUsd,
      baseAmountUsd,
      input.userId ?? null,
      input.referenceNo ?? null,
      debitAmount,
      creditAmount,
      side,
    ],
  );
}
