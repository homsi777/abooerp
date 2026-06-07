import { pool } from '../db/pool.js';
export class ManifestRepository {
    async list(scope) {
        const conditions = ['deleted_at is null'];
        const values = [];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        const result = await pool.query(`select * from manifests where ${conditions.join(' and ')} order by created_at desc`, values);
        return result.rows;
    }
    async getById(id, scope) {
        const conditions = ['m.id = $1', 'm.deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`m.company_id = $${values.length}`);
        }
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`m.branch_id = $${values.length}`);
        }
        const manifest = await pool.query(`select m.* from manifests m where ${conditions.join(' and ')}`, values);
        if (!manifest.rowCount) {
            return null;
        }
        const shipments = await pool.query(`
      select s.*
      from manifest_shipments ms
      join shipments s on s.id = ms.shipment_id and s.deleted_at is null
      where ms.manifest_id = $1
      `, [id]);
        return { ...manifest.rows[0], shipments: shipments.rows };
    }
    async create(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const manifest = await client.query(`
        insert into manifests(manifest_no, branch_id, vehicle_id, driver_id, status, company_id, created_by)
        values($1, $2, $3, $4, $5, $6, $7)
        returning *
        `, [
                input.manifestNo,
                input.branchId,
                input.vehicleId ?? null,
                input.driverId ?? null,
                input.status,
                input.companyId ?? null,
                input.createdBy ?? null,
            ]);
            if (input.shipmentIds?.length) {
                for (const shipmentId of input.shipmentIds) {
                    await client.query('insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing', [manifest.rows[0].id, shipmentId]);
                    await client.query("update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered' and deleted_at is null", [shipmentId]);
                }
                await client.query(`
          update daily_ledger_rows
          set
            loaded_manifest_id = $1,
            loaded_at = now(),
            updated_at = now()
          where deleted_at is null
            and posted_shipment_id = any($2::uuid[])
          `, [manifest.rows[0].id, input.shipmentIds]);
            }
            await client.query('commit');
            return manifest.rows[0];
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async update(id, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const expectsUpdatedAt = Boolean(input.expectedUpdatedAt);
            const result = await client.query(`
        update manifests
        set
          branch_id = coalesce($2, branch_id),
          vehicle_id = coalesce($3, vehicle_id),
          driver_id = coalesce($4, driver_id),
          status = coalesce($5, status),
          updated_at = now()
        where id = $1
          and deleted_at is null
          and (
            $6::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $7::timestamptz)
          )
        returning *
        `, [
                id,
                input.branchId ?? null,
                input.vehicleId ?? null,
                input.driverId ?? null,
                input.status ?? null,
                expectsUpdatedAt,
                input.expectedUpdatedAt ?? null,
            ]);
            if (!result.rowCount) {
                await client.query('rollback');
                return null;
            }
            if (input.shipmentIds) {
                await client.query('delete from manifest_shipments where manifest_id = $1', [id]);
                for (const shipmentId of input.shipmentIds) {
                    await client.query('insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing', [id, shipmentId]);
                    await client.query("update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered' and deleted_at is null", [shipmentId]);
                }
                if (input.shipmentIds.length) {
                    await client.query(`
            update daily_ledger_rows
            set
              loaded_manifest_id = $1,
              loaded_at = now(),
              updated_at = now()
            where deleted_at is null
              and posted_shipment_id = any($2::uuid[])
            `, [id, input.shipmentIds]);
                }
            }
            await client.query('commit');
            return result.rows[0] ?? null;
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async listLoadableShipments(scope, filters) {
        const conditions = [
            's.deleted_at is null',
            `upper(s.status::text) not in ('DELIVERED', 'FINANCIALLY_CLOSED', 'CANCELLED', 'RETURNED')`,
        ];
        const values = [];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`s.company_id = $${values.length}::uuid`);
        }
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`s.branch_id = $${values.length}::uuid`);
        }
        if (filters.dateFrom) {
            values.push(filters.dateFrom);
            conditions.push(`coalesce(dls.ledger_date, s.created_at::date) >= $${values.length}::date`);
        }
        if (filters.dateTo) {
            values.push(filters.dateTo);
            conditions.push(`coalesce(dls.ledger_date, s.created_at::date) <= $${values.length}::date`);
        }
        if (filters.destination?.trim()) {
            values.push(`%${filters.destination.trim()}%`);
            const idx = values.length;
            conditions.push(`(
        coalesce(ag.governorate, '') ilike $${idx}
        or coalesce(ag.city, '') ilike $${idx}
        or coalesce(ag.area, '') ilike $${idx}
        or coalesce(s.destination_city, '') ilike $${idx}
        or coalesce(dlr.destination, '') ilike $${idx}
      )`);
        }
        if (filters.loadStatus === 'pending') {
            if (filters.manifestId) {
                values.push(filters.manifestId);
                const idx = values.length;
                conditions.push(`(
          ms.manifest_id is null
          or ms.manifest_id = $${idx}::uuid
        )`);
            }
            else {
                conditions.push('ms.manifest_id is null');
            }
        }
        else if (filters.loadStatus === 'loaded') {
            conditions.push('ms.manifest_id is not null');
        }
        const result = await pool.query(`
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
        ag.name as agent_name,
        coalesce(
          nullif(trim(ag.governorate), ''),
          nullif(trim(ag.city), ''),
          nullif(trim(ag.area), ''),
          nullif(trim(s.destination_city), ''),
          nullif(trim(dlr.destination), ''),
          'غير محدد'
        ) as operational_center,
        ms.manifest_id as loaded_manifest_id,
        m.manifest_no as loaded_manifest_no,
        dlr.loaded_at::text as loaded_at
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
        select ms.*
        from manifest_shipments ms
        join manifests m on m.id = ms.manifest_id and m.deleted_at is null
        where ms.shipment_id = s.id
        order by ms.created_at desc
        limit 1
      ) ms on true
      left join manifests m on m.id = ms.manifest_id and m.deleted_at is null
      where ${conditions.join(' and ')}
      order by coalesce(dls.ledger_date, s.created_at::date) desc, s.created_at desc, s.shipment_no desc
      limit 3000
      `, values);
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
            totalAmount: Number(row.original_amount ?? 0),
            currencyCode: String(row.original_currency ?? 'USD'),
            agentName: row.agent_name ? String(row.agent_name) : null,
            operationalCenter: String(row.operational_center ?? 'غير محدد'),
            loadedManifestId: row.loaded_manifest_id ? String(row.loaded_manifest_id) : null,
            loadedManifestNo: row.loaded_manifest_no ? String(row.loaded_manifest_no) : null,
            loadedAt: row.loaded_at ? String(row.loaded_at) : null,
            fromQuickLedger: Boolean(row.ledger_receipt_no || row.ledger_destination),
            isLoaded: Boolean(row.loaded_manifest_id),
        }));
    }
    async remove(id, scope) {
        const conditions = ['id = $1', 'deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`update manifests set deleted_at = now() where ${conditions.join(' and ')} returning id`, values);
        return Boolean(result.rowCount);
    }
}
