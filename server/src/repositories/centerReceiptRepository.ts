import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface CenterReceiptCreateInput {
  shipmentId: string;
  branchId?: string;
  agentId?: string;
  centerName: string;
  receivedByUserId?: string;
  notes?: string;
  companyId?: string;
}

export class CenterReceiptRepository {
  async list(scope?: DataScope) {
    const conditions: string[] = ['cr.deleted_at is null'];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`cr.company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`cr.branch_id = $${values.length}`);
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      conditions.push(`cr.agent_id = $${values.length}`);
    }

    const result = await pool.query(
      `
      select cr.*
      from center_receipts cr
      where ${conditions.join(' and ')}
      order by cr.received_at desc
      `,
      values,
    );
    return result.rows;
  }

  async listProvincialInbound(
    scope: DataScope | undefined,
    filters: {
      center?: string;
      dateFrom?: string;
      dateTo?: string;
      receiptStatus?: 'all' | 'pending' | 'received';
      driverId?: string;
    },
  ) {
    const conditions: string[] = [
      's.deleted_at is null',
      `upper(s.status::text) not in ('DELIVERED', 'FINANCIALLY_CLOSED', 'CANCELLED', 'RETURNED')`,
    ];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`s.company_id = $${values.length}::uuid`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`s.branch_id = $${values.length}::uuid`);
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      conditions.push(`s.agent_id = $${values.length}::uuid`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`coalesce(dls.ledger_date, s.created_at::date) >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`coalesce(dls.ledger_date, s.created_at::date) <= $${values.length}::date`);
    }
    if (filters.center?.trim()) {
      values.push(`%${filters.center.trim()}%`);
      const idx = values.length;
      conditions.push(`(
        coalesce(ag.governorate, '') ilike $${idx}
        or coalesce(ag.city, '') ilike $${idx}
        or coalesce(ag.area, '') ilike $${idx}
        or coalesce(s.destination_city, '') ilike $${idx}
        or coalesce(dlr.destination, '') ilike $${idx}
      )`);
    }
    if (filters.receiptStatus === 'pending') {
      conditions.push('cr.id is null');
    } else if (filters.receiptStatus === 'received') {
      conditions.push('cr.id is not null');
    }
    if (filters.driverId) {
      values.push(filters.driverId);
      conditions.push(`dls.driver_id = $${values.length}::uuid`);
    }

    const result = await pool.query(
      `
      select
        s.id as shipment_id,
        s.shipment_no,
        s.status as shipment_status,
        s.created_at as shipment_created_at,
        dls.ledger_date::text as ledger_date,
        dlr.receipt_no as ledger_receipt_no,
        dlr.destination as ledger_destination,
        dlr.parcel_type,
        dlr.parcel_count,
        dlr.weight_kg,
        coalesce(dlr.sender_name, sr_s.full_name) as sender_name,
        coalesce(dlr.receiver_name, sr_r.full_name) as receiver_name,
        coalesce(dlr.collect_amount_usd, 0) as collect_amount_usd,
        coalesce(dlr.prepaid_amount_usd, 0) as prepaid_amount_usd,
        coalesce(dlr.hawala_amount_usd, 0) as hawala_amount_usd,
        coalesce(dlr.transfer_service_fee_usd, 0) as transfer_service_fee_usd,
        s.original_amount,
        s.original_currency,
        s.agent_id,
        ag.name as agent_name,
        dls.driver_id,
        dls.driver_label,
        dls.vehicle_label,
        dls.trip_no,
        coalesce(
          nullif(trim(ag.governorate), ''),
          nullif(trim(ag.city), ''),
          nullif(trim(ag.area), ''),
          nullif(trim(s.destination_city), ''),
          nullif(trim(dlr.destination), ''),
          'غير محدد'
        ) as operational_center,
        (cr.id is not null) as center_received,
        cr.received_at::text as center_received_at,
        cr.center_name as center_receipt_name
      from shipments s
      left join daily_ledger_rows dlr
        on dlr.posted_shipment_id = s.id
       and dlr.deleted_at is null
      left join daily_ledger_sessions dls
        on dls.id = dlr.session_id
       and dls.deleted_at is null
      left join agents ag on ag.id = s.agent_id
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      left join senders_receivers sr_r on sr_r.id = s.receiver_id
      left join lateral (
        select cr.*
        from center_receipts cr
        where cr.shipment_id = s.id
          and cr.deleted_at is null
          and cr.status = 'received'
        order by cr.received_at desc
        limit 1
      ) cr on true
      where ${conditions.join(' and ')}
      order by coalesce(dls.ledger_date, s.created_at::date) desc, s.created_at desc, s.shipment_no desc
      limit 3000
      `,
      values,
    );

    return result.rows.map((row) => ({
      shipmentId: String(row.shipment_id),
      shipmentNo: String(row.shipment_no ?? ''),
      shipmentStatus: String(row.shipment_status ?? ''),
      shipmentCreatedAt: String(row.shipment_created_at ?? ''),
      ledgerDate: row.ledger_date ? String(row.ledger_date) : null,
      ledgerReceiptNo: row.ledger_receipt_no ? String(row.ledger_receipt_no) : null,
      ledgerDestination: row.ledger_destination ? String(row.ledger_destination) : null,
      parcelType: row.parcel_type ? String(row.parcel_type) : null,
      parcelCount: row.parcel_count == null ? null : Number(row.parcel_count),
      weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
      senderName: row.sender_name ? String(row.sender_name) : null,
      receiverName: row.receiver_name ? String(row.receiver_name) : null,
      collectAmount: Number(row.collect_amount_usd ?? 0),
      prepaidAmount: Number(row.prepaid_amount_usd ?? 0),
      hawalaAmount: Number(row.hawala_amount_usd ?? 0),
      transferServiceFee: Number(row.transfer_service_fee_usd ?? 0),
      totalAmount:
        Number(row.collect_amount_usd ?? 0) +
        Number(row.prepaid_amount_usd ?? 0) +
        Number(row.hawala_amount_usd ?? 0) +
        Number(row.transfer_service_fee_usd ?? 0),
      currencyCode: String(row.original_currency ?? 'USD'),
      agentId: row.agent_id ? String(row.agent_id) : null,
      agentName: row.agent_name ? String(row.agent_name) : null,
      driverId: row.driver_id ? String(row.driver_id) : null,
      driverLabel: row.driver_label ? String(row.driver_label) : null,
      vehicleLabel: row.vehicle_label ? String(row.vehicle_label) : null,
      tripNo: row.trip_no ? String(row.trip_no) : null,
      operationalCenter: String(row.operational_center ?? 'غير محدد'),
      centerReceived: Boolean(row.center_received),
      centerReceivedAt: row.center_received_at ? String(row.center_received_at) : null,
      centerReceiptName: row.center_receipt_name ? String(row.center_receipt_name) : null,
      fromQuickLedger: Boolean(row.ledger_receipt_no || row.ledger_destination),
    }));
  }

  async listVehicleTripReport(
    scope: DataScope | undefined,
    filters: { driverId: string; date: string },
  ) {
    const conditions: string[] = [
      'r.deleted_at is null',
      'dls.deleted_at is null',
      `(
        coalesce(r.receipt_no, '') <> ''
        or coalesce(r.destination, '') <> ''
        or coalesce(r.parcel_type, '') <> ''
        or coalesce(r.sender_name, '') <> ''
        or coalesce(r.receiver_name, '') <> ''
        or coalesce(r.notes, '') <> ''
        or coalesce(r.parcel_count, 0) <> 0
        or coalesce(r.weight_kg, 0) <> 0
        or coalesce(r.collect_amount_usd, 0) <> 0
        or coalesce(r.prepaid_amount_usd, 0) <> 0
        or coalesce(r.hawala_amount_usd, 0) <> 0
        or coalesce(r.fees_amount_usd, 0) <> 0
        or coalesce(r.transfer_service_fee_usd, 0) <> 0
      )`,
    ];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`dls.company_id = $${values.length}::uuid`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`dls.branch_id = $${values.length}::uuid`);
    }
    values.push(filters.date);
    conditions.push(`dls.ledger_date = $${values.length}::date`);
    values.push(filters.driverId);
    const driverParam = `$${values.length}`;
    conditions.push(`(
      dls.driver_id = ${driverParam}::uuid
      or (
        dls.driver_id is null
        and nullif(trim(dls.driver_label), '') is not null
        and trim(dls.driver_label) ilike (
          select trim(coalesce(dr.name, ''))
          from drivers dr
          where dr.id = ${driverParam}::uuid
          limit 1
        )
      )
    )`);

    const result = await pool.query(
      `
      select
        coalesce(s.id::text, r.id::text) as shipment_id,
        coalesce(s.shipment_no, r.receipt_no, r.id::text) as shipment_no,
        coalesce(s.status::text, 'LEDGER') as shipment_status,
        coalesce(s.created_at, r.created_at) as shipment_created_at,
        dls.ledger_date::text as ledger_date,
        r.receipt_no as ledger_receipt_no,
        r.destination as ledger_destination,
        r.parcel_type,
        r.parcel_count,
        r.weight_kg,
        coalesce(r.sender_name, sr_s.full_name) as sender_name,
        coalesce(r.receiver_name, sr_r.full_name) as receiver_name,
        coalesce(r.collect_amount_usd, 0) as collect_amount_usd,
        coalesce(r.prepaid_amount_usd, 0) as prepaid_amount_usd,
        coalesce(r.hawala_amount_usd, 0) as hawala_amount_usd,
        coalesce(r.transfer_service_fee_usd, 0) as transfer_service_fee_usd,
        s.original_amount,
        s.original_currency,
        s.agent_id,
        ag.name as agent_name,
        dls.driver_id,
        dls.driver_label,
        dls.vehicle_label,
        dls.trip_no,
        dls.line_label,
        coalesce(
          nullif(trim(ag.governorate), ''),
          nullif(trim(ag.city), ''),
          nullif(trim(ag.area), ''),
          nullif(trim(s.destination_city), ''),
          nullif(trim(r.destination), ''),
          'غير محدد'
        ) as operational_center,
        false as center_received,
        null::text as center_received_at,
        null::text as center_receipt_name,
        (r.posted_shipment_id is not null) as is_posted
      from daily_ledger_rows r
      join daily_ledger_sessions dls on dls.id = r.session_id
      left join shipments s on s.id = r.posted_shipment_id and s.deleted_at is null
      left join agents ag on ag.id = s.agent_id
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      left join senders_receivers sr_r on sr_r.id = s.receiver_id
      where ${conditions.join(' and ')}
      order by dls.line_label asc nulls last, r.row_no asc, r.receipt_no asc
      limit 5000
      `,
      values,
    );

    const rows = result.rows.map((row) => ({
      shipmentId: String(row.shipment_id),
      shipmentNo: String(row.shipment_no ?? ''),
      shipmentStatus: String(row.shipment_status ?? ''),
      shipmentCreatedAt: String(row.shipment_created_at ?? ''),
      ledgerDate: row.ledger_date ? String(row.ledger_date) : null,
      ledgerReceiptNo: row.ledger_receipt_no ? String(row.ledger_receipt_no) : null,
      ledgerDestination: row.ledger_destination ? String(row.ledger_destination) : null,
      parcelType: row.parcel_type ? String(row.parcel_type) : null,
      parcelCount: row.parcel_count == null ? null : Number(row.parcel_count),
      weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
      senderName: row.sender_name ? String(row.sender_name) : null,
      receiverName: row.receiver_name ? String(row.receiver_name) : null,
      collectAmount: Number(row.collect_amount_usd ?? 0),
      prepaidAmount: Number(row.prepaid_amount_usd ?? 0),
      hawalaAmount: Number(row.hawala_amount_usd ?? 0),
      transferServiceFee: Number(row.transfer_service_fee_usd ?? 0),
      totalAmount:
        Number(row.collect_amount_usd ?? 0) +
        Number(row.prepaid_amount_usd ?? 0) +
        Number(row.hawala_amount_usd ?? 0) +
        Number(row.transfer_service_fee_usd ?? 0),
      currencyCode: String(row.original_currency ?? 'USD'),
      agentId: row.agent_id ? String(row.agent_id) : null,
      agentName: row.agent_name ? String(row.agent_name) : null,
      driverId: row.driver_id ? String(row.driver_id) : null,
      driverLabel: row.driver_label ? String(row.driver_label) : null,
      vehicleLabel: row.vehicle_label ? String(row.vehicle_label) : null,
      tripNo: row.trip_no ? String(row.trip_no) : null,
      operationalCenter: String(row.operational_center ?? 'غير محدد'),
      centerReceived: false,
      centerReceivedAt: null,
      centerReceiptName: null,
      fromQuickLedger: true,
      isPosted: Boolean(row.is_posted),
      lineLabel: row.line_label ? String(row.line_label) : null,
    }));

    const postedRows = rows.filter((row) => row.isPosted).length;
    return {
      rows,
      meta: {
        totalRows: rows.length,
        postedRows,
        ledgerOnlyRows: rows.length - postedRows,
      },
    };
  }

  async getActiveByShipment(shipmentId: string, scope?: DataScope) {
    const conditions = ['shipment_id = $1', 'deleted_at is null'];
    const values: unknown[] = [shipmentId];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query(
      `select * from center_receipts where ${conditions.join(' and ')} order by created_at desc limit 1`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async create(input: CenterReceiptCreateInput) {
    const result = await pool.query(
      `
      insert into center_receipts(
        shipment_id, branch_id, agent_id, center_name, received_by_user_id, notes, company_id
      )
      values($1,$2,$3,$4,$5,$6,$7)
      on conflict (shipment_id) where deleted_at is null
      do update set
        center_name = excluded.center_name,
        received_by_user_id = coalesce(excluded.received_by_user_id, center_receipts.received_by_user_id),
        notes = coalesce(excluded.notes, center_receipts.notes),
        updated_at = now()
      returning *
      `,
      [
        input.shipmentId,
        input.branchId ?? null,
        input.agentId ?? null,
        input.centerName,
        input.receivedByUserId ?? null,
        input.notes ?? null,
        input.companyId ?? null,
      ],
    );
    return result.rows[0];
  }
}
