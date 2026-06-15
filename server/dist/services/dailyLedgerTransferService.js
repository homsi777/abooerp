import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function normalizeReceipt(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function isDeliveredStatus(status) {
    const s = String(status ?? '').trim().toUpperCase();
    return s === 'DELIVERED' || s === 'DELIVERED'.toLowerCase().toUpperCase();
}
function isCancelledStatus(status, financialStatus) {
    const s = String(status ?? '').trim().toUpperCase();
    const f = String(financialStatus ?? '').trim().toUpperCase();
    return s === 'CANCELLED' || f === 'CANCELLED' || f === 'REVERSED';
}
function summarize(rows) {
    const destinations = new Set();
    let piecesCount = 0;
    let weightKg = 0;
    let freightTotal = 0;
    let collectionTotal = 0;
    let prepaidTotal = 0;
    for (const row of rows) {
        piecesCount += Number(row.parcel_count) || 0;
        weightKg += money(row.weight_kg);
        const prepaid = money(row.prepaid_amount_usd);
        const collect = money(row.collect_amount_usd) + money(row.fees_amount_usd);
        prepaidTotal += prepaid;
        collectionTotal += collect;
        freightTotal += prepaid > 0 ? prepaid : 0;
        const dest = String(row.destination ?? '').trim();
        if (dest)
            destinations.add(dest);
    }
    return {
        rowsCount: rows.length,
        piecesCount,
        weightKg: Math.round(weightKg * 100) / 100,
        weightTons: Math.round((weightKg / 1000) * 1000) / 1000,
        freightTotal: Math.round(freightTotal * 100) / 100,
        collectionTotal: Math.round(collectionTotal * 100) / 100,
        prepaidTotal: Math.round(prepaidTotal * 100) / 100,
        destinations: [...destinations],
    };
}
export class DailyLedgerTransferService {
    async loadRows(client, companyId, rowIds, forUpdate) {
        if (!rowIds.length)
            return [];
        const lock = forUpdate ? 'for update of r' : '';
        const result = await client.query(`
      select
        r.id, r.row_no, r.receipt_no, r.sender_name, r.receiver_name, r.destination,
        r.parcel_count, r.weight_kg, r.collect_amount_usd, r.prepaid_amount_usd,
        r.hawala_amount_usd, r.fees_amount_usd, r.transfer_service_fee_usd,
        r.posted_shipment_id, r.loaded_at, r.deleted_at,
        r.session_id,
        s.company_id, s.branch_id, s.ledger_date::text as ledger_date, s.line_label,
        s.origin_label, s.driver_id,
        sh.status as shipment_status, sh.financial_status
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      left join shipments sh on sh.id = r.posted_shipment_id and sh.deleted_at is null
      where r.id = any($1::uuid[])
        and s.company_id = $2::uuid
        and s.deleted_at is null
      ${lock}
      `, [rowIds, companyId]);
        return result.rows;
    }
    /** تحقق وملخص — لا تعديل في قاعدة البيانات */
    async validateTransfer(scope, input) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const client = await pool.connect();
        try {
            const rows = await this.loadRows(client, scope.companyId, input.rowIds, false);
            const { warnings, errors } = this.collectIssues(rows, input.rowIds);
            return {
                valid: errors.length === 0,
                summary: summarize(rows.filter((r) => !r.deleted_at)),
                warnings,
                errors,
            };
        }
        finally {
            client.release();
        }
    }
    collectIssues(rows, requestedIds) {
        const warnings = [];
        const errors = [];
        if (!requestedIds.length) {
            errors.push('يجب تحديد سطر واحد على الأقل');
            return { warnings, errors };
        }
        const foundIds = new Set(rows.map((r) => r.id));
        const missing = requestedIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
            errors.push(`${missing.length} سطر غير موجود أو لا ينتمي لشركتك`);
        }
        const seenReceipts = new Map();
        for (const row of rows) {
            if (row.deleted_at) {
                errors.push(`السطر ${row.row_no}: لا يمكن نقل سطر محذوف`);
                continue;
            }
            if (row.loaded_at) {
                errors.push(`السطر ${row.row_no} (${row.receipt_no ?? ''}): لا يمكن نقل سطر محمّل على بيان`);
            }
            if (isCancelledStatus(row.shipment_status, row.financial_status)) {
                errors.push(`السطر ${row.row_no} (${row.receipt_no ?? ''}): لا يمكن نقل سطر ملغى`);
            }
            if (isDeliveredStatus(row.shipment_status)) {
                errors.push(`السطر ${row.row_no} (${row.receipt_no ?? ''}): لا يمكن نقل شحنة مُسلّمة`);
            }
            const collect = money(row.collect_amount_usd) + money(row.fees_amount_usd);
            const prepaid = money(row.prepaid_amount_usd);
            const hawala = money(row.hawala_amount_usd);
            const serviceFee = money(row.transfer_service_fee_usd);
            if (collect <= 0 && prepaid <= 0 && hawala <= 0 && serviceFee <= 0) {
                errors.push(`السطر ${row.row_no} (${row.receipt_no ?? ''}): يجب إدخال التحصيل أو المدفوع مسبقاً قبل النقل`);
            }
            const receiptKey = normalizeReceipt(row.receipt_no);
            if (receiptKey) {
                if (seenReceipts.has(receiptKey)) {
                    errors.push(`رقم الإيصال مكرر ضمن التحديد: ${row.receipt_no}`);
                }
                else {
                    seenReceipts.set(receiptKey, row.row_no);
                }
            }
            if (row.posted_shipment_id) {
                warnings.push(`السطر ${row.row_no} (${row.receipt_no ?? ''}): مُرحَّل مسبقاً — سيُنقل تشغيلياً فقط دون أثر مالي جديد`);
            }
        }
        return { warnings, errors };
    }
    async resolveDriverLabel(client, driverId) {
        if (!driverId)
            return null;
        const result = await client.query(`select code, full_name from drivers where id = $1::uuid limit 1`, [driverId]);
        const row = result.rows[0];
        if (!row)
            return null;
        return row.code ? `${row.code} — ${row.full_name}` : row.full_name;
    }
    async resolveVehicleLabel(client, vehicleId) {
        if (!vehicleId)
            return null;
        const result = await client.query(`select plate_number, model from vehicles where id = $1::uuid limit 1`, [vehicleId]);
        const row = result.rows[0];
        if (!row)
            return null;
        return row.model ? `${row.plate_number} — ${row.model}` : row.plate_number;
    }
    async findOrCreateTargetSession(client, params) {
        const result = await client.query(`
      insert into daily_ledger_sessions(
        company_id, branch_id, ledger_date, line_label, origin_label,
        trip_no, vehicle_label, driver_label, driver_id, vehicle_id,
        created_by, updated_by
      )
      values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$11)
      on conflict (
        company_id,
        branch_id,
        ledger_date,
        line_label,
        (coalesce(driver_id, '00000000-0000-0000-0000-000000000000'::uuid))
      ) where deleted_at is null
      do update set
        origin_label = coalesce(excluded.origin_label, daily_ledger_sessions.origin_label),
        trip_no = coalesce(excluded.trip_no, daily_ledger_sessions.trip_no),
        vehicle_label = coalesce(excluded.vehicle_label, daily_ledger_sessions.vehicle_label),
        vehicle_id = coalesce(excluded.vehicle_id, daily_ledger_sessions.vehicle_id),
        driver_label = coalesce(excluded.driver_label, daily_ledger_sessions.driver_label),
        driver_id = coalesce(excluded.driver_id, daily_ledger_sessions.driver_id),
        updated_by = excluded.updated_by,
        updated_at = now()
      returning id
      `, [
            params.companyId,
            params.branchId,
            params.ledgerDate,
            params.lineLabel,
            params.originLabel,
            params.tripNo,
            params.vehicleLabel,
            params.driverLabel,
            params.driverId,
            params.vehicleId,
            params.userId,
        ]);
        const sessionId = result.rows[0]?.id;
        if (!sessionId) {
            throw new HttpError(500, 'تعذر إنشاء أو إيجاد الإرسالية الهدف.');
        }
        return sessionId;
    }
    async sessionSummary(client, sessionId) {
        const result = await client.query(`
      select
        r.id, r.row_no, r.receipt_no, r.sender_name, r.receiver_name, r.destination,
        r.parcel_count, r.weight_kg, r.collect_amount_usd, r.prepaid_amount_usd,
        r.hawala_amount_usd, r.fees_amount_usd, r.transfer_service_fee_usd,
        r.posted_shipment_id, r.loaded_at, r.deleted_at, r.session_id,
        s.company_id, s.branch_id, s.ledger_date::text as ledger_date, s.line_label,
        s.origin_label, s.driver_id, null::text as shipment_status, null::text as financial_status
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.session_id = $1::uuid and r.deleted_at is null
      `, [sessionId]);
        return summarize(result.rows);
    }
    /** تنفيذ النقل في معاملة واحدة — لا أثر مالي جديد للأسطر المرحّلة */
    async confirmTransfer(scope, input) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const reason = String(input.reason ?? '').trim();
        if (!reason)
            throw new HttpError(400, 'يجب إدخال سبب النقل');
        const target = input.target;
        if (!target?.ledgerDate)
            throw new HttpError(400, 'يجب تحديد تاريخ الإرسالية الجديدة');
        const hasDriver = Boolean(target.driverId);
        const hasVehicle = Boolean(target.vehicleId);
        if (!hasDriver && !hasVehicle) {
            throw new HttpError(400, 'يجب تحديد سائق أو مركبة للإرسالية الجديدة');
        }
        const client = await pool.connect();
        try {
            await client.query('begin');
            const rows = await this.loadRows(client, scope.companyId, input.rowIds, true);
            const { errors } = this.collectIssues(rows, input.rowIds);
            if (errors.length) {
                throw new HttpError(409, errors[0]);
            }
            const branchIds = new Set(rows.map((r) => r.branch_id));
            if (branchIds.size > 1) {
                throw new HttpError(409, 'لا يمكن نقل أسطر من فروع مختلفة في عملية واحدة');
            }
            const branchId = rows[0].branch_id;
            const lineLabel = String(target.lineLabel ?? rows[0].line_label ?? '').trim() || rows[0].line_label;
            const originLabel = rows[0].origin_label ?? '';
            const sourceSessionIds = [...new Set(rows.map((r) => r.session_id))];
            const driverLabel = await this.resolveDriverLabel(client, target.driverId ?? null);
            const vehicleLabel = await this.resolveVehicleLabel(client, target.vehicleId ?? null);
            const targetSessionId = await this.findOrCreateTargetSession(client, {
                companyId: scope.companyId,
                branchId,
                ledgerDate: target.ledgerDate,
                lineLabel,
                originLabel,
                driverId: target.driverId ?? null,
                vehicleId: target.vehicleId ?? null,
                driverLabel,
                vehicleLabel,
                tripNo: target.notes ?? null,
                userId: scope.userId ?? null,
            });
            // تحقق من عدم تكرار رقم الإيصال في الجلسة الهدف (مع استثناء الأسطر المنقولة نفسها)
            const movingReceipts = rows
                .map((r) => normalizeReceipt(r.receipt_no))
                .filter((value) => value.length > 0);
            if (movingReceipts.length) {
                const dup = await client.query(`
          select r.receipt_no, r.row_no
          from daily_ledger_rows r
          where r.session_id = $1::uuid
            and r.deleted_at is null
            and r.id <> all($2::uuid[])
            and lower(trim(r.receipt_no)) = any($3::text[])
          limit 1
          `, [targetSessionId, input.rowIds, movingReceipts]);
                if (dup.rows[0]) {
                    throw new HttpError(409, `رقم الإيصال «${dup.rows[0].receipt_no}» موجود مسبقاً في الإرسالية الهدف (سطر ${dup.rows[0].row_no})`);
                }
            }
            // رقم البداية لإعادة الترقيم في الجلسة الهدف
            const maxRowNoResult = await client.query(`select max(row_no) as max_no from daily_ledger_rows where session_id = $1::uuid and deleted_at is null`, [targetSessionId]);
            let nextRowNo = (Number(maxRowNoResult.rows[0]?.max_no) || 0) + 1;
            const transferNo = `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            const oldDriverId = rows[0].driver_id ?? null;
            const transferRecord = await client.query(`
        insert into daily_ledger_row_transfers(
          company_id, transfer_no, source_session_id, target_session_id,
          old_driver_id, new_driver_id, old_vehicle_id, new_vehicle_id,
          old_ledger_date, new_ledger_date, reason, rows_count, pieces_count, weight_kg,
          status, transferred_by
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14,'completed',$15)
        returning id
        `, [
                scope.companyId,
                transferNo,
                sourceSessionIds.length === 1 ? sourceSessionIds[0] : null,
                targetSessionId,
                oldDriverId,
                target.driverId ?? null,
                null,
                target.vehicleId ?? null,
                rows[0].ledger_date,
                target.ledgerDate,
                reason,
                rows.length,
                rows.reduce((sum, r) => sum + (Number(r.parcel_count) || 0), 0),
                summarize(rows).weightKg,
                scope.userId ?? null,
            ]);
            const transferId = transferRecord.rows[0].id;
            for (const row of rows) {
                if (row.session_id === targetSessionId) {
                    // السطر بالفعل في الجلسة الهدف — لا حاجة لإعادة الترقيم
                    await client.query(`
            update daily_ledger_rows
            set last_transfer_id = $2, transfer_status = 'transferred_in', updated_at = now()
            where id = $1::uuid
            `, [row.id, transferId]);
                }
                else {
                    await client.query(`
            update daily_ledger_rows
            set
              session_id = $2::uuid,
              row_no = $3,
              original_session_id = coalesce(original_session_id, $4::uuid),
              last_transfer_id = $5::uuid,
              transfer_status = 'transferred_in',
              updated_by = $6,
              updated_at = now()
            where id = $1::uuid
            `, [row.id, targetSessionId, nextRowNo, row.session_id, transferId, scope.userId ?? null]);
                    nextRowNo += 1;
                }
                await client.query(`
          insert into daily_ledger_row_transfer_items(
            transfer_id, row_id, shipment_id, receipt_no,
            source_session_id, target_session_id, weight_kg, pieces_count, financial_posted
          )
          values($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `, [
                    transferId,
                    row.id,
                    row.posted_shipment_id,
                    row.receipt_no,
                    row.session_id,
                    targetSessionId,
                    money(row.weight_kg),
                    Number(row.parcel_count) || 0,
                    Boolean(row.posted_shipment_id),
                ]);
            }
            // تعليم "أعد الطباعة" للجلسات المتأثرة التي سبق طباعتها (المصدر + الهدف)
            const affectedSessionIds = [...new Set([...sourceSessionIds, targetSessionId])];
            await client.query(`
        update daily_ledger_sessions
        set reprint_required = true,
            reprint_reason = $2,
            updated_at = now()
        where id = any($1::uuid[])
          and printed_at is not null
          and deleted_at is null
        `, [affectedSessionIds, `تم نقل أسطر بعد الطباعة (${transferNo})`]);
            const targetSummary = await this.sessionSummary(client, targetSessionId);
            const sourceSummaries = [];
            for (const sessionId of sourceSessionIds) {
                if (sessionId === targetSessionId)
                    continue;
                sourceSummaries.push({ sessionId, summary: await this.sessionSummary(client, sessionId) });
            }
            await client.query('commit');
            return {
                transferId,
                transferNo,
                targetSessionId,
                sourceSessionIds,
                movedRowsCount: rows.length,
                targetSummary,
                sourceSummaries,
            };
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
