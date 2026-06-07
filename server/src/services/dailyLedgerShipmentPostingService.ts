import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import type { AgentRepository } from '../repositories/agentRepository.js';
import type { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';
import type { ShipmentService } from '../services/shipmentService.js';
import { resolveAgentDestinationLabel } from '../utils/agentDestination.js';
import type { ShipmentFinancialInput } from './shipmentFinancialPostingService.js';

type LedgerRowRecord = {
  id: string;
  row_no: number;
  receipt_no: string | null;
  destination: string | null;
  parcel_type: string | null;
  parcel_count: number | null;
  weight_kg: string | number | null;
  sender_name: string | null;
  receiver_name: string | null;
  collect_amount_usd: string | number | null;
  prepaid_amount_usd: string | number | null;
  hawala_amount_usd: string | number | null;
  transfer_service_fee_usd: string | number | null;
  notes: string | null;
  posted_shipment_id: string | null;
  branch_id: string;
  company_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string | null;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
};

function money(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function amountsFromLedgerRow(row: LedgerRowRecord) {
  const collect = money(row.collect_amount_usd);
  const prepaid = money(row.prepaid_amount_usd);
  const hawalaAmount = money(row.hawala_amount_usd);
  const transferServiceFee = money(row.transfer_service_fee_usd);
  return {
    freightCharge: prepaid > 0 ? prepaid : 0,
    transferFee: collect > 0 ? collect : 0,
    prepaidAmount: prepaid,
    hawalaAmount,
    transferServiceFee,
    total: collect + prepaid + hawalaAmount + transferServiceFee,
  };
}

async function ensureSenderReceiver(
  client: PoolClient,
  name: string,
  type: 'sender' | 'receiver',
): Promise<string> {
  const normalized = normalizeName(name);
  const existing = await client.query<{ id: string }>(
    `
    select id
    from senders_receivers
    where lower(trim(full_name)) = lower($1)
    order by created_at desc
    limit 1
    `,
    [normalized],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `
    insert into senders_receivers(code, full_name, phone, type, status)
    values ($1, $2, '', $3, 'active')
    returning id
    `,
    [`SR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, normalized, type],
  );
  return created.rows[0].id;
}

async function ensureGoodsType(client: PoolClient, name: string): Promise<string> {
  const normalized = normalizeName(name);
  const existing = await client.query<{ id: string }>(
    `
    select id
    from goods_types
    where lower(trim(name)) = lower($1)
    order by created_at desc
    limit 1
    `,
    [normalized],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `
    insert into goods_types(code, name, description, is_active)
    values ($1, $2, '', true)
    returning id
    `,
    [`GT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, normalized],
  );
  return created.rows[0].id;
}

function isRowPostable(row: LedgerRowRecord): boolean {
  return Boolean(
    normalizeName(row.receipt_no) &&
      normalizeName(row.destination) &&
      normalizeName(row.sender_name) &&
      normalizeName(row.receiver_name) &&
      !row.posted_shipment_id,
  );
}

async function resolveAccountCustomerBySenderName(
  companyId: string,
  senderName: string,
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeName(senderName);
  if (!normalized) return null;

  const result = await pool.query<{ id: string; name: string }>(
    `
    select id, name
    from customers
    where status = 'active'
      and is_account_customer = true
      and (company_id = $1::uuid or company_id is null)
      and lower(trim(name)) = lower($2)
    order by created_at desc
    `,
    [companyId, normalized],
  );

  if (result.rows.length === 1) {
    return result.rows[0];
  }
  if (result.rows.length > 1) {
    throw new HttpError(
      400,
      `يوجد أكثر من عميل حسابي باسم «${normalized}». يرجى تمييزهم برقم هاتف مختلف في بطاقة العميل.`,
    );
  }
  return null;
}

export class DailyLedgerShipmentPostingService {
  constructor(
    private readonly ledgerRepo: DailyLedgerRepository,
    private readonly shipmentService: ShipmentService,
    private readonly agentRepository: AgentRepository,
  ) {}

  private async loadRow(scope: DataScope, rowId: string): Promise<LedgerRowRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<LedgerRowRecord>(
      `
      select
        r.*,
        s.branch_id,
        s.company_id,
        s.ledger_date::text as ledger_date,
        s.line_label,
        s.origin_label,
        s.trip_no,
        s.vehicle_label,
        s.driver_label
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.id = $1
        and s.company_id = $2
        and r.deleted_at is null
        and s.deleted_at is null
      limit 1
      `,
      [rowId, scope.companyId],
    );
    return result.rows[0] ?? null;
  }

  private async loadPendingRows(
    scope: DataScope,
    filters: { branchId: string; ledgerDate: string; lineLabel: string; rowIds?: string[] },
  ): Promise<LedgerRowRecord[]> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const values: unknown[] = [scope.companyId, filters.branchId, filters.ledgerDate, filters.lineLabel];
    let rowFilter = '';
    if (filters.rowIds?.length) {
      values.push(filters.rowIds);
      rowFilter = `and r.id = any($${values.length}::uuid[])`;
    }
    const result = await pool.query<LedgerRowRecord>(
      `
      select
        r.*,
        s.branch_id,
        s.company_id,
        s.ledger_date::text as ledger_date,
        s.line_label,
        s.origin_label,
        s.trip_no,
        s.vehicle_label,
        s.driver_label
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where s.company_id = $1
        and s.branch_id = $2
        and s.ledger_date = $3::date
        and s.line_label = $4
        and r.deleted_at is null
        and s.deleted_at is null
        and r.posted_shipment_id is null
        ${rowFilter}
      order by r.row_no asc
      `,
      values,
    );
    return result.rows;
  }

  async postRowAsShipment(
    scope: DataScope,
    rowId: string,
    allowedBranchIds: string[],
  ): Promise<{ rowId: string; shipmentId: string; shipmentNo: string; agentId: string | null }> {
    const row = await this.loadRow(scope, rowId);
    if (!row) throw new HttpError(404, 'سطر الدفتر غير موجود.');
    if (row.posted_shipment_id) {
      return {
        rowId: row.id,
        shipmentId: row.posted_shipment_id,
        shipmentNo: '',
        agentId: null,
      };
    }
    if (!isRowPostable(row)) {
      throw new HttpError(400, `السطر ${row.row_no} غير مكتمل للترحيل (يلزم: إيصال + جهة + مرسل + مستلم).`);
    }

    const client = await pool.connect();
    let senderId: string;
    let receiverId: string;
    try {
      await client.query('begin');
      senderId = await ensureSenderReceiver(client, row.sender_name ?? '', 'sender');
      receiverId = await ensureSenderReceiver(client, row.receiver_name ?? '', 'receiver');
      const parcelType = normalizeName(row.parcel_type);
      if (parcelType) {
        await ensureGoodsType(client, parcelType);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    const agent = await this.agentRepository.resolveAgentForDestination(
      scope.companyId!,
      normalizeName(row.destination),
    );
    const agentId = agent.id;
    const destinationCity = resolveAgentDestinationLabel(agent) || normalizeName(row.destination);

    const amounts = amountsFromLedgerRow(row);
    const accountCustomer = await resolveAccountCustomerBySenderName(row.company_id, row.sender_name ?? '');

    const notes = [
      row.notes,
      row.trip_no ? `رقم الرحلة: ${row.trip_no}` : '',
      row.vehicle_label ? `المركبة: ${row.vehicle_label}` : '',
      row.driver_label ? `السائق: ${row.driver_label}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const financial: ShipmentFinancialInput = accountCustomer
      ? {
          paymentMode: 'UNPAID',
          financialResponsibilityType: 'ACCOUNT_CUSTOMER',
          financialResponsibilityId: accountCustomer.id,
          ...(amounts.total <= 0 ? { allowZeroAmountNote: 'شحنة مؤكدة بدون أجرة' } : {}),
        }
      : {
          paymentMode: 'UNPAID',
          financialResponsibilityType: 'AGENT',
          financialResponsibilityId: agentId,
          ...(amounts.total <= 0 ? { allowZeroAmountNote: 'شحنة مؤكدة بدون أجرة' } : {}),
        };

    const receiptNo = normalizeName(row.receipt_no);
    const existingShipment = await pool.query<{ id: string; shipment_no: string }>(
      `
      select id, shipment_no
      from shipments
      where company_id = $1::uuid
        and deleted_at is null
        and lower(trim(shipment_no)) = lower($2)
      limit 1
      `,
      [row.company_id, receiptNo],
    );
    if (existingShipment.rows[0]) {
      const shipmentId = existingShipment.rows[0].id;
      const linked = await pool.query<{ id: string; row_no: number }>(
        `
        select id, row_no
        from daily_ledger_rows
        where deleted_at is null
          and posted_shipment_id = $1::uuid
        `,
        [shipmentId],
      );
      const otherLink = linked.rows.find((entry) => entry.id !== row.id);
      if (otherLink) {
        throw new HttpError(
          409,
          `رقم الإيصال ${receiptNo} مربوط بسطر دفتر آخر (سطر ${otherLink.row_no}).`,
        );
      }
      const posted = await this.ledgerRepo.markPosted(
        scope,
        { rowId: row.id, shipmentId, userId: scope.userId },
        allowedBranchIds,
      );
      if (!posted) {
        throw new HttpError(409, `تعذر ربط الشحنة الموجودة بالسطر ${row.row_no}.`);
      }
      return {
        rowId: row.id,
        shipmentId,
        shipmentNo: String(existingShipment.rows[0].shipment_no ?? receiptNo),
        agentId,
      };
    }

    const created = await this.shipmentService.create(
      {
        shipmentNo: normalizeName(row.receipt_no),
        referenceNo: normalizeName(row.receipt_no),
        senderId,
        receiverId,
        branchId: row.branch_id,
        agentId,
        customerId: accountCustomer?.id,
        companyId: row.company_id,
        originCity: normalizeName(row.origin_label) || normalizeName(row.line_label),
        destinationCity,
        description: notes || normalizeName(row.parcel_type),
        piecesCount: Number(row.parcel_count) || 1,
        weightKg: row.weight_kg == null ? undefined : Number(row.weight_kg),
        status: 'CONFIRMED',
        originalAmount: amounts.total,
        originalCurrency: 'USD',
        exchangeRateToUsd: 1,
        baseAmountUsd: amounts.total,
        freightCharge: amounts.freightCharge,
        transferFee: amounts.transferFee,
        prepaidAmount: amounts.prepaidAmount,
        hawalaAmount: amounts.hawalaAmount,
        transferServiceFee: amounts.transferServiceFee,
        discountAmount: 0,
        createdBy: scope.userId,
      },
      { ...scope, branchId: row.branch_id, companyId: row.company_id },
      { financial, actorUserId: scope.userId },
    );

    const posted = await this.ledgerRepo.markPosted(
      scope,
      { rowId: row.id, shipmentId: created.id, userId: scope.userId },
      allowedBranchIds,
    );
    if (!posted) {
      throw new HttpError(409, `تعذر ربط الشحنة بالسطر ${row.row_no}.`);
    }

    return {
      rowId: row.id,
      shipmentId: created.id,
      shipmentNo: String(created.shipment_no ?? ''),
      agentId,
    };
  }

  async postPendingShipments(
    scope: DataScope,
    filters: { branchId: string; ledgerDate: string; lineLabel: string; rowIds?: string[] },
    allowedBranchIds: string[],
  ) {
    const rows = await this.loadPendingRows(scope, filters);
    const postable = rows.filter(isRowPostable);
    const skipped = rows
      .filter((row) => !isRowPostable(row))
      .map((row) => ({ rowId: row.id, rowNo: row.row_no, reason: 'ناقص: إيصال أو جهة أو مرسل أو مستلم' }));

    const posted: Array<{ rowId: string; rowNo: number; shipmentId: string; shipmentNo: string; agentId: string | null }> = [];
    const errors: Array<{ rowId: string; rowNo: number; message: string }> = [];

    for (const row of postable) {
      try {
        const result = await this.postRowAsShipment(scope, row.id, allowedBranchIds);
        posted.push({
          rowId: result.rowId,
          rowNo: row.row_no,
          shipmentId: result.shipmentId,
          shipmentNo: result.shipmentNo,
          agentId: result.agentId,
        });
      } catch (error) {
        errors.push({
          rowId: row.id,
          rowNo: row.row_no,
          message: error instanceof Error ? error.message : 'تعذر ترحيل السطر',
        });
      }
    }

    return { posted, skipped, errors };
  }
}
