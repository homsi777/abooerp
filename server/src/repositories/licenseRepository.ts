import { pool } from '../db/pool.js';

export interface LicenseRecord {
  id: string;
  companyId: string;
  licenseCode: string;
  licenseType: string;
  machineId: string | null;
  isActive: boolean;
  cloudEnabled: boolean;
  shipmentLimit: number | null;
  deliveryLimit: number | null;
  receiptLimit: number | null;
  activatedAt: string;
}

export interface LicenseUsage {
  shipmentsUsed: number;
  deliveriesUsed: number;
  receiptsUsed: number;
}

export class LicenseRepository {
  async findActiveByCompany(companyId: string): Promise<LicenseRecord | null> {
    const res = await pool.query<any>(
      `select * from license_activations
       where company_id = $1 and is_active = true
       order by activated_at desc
       limit 1`,
      [companyId],
    );
    return res.rows[0] ? this._map(res.rows[0]) : null;
  }

  /** Resolve the default single-tenant company when no auth context is present. */
  async resolveDefaultCompanyId(): Promise<string | null> {
    const res = await pool.query<{ id: string }>(
      `select id from companies order by created_at limit 1`,
    );
    return res.rows[0]?.id ?? null;
  }

  async activate(data: {
    companyId: string;
    licenseCode: string;
    licenseType: string;
    machineId?: string | null;
    cloudEnabled: boolean;
    shipmentLimit?: number | null;
    deliveryLimit?: number | null;
    receiptLimit?: number | null;
  }): Promise<LicenseRecord> {
    // Deactivate any existing licenses for this company
    await pool.query(
      `update license_activations set is_active = false where company_id = $1`,
      [data.companyId],
    );
    const res = await pool.query<any>(
      `insert into license_activations
         (company_id, license_code, license_type, machine_id, is_active, cloud_enabled,
          shipment_limit, delivery_limit, receipt_limit, activated_at)
       values ($1,$2,$3,$4,true,$5,$6,$7,$8,now())
       on conflict (company_id, license_code) do update set
         is_active      = true,
         license_type   = excluded.license_type,
         machine_id     = excluded.machine_id,
         cloud_enabled  = excluded.cloud_enabled,
         shipment_limit = excluded.shipment_limit,
         delivery_limit = excluded.delivery_limit,
         receipt_limit  = excluded.receipt_limit,
         activated_at   = now()
       returning *`,
      [
        data.companyId,
        data.licenseCode,
        data.licenseType,
        data.machineId ?? null,
        data.cloudEnabled,
        data.shipmentLimit ?? null,
        data.deliveryLimit ?? null,
        data.receiptLimit ?? null,
      ],
    );
    return this._map(res.rows[0]);
  }

  async getUsage(companyId: string): Promise<LicenseUsage> {
    const res = await pool.query<{
      shipments_used: string;
      deliveries_used: string;
      receipts_used: string;
    }>(
      `select
        (select count(*) from shipments       where company_id = $1 and deleted_at is null)::text as shipments_used,
        (select count(*) from deliveries      where company_id = $1 and deleted_at is null)::text as deliveries_used,
        (select count(*) from receipt_vouchers where company_id = $1)::text                       as receipts_used`,
      [companyId],
    );
    const row = res.rows[0];
    return {
      shipmentsUsed: parseInt(row?.shipments_used ?? '0', 10),
      deliveriesUsed: parseInt(row?.deliveries_used ?? '0', 10),
      receiptsUsed: parseInt(row?.receipts_used ?? '0', 10),
    };
  }

  private _map(row: any): LicenseRecord {
    return {
      id: row.id,
      companyId: row.company_id,
      licenseCode: row.license_code,
      licenseType: row.license_type,
      machineId: row.machine_id ?? null,
      isActive: row.is_active,
      cloudEnabled: row.cloud_enabled,
      shipmentLimit: row.shipment_limit ?? null,
      deliveryLimit: row.delivery_limit ?? null,
      receiptLimit: row.receipt_limit ?? null,
      activatedAt: row.activated_at,
    };
  }
}
