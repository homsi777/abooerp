import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import { resolveAgentDestinationLabel } from '../utils/agentDestination.js';
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}
function amountsFromLedgerRow(row) {
    let collect = money(row.collect_amount_usd);
    let prepaid = money(row.prepaid_amount_usd);
    if (collect > 0 && prepaid > 0)
        prepaid = 0;
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
async function ensureSenderReceiver(client, name, type) {
    const normalized = normalizeName(name);
    const existing = await client.query(`
    select id
    from senders_receivers
    where lower(trim(full_name)) = lower($1)
    order by created_at desc
    limit 1
    `, [normalized]);
    if (existing.rows[0]?.id)
        return existing.rows[0].id;
    const created = await client.query(`
    insert into senders_receivers(code, full_name, phone, type, status)
    values ($1, $2, '', $3, 'active')
    returning id
    `, [`SR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, normalized, type]);
    return created.rows[0].id;
}
async function ensureGoodsType(client, name) {
    const normalized = normalizeName(name);
    const existing = await client.query(`
    select id
    from goods_types
    where lower(trim(name)) = lower($1)
    order by created_at desc
    limit 1
    `, [normalized]);
    if (existing.rows[0]?.id)
        return existing.rows[0].id;
    const created = await client.query(`
    insert into goods_types(code, name, description, is_active)
    values ($1, $2, '', true)
    returning id
    `, [`GT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, normalized]);
    return created.rows[0].id;
}
function isRowPostable(row) {
    return Boolean(normalizeName(row.receipt_no) &&
        normalizeName(row.destination) &&
        normalizeName(row.sender_name) &&
        normalizeName(row.receiver_name) &&
        !row.posted_shipment_id);
}
async function resolveAccountCustomerByName(companyId, partyName) {
    const normalized = normalizeName(partyName);
    if (!normalized)
        return null;
    const result = await pool.query(`
    select id, name
    from customers
    where status = 'active'
      and is_account_customer = true
      and (company_id = $1::uuid or company_id is null)
      and lower(trim(name)) = lower($2)
    order by created_at desc
    `, [companyId, normalized]);
    if (result.rows.length === 1) {
        return result.rows[0];
    }
    if (result.rows.length > 1) {
        throw new HttpError(400, `يوجد أكثر من عميل حسابي باسم «${normalized}». يرجى تمييزهم برقم هاتف مختلف في بطاقة العميل.`);
    }
    return null;
}
export class DailyLedgerShipmentPostingService {
    ledgerRepo;
    shipmentService;
    agentRepository;
    financialPosting;
    constructor(ledgerRepo, shipmentService, agentRepository, financialPosting) {
        this.ledgerRepo = ledgerRepo;
        this.shipmentService = shipmentService;
        this.agentRepository = agentRepository;
        this.financialPosting = financialPosting;
    }
    async loadRow(scope, rowId) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const result = await pool.query(`
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
      `, [rowId, scope.companyId]);
        return result.rows[0] ?? null;
    }
    async countActiveSessionsForLedger(scope, filters) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const result = await pool.query(`
      select count(distinct s.id)::text as count
      from daily_ledger_sessions s
      where s.company_id = $1::uuid
        and s.branch_id = $2::uuid
        and s.ledger_date = $3::date
        and s.line_label = $4
        and s.deleted_at is null
        and exists (
          select 1
          from daily_ledger_rows r
          where r.session_id = s.id
            and r.deleted_at is null
        )
      `, [scope.companyId, filters.branchId, filters.ledgerDate, filters.lineLabel]);
        return Number(result.rows[0]?.count ?? 0);
    }
    async assertOperationalSessionScope(scope, filters) {
        if (filters.sessionId) {
            const sessionOk = await pool.query(`
        select s.id, s.branch_id, s.ledger_date::text as ledger_date, s.line_label
        from daily_ledger_sessions s
        where s.id = $1::uuid
          and s.company_id = $2::uuid
          and s.deleted_at is null
        limit 1
        `, [filters.sessionId, scope.companyId]);
            const session = sessionOk.rows[0];
            if (!session) {
                throw new HttpError(400, 'الإرسالية المحددة غير موجودة.');
            }
            if (filters.rowIds?.length) {
                const rowSessions = await pool.query(`
          select r.session_id, count(*)::text as count
          from daily_ledger_rows r
          join daily_ledger_sessions s on s.id = r.session_id
          where r.id = any($1::uuid[])
            and r.deleted_at is null
            and s.deleted_at is null
            and s.company_id = $2::uuid
          group by r.session_id
          `, [filters.rowIds, scope.companyId]);
                if (rowSessions.rows.some((entry) => entry.session_id !== filters.sessionId)) {
                    throw new HttpError(400, 'DAILY_LEDGER_SESSION_REQUIRED: بعض الأسطر المطلوب ترحيلها لا تنتمي للإرسالية المحددة.');
                }
            }
            return {
                sessionId: session.id,
                branchId: session.branch_id,
                ledgerDate: session.ledger_date,
                lineLabel: session.line_label,
            };
        }
        const sessionCount = await this.countActiveSessionsForLedger(scope, filters);
        if (sessionCount > 1) {
            throw new HttpError(400, 'DAILY_LEDGER_SESSION_REQUIRED');
        }
        return {
            sessionId: undefined,
            branchId: filters.branchId,
            ledgerDate: filters.ledgerDate,
            lineLabel: filters.lineLabel,
        };
    }
    async loadPendingRows(scope, filters) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const values = [scope.companyId];
        let scopeFilter = '';
        if (filters.sessionId) {
            values.push(filters.sessionId);
            scopeFilter = ` and s.id = $${values.length}::uuid`;
        }
        else {
            values.push(filters.branchId, filters.ledgerDate, filters.lineLabel);
            scopeFilter = `
        and s.branch_id = $2
        and s.ledger_date = $3::date
        and s.line_label = $4
      `;
        }
        let rowFilter = '';
        if (filters.rowIds?.length) {
            values.push(filters.rowIds);
            rowFilter += ` and r.id = any($${values.length}::uuid[])`;
        }
        if (filters.createdByUserId) {
            values.push(filters.createdByUserId);
            rowFilter += ` and r.created_by = $${values.length}::uuid`;
        }
        const result = await pool.query(`
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
        and r.deleted_at is null
        and s.deleted_at is null
        and r.posted_shipment_id is null
        ${scopeFilter}
        ${rowFilter}
      order by r.row_no asc
      `, values);
        return result.rows;
    }
    /** يحدّث الشحنة المرتبطة بسطر الدفter — لا ينشئ شحنة جديدة. */
    async syncPostedShipmentFromLedgerRow(scope, rowId) {
        const row = await this.loadRow(scope, rowId);
        if (!row)
            throw new HttpError(404, 'سطر الدفتر غير موجود.');
        if (!row.posted_shipment_id) {
            throw new HttpError(400, 'السطر غير مربوط بشحنة.');
        }
        if (row.loaded_at) {
            throw new HttpError(409, 'لا يمكن تعديل شحنة سطر مُحمّل على بيان.');
        }
        const client = await pool.connect();
        let senderId;
        let receiverId;
        try {
            await client.query('begin');
            senderId = await ensureSenderReceiver(client, row.sender_name ?? '', 'sender');
            receiverId = await ensureSenderReceiver(client, row.receiver_name ?? '', 'receiver');
            const parcelType = normalizeName(row.parcel_type);
            if (parcelType) {
                await ensureGoodsType(client, parcelType);
            }
            await client.query('commit');
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
        const agent = await this.agentRepository.resolveAgentForDestination(scope.companyId, normalizeName(row.destination));
        const agentId = agent.id;
        const destinationCity = resolveAgentDestinationLabel(agent) || normalizeName(row.destination);
        const amounts = amountsFromLedgerRow(row);
        const accountCustomer = (await resolveAccountCustomerByName(row.company_id, row.sender_name ?? '')) ??
            (await resolveAccountCustomerByName(row.company_id, row.receiver_name ?? ''));
        const notes = [
            row.notes,
            row.trip_no ? `رقم الرحلة: ${row.trip_no}` : '',
            row.vehicle_label ? `المركبة: ${row.vehicle_label}` : '',
            row.driver_label ? `السائق: ${row.driver_label}` : '',
        ]
            .filter(Boolean)
            .join(' | ');
        const newReceiptNo = normalizeName(row.receipt_no);
        const existingShipmentRow = await pool.query(`select shipment_no from shipments where id = $1::uuid and deleted_at is null limit 1`, [row.posted_shipment_id]);
        const currentShipmentNo = normalizeName(existingShipmentRow.rows[0]?.shipment_no);
        let shipmentNoUpdate;
        let referenceNoUpdate;
        if (newReceiptNo && newReceiptNo !== currentShipmentNo) {
            const taken = await pool.query(`
        select id
        from shipments
        where company_id = $1::uuid
          and deleted_at is null
          and lower(trim(shipment_no)) = lower($2)
          and id <> $3::uuid
        limit 1
        `, [row.company_id, newReceiptNo, row.posted_shipment_id]);
            if (taken.rows[0]) {
                throw new HttpError(409, `رقم الإيصال ${newReceiptNo} مستخدم في شحنة أخرى — اختر رقماً مختلفاً.`);
            }
            shipmentNoUpdate = newReceiptNo;
            referenceNoUpdate = newReceiptNo;
        }
        const updated = await this.shipmentService.update(row.posted_shipment_id, {
            ...(shipmentNoUpdate
                ? { shipmentNo: shipmentNoUpdate, referenceNo: referenceNoUpdate }
                : {}),
            senderId,
            receiverId,
            agentId,
            customerId: accountCustomer?.id,
            originCity: normalizeName(row.origin_label) || normalizeName(row.line_label),
            destinationCity,
            description: notes || normalizeName(row.parcel_type),
            piecesCount: Number(row.parcel_count) || 1,
            weightKg: row.weight_kg == null ? undefined : Number(row.weight_kg),
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
        }, { ...scope, branchId: row.branch_id, companyId: row.company_id });
        if (!updated) {
            throw new HttpError(404, 'الشحنة المرتبطة بهذا السطر غير موجودة.');
        }
        return {
            shipmentId: row.posted_shipment_id,
            shipmentNo: String(updated.shipment_no ?? row.receipt_no ?? ''),
            agentId,
        };
    }
    async postRowAsShipment(scope, rowId, allowedBranchIds) {
        const row = await this.loadRow(scope, rowId);
        if (!row)
            throw new HttpError(404, 'سطر الدفتر غير موجود.');
        if (row.posted_shipment_id) {
            const synced = await this.syncPostedShipmentFromLedgerRow(scope, row.id);
            return {
                rowId: row.id,
                shipmentId: synced.shipmentId,
                shipmentNo: synced.shipmentNo,
                agentId: synced.agentId,
            };
        }
        if (!isRowPostable(row)) {
            throw new HttpError(400, `السطر ${row.row_no} غير مكتمل للترحيل (يلزم: إيصال + جهة + مرسل + مستلم).`);
        }
        const client = await pool.connect();
        let senderId;
        let receiverId;
        try {
            await client.query('begin');
            senderId = await ensureSenderReceiver(client, row.sender_name ?? '', 'sender');
            receiverId = await ensureSenderReceiver(client, row.receiver_name ?? '', 'receiver');
            const parcelType = normalizeName(row.parcel_type);
            if (parcelType) {
                await ensureGoodsType(client, parcelType);
            }
            await client.query('commit');
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
        const agent = await this.agentRepository.resolveAgentForDestination(scope.companyId, normalizeName(row.destination));
        const agentId = agent.id;
        const destinationCity = resolveAgentDestinationLabel(agent) || normalizeName(row.destination);
        const amounts = amountsFromLedgerRow(row);
        const accountCustomer = (await resolveAccountCustomerByName(row.company_id, row.sender_name ?? '')) ??
            (await resolveAccountCustomerByName(row.company_id, row.receiver_name ?? ''));
        const notes = [
            row.notes,
            row.trip_no ? `رقم الرحلة: ${row.trip_no}` : '',
            row.vehicle_label ? `المركبة: ${row.vehicle_label}` : '',
            row.driver_label ? `السائق: ${row.driver_label}` : '',
        ]
            .filter(Boolean)
            .join(' | ');
        const financial = accountCustomer
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
        const existingShipment = await pool.query(`
      select id, shipment_no
      from shipments
      where company_id = $1::uuid
        and deleted_at is null
        and lower(trim(shipment_no)) = lower($2)
      limit 1
      `, [row.company_id, receiptNo]);
        if (existingShipment.rows[0]) {
            const shipmentId = existingShipment.rows[0].id;
            const linked = await pool.query(`
        select id, row_no
        from daily_ledger_rows
        where deleted_at is null
          and posted_shipment_id = $1::uuid
        `, [shipmentId]);
            const otherLink = linked.rows.find((entry) => entry.id !== row.id);
            if (otherLink) {
                throw new HttpError(409, `رقم الإيصال ${receiptNo} مستخدم في سطر ${otherLink.row_no}. غيّر رقم الإيصال في هذا السطر ثم أعد الحفظ.`);
            }
            // If existing shipment has no financial posting, trigger it now
            const shipmentFull = await pool.query(`select financial_status from shipments where id = $1`, [shipmentId]);
            const fs = shipmentFull.rows[0]?.financial_status;
            if (this.financialPosting && (!fs || fs === 'UNPOSTED')) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    await this.financialPosting.postShipmentConfirmationFinancials({
                        client,
                        shipmentId,
                        scope: { ...scope, branchId: row.branch_id, companyId: row.company_id },
                        financial,
                        effectiveDate: row.ledger_date,
                    });
                    // Also set effective_date on the existing shipment
                    await client.query(`UPDATE shipments SET effective_date = coalesce($2::date, effective_date) WHERE id = $1`, [shipmentId, row.ledger_date ?? null]);
                    await client.query('COMMIT');
                }
                catch (e) {
                    await client.query('ROLLBACK');
                    throw e;
                }
                finally {
                    client.release();
                }
            }
            const posted = await this.ledgerRepo.markPosted(scope, { rowId: row.id, shipmentId, userId: scope.userId }, allowedBranchIds);
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
        const created = await this.shipmentService.create({
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
            effectiveDate: row.ledger_date,
        }, { ...scope, branchId: row.branch_id, companyId: row.company_id }, { financial, actorUserId: scope.userId, effectiveDate: row.ledger_date });
        const posted = await this.ledgerRepo.markPosted(scope, { rowId: row.id, shipmentId: created.id, userId: scope.userId }, allowedBranchIds);
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
    async postPendingShipments(scope, filters, allowedBranchIds) {
        const resolvedScope = await this.assertOperationalSessionScope(scope, filters);
        const rows = await this.loadPendingRows(scope, {
            ...filters,
            branchId: resolvedScope.branchId,
            ledgerDate: resolvedScope.ledgerDate,
            lineLabel: resolvedScope.lineLabel,
            sessionId: resolvedScope.sessionId ?? filters.sessionId,
        });
        const postable = rows.filter(isRowPostable);
        const skipped = rows
            .filter((row) => !isRowPostable(row))
            .map((row) => ({ rowId: row.id, rowNo: row.row_no, reason: 'ناقص: إيصال أو جهة أو مرسل أو مستلم' }));
        const posted = [];
        const errors = [];
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
            }
            catch (error) {
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
