import { pool } from '../db/pool.js';

export type DeviceStatus = 'pending' | 'approved' | 'blocked';

export interface LinkedDevice {
  id: string;
  machine_id: string;
  device_name: string;
  ip_address: string | null;
  os_type: string | null;
  company_id: string;
  branch_id: string | null;
  is_approved: boolean;
  is_blocked: boolean;
  approved_by: string | null;
  approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface LinkedDeviceRow extends LinkedDevice {
  // joined
  approved_by_name?: string;
}

export class LinkedDeviceRepository {
  // ── Register or touch ────────────────────────────────────────────────────────
  async upsertDevice(params: {
    machineId: string;
    deviceName: string;
    ipAddress: string | null;
    osType: string | null;
    companyId: string;
  }): Promise<LinkedDevice> {
    const result = await pool.query<LinkedDevice>(
      `
      insert into linked_devices(
        machine_id, device_name, ip_address, os_type, company_id
      ) values($1, $2, $3, $4, $5)
      on conflict (machine_id) do update set
        ip_address   = excluded.ip_address,
        os_type      = coalesce(linked_devices.os_type, excluded.os_type),
        last_seen_at = now(),
        updated_at   = now()
      returning *
      `,
      [
        params.machineId,
        params.deviceName,
        params.ipAddress,
        params.osType,
        params.companyId,
      ],
    );
    return result.rows[0];
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────
  async heartbeat(machineId: string, ipAddress: string | null): Promise<void> {
    await pool.query(
      `
      update linked_devices
      set last_seen_at = now(),
          ip_address   = coalesce($2, ip_address),
          updated_at   = now()
      where machine_id = $1
      `,
      [machineId, ipAddress],
    );
  }

  // ── Find by machine ID ───────────────────────────────────────────────────────
  async findByMachineId(machineId: string): Promise<LinkedDevice | null> {
    const result = await pool.query<LinkedDevice>(
      `select * from linked_devices where machine_id = $1 limit 1`,
      [machineId],
    );
    return result.rows[0] ?? null;
  }

  // ── List all for company ─────────────────────────────────────────────────────
  async listByCompany(companyId: string): Promise<LinkedDeviceRow[]> {
    const result = await pool.query<LinkedDeviceRow>(
      `
      select
        d.*,
        u.full_name as approved_by_name
      from linked_devices d
      left join users u on u.id = d.approved_by
      where d.company_id = $1
      order by d.last_seen_at desc
      `,
      [companyId],
    );
    return result.rows;
  }

  // ── Approve ──────────────────────────────────────────────────────────────────
  async approve(id: string, companyId: string, approvedBy: string): Promise<LinkedDevice | null> {
    const result = await pool.query<LinkedDevice>(
      `
      update linked_devices
      set is_approved  = true,
          is_blocked   = false,
          approved_by  = $3,
          approved_at  = now(),
          updated_at   = now()
      where id = $1 and company_id = $2
      returning *
      `,
      [id, companyId, approvedBy],
    );
    return result.rows[0] ?? null;
  }

  // ── Block ────────────────────────────────────────────────────────────────────
  async block(id: string, companyId: string): Promise<LinkedDevice | null> {
    const result = await pool.query<LinkedDevice>(
      `
      update linked_devices
      set is_blocked  = true,
          is_approved = false,
          updated_at  = now()
      where id = $1 and company_id = $2
      returning *
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  // ── Rename ───────────────────────────────────────────────────────────────────
  async rename(id: string, companyId: string, name: string): Promise<LinkedDevice | null> {
    const result = await pool.query<LinkedDevice>(
      `
      update linked_devices
      set device_name = $3, updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `,
      [id, companyId, name],
    );
    return result.rows[0] ?? null;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async remove(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `delete from linked_devices where id = $1 and company_id = $2 returning id`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  async getStats(companyId: string) {
    const result = await pool.query<{
      total: string;
      approved: string;
      pending: string;
      blocked: string;
    }>(
      `
      select
        count(*)::text                                        as total,
        count(*) filter (where is_approved)::text            as approved,
        count(*) filter (where not is_approved and not is_blocked)::text as pending,
        count(*) filter (where is_blocked)::text             as blocked
      from linked_devices
      where company_id = $1
      `,
      [companyId],
    );
    return result.rows[0];
  }
}
