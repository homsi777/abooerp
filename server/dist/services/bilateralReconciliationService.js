import { HttpError } from '../utils/errors.js';
import { buildAgentMainBranchReconciliationPackage } from './accountingReportsService.js';
import { BilateralReconciliationRepository, } from '../repositories/bilateralReconciliationRepository.js';
import { buildBilateralReconciliationPrintHtmlServer } from '../utils/bilateralReconciliationPrint.js';
const DEFAULT_PERIOD_START = '2026-06-01T00:00:00.000Z';
const MATCH_TOLERANCE = 0.01;
const DELIVERED_STATUSES = new Set(['DELIVERED', 'CONFIRMED']);
function money(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}
function isCountItemType(itemType, description) {
    return itemType === 'count' || description.startsWith('عدد ');
}
function itemStatus(companyAmount, agentAmount) {
    if (agentAmount == null || Number.isNaN(agentAmount))
        return 'unmatched';
    return Math.abs(companyAmount - agentAmount) <= MATCH_TOLERANCE ? 'matched' : 'unmatched';
}
function makeEmptyAgentItem(row, index) {
    return {
        itemType: row.itemType,
        description: row.description,
        companyAmount: row.companyAmount,
        agentAmount: null,
        difference: null,
        status: 'unmatched',
        sortOrder: index,
    };
}
export function buildBilateralItemsFromPackage(pkg) {
    const mb = pkg.mainBranch ?? {};
    const shipments = Array.isArray(pkg.shipments) ? pkg.shipments : [];
    const vouchers = Array.isArray(pkg.vouchers) ? pkg.vouchers : [];
    const hawalaStandalone = (pkg.hawalaSection?.transfers ?? []).filter((t) => !t.shipment_id);
    const pendingShipments = shipments.filter((s) => {
        const status = String(s.status || '').toUpperCase();
        return !DELIVERED_STATUSES.has(status) && status !== 'CANCELLED';
    }).length;
    const discountsTotal = money(shipments.reduce((sum, s) => sum + Number(s.discount_amount ?? 0), 0));
    const agentExpensePayments = money(vouchers
        .filter((v) => v.voucher_kind === 'payment' && String(v.status || '').toLowerCase() === 'confirmed')
        .filter((v) => /مصروف|مصاريف|expense/i.test(String(v.notes ?? '')))
        .reduce((sum, v) => sum + Number(v.original_amount ?? 0), 0));
    const rows = [
        { itemType: 'count', description: 'عدد الشحنات', companyAmount: shipments.length },
        {
            itemType: 'shipment',
            description: 'تحصيل شحن (COD مع الوكيل)',
            companyAmount: money(mb.collectionCollectedByAgent),
        },
        {
            itemType: 'prepaid',
            description: 'مسبق محصّل في الفرع الرئيسي',
            companyAmount: money(mb.prepaidRetainedAtMainBranch),
        },
        {
            itemType: 'hawala',
            description: 'مطلوب حوالات (أصل + أجور)',
            companyAmount: money(mb.hawalaRemittanceTotal),
        },
        { itemType: 'count', description: 'عدد حوالات مستقلة', companyAmount: hawalaStandalone.length },
        {
            itemType: 'commission',
            description: 'عمولة شحن مستحقة للوكيل',
            companyAmount: money(mb.totalShippingCommissionDueToAgent),
        },
        {
            itemType: 'expense',
            description: 'مصاريف دفعها الوكيل نيابة عن الشركة',
            companyAmount: agentExpensePayments,
        },
        {
            itemType: 'discount',
            description: 'خصومات ممنوحة للعملاء من الوكيل',
            companyAmount: discountsTotal,
        },
        {
            itemType: 'penalty',
            description: 'غرامات تأخير',
            companyAmount: 0,
        },
        {
            itemType: 'count',
            description: 'عدد شحنات معلقة (لم تُسلَّم بعد)',
            companyAmount: pendingShipments,
        },
        {
            itemType: 'payment',
            description: 'سندات قبض من الوكيل (توريد)',
            companyAmount: money(mb.confirmedReceiptsFromAgent),
        },
        {
            itemType: 'payment',
            description: 'سندات دفع للوكيل (عمولة)',
            companyAmount: money(mb.confirmedPaymentsToAgent),
        },
        {
            itemType: 'balance',
            description: 'ذمة نهاية الفترة (صافي حركات الفترة)',
            companyAmount: money(mb.reconciliationGap ?? mb.agentBalanceDue),
        },
    ];
    return rows.map((row, index) => makeEmptyAgentItem(row, index));
}
function mapStoredItem(row, index) {
    const companyAmount = money(row.company_amount);
    const agentRaw = row.agent_amount;
    const agentAmount = agentRaw == null ? null : money(agentRaw);
    return {
        itemType: String(row.item_type ?? ''),
        description: String(row.description ?? ''),
        companyAmount,
        agentAmount,
        difference: row.difference == null ? null : money(row.difference),
        status: String(row.status ?? 'unmatched'),
        notes: row.notes ? String(row.notes) : null,
        sortOrder: Number(row.sort_order ?? index),
    };
}
export class BilateralReconciliationService {
    agentRepository;
    repository = new BilateralReconciliationRepository();
    constructor(agentRepository) {
        this.agentRepository = agentRepository;
    }
    resolvePeriodFrom(lastApproved, legacyLast, explicitFrom) {
        return explicitFrom ?? lastApproved?.period_to ?? legacyLast?.reconciled_at ?? DEFAULT_PERIOD_START;
    }
    periodStartLabel(lastApproved) {
        if (!lastApproved?.period_to)
            return 'أول مطابقة للوكيل';
        return 'تبدأ من اليوم التالي لآخر مطابقة معتمدة';
    }
    async getPreview(companyId, agentId, options) {
        const currencyCode = options?.currencyCode || 'USD';
        const lastApproved = await this.repository.getLastApproved(companyId, agentId, currencyCode);
        const legacyLast = await this.agentRepository.getLastAgentReconciliationRecord(companyId, agentId);
        const resolvedPeriodFrom = this.resolvePeriodFrom(lastApproved, legacyLast, options?.fromAt);
        const periodTo = options?.toAt ?? new Date().toISOString();
        const raw = await this.agentRepository.getAgentFinancialStatement(companyId, agentId, {
            currencyCode,
            fromAt: resolvedPeriodFrom,
            toAt: periodTo,
        });
        if (!raw)
            return null;
        const pkg = buildAgentMainBranchReconciliationPackage(raw);
        const previousBalance = money(lastApproved?.current_balance ?? 0);
        const items = buildBilateralItemsFromPackage(pkg);
        const balanceItem = items.find((item) => item.itemType === 'balance');
        const periodMovement = money(balanceItem?.companyAmount ?? pkg.mainBranch?.reconciliationGap ?? 0);
        const currentBalance = money(previousBalance + periodMovement);
        return {
            agent: pkg.agent,
            periodFrom: resolvedPeriodFrom,
            periodTo,
            currencyCode,
            previousBalance,
            periodMovement,
            currentBalance,
            periodStartLabel: this.periodStartLabel(lastApproved),
            lastApproved,
            legacyLastReconciliation: legacyLast,
            items,
            summary: {
                shipmentsCount: (pkg.shipments ?? []).length,
                unmatchedItems: items.length,
                allMatched: false,
                companyBalance: currentBalance,
            },
            companyPackage: pkg,
            generatedAt: new Date().toISOString(),
            readOnly: false,
        };
    }
    async list(companyId, agentId) {
        return this.repository.listByAgent(companyId, agentId);
    }
    async getById(companyId, id) {
        const row = await this.repository.getById(companyId, id);
        if (!row)
            return null;
        const lastApproved = row.status === 'approved'
            ? null
            : await this.repository.getLastApproved(companyId, row.agent_id, row.currency_code);
        let companyPackage = null;
        try {
            const raw = await this.agentRepository.getAgentFinancialStatement(companyId, row.agent_id, {
                currencyCode: row.currency_code || 'USD',
                fromAt: row.period_from,
                toAt: row.period_to,
            });
            if (raw) {
                companyPackage = buildAgentMainBranchReconciliationPackage(raw);
            }
        }
        catch {
            companyPackage = null;
        }
        return {
            ...row,
            periodStartLabel: this.periodStartLabel(lastApproved),
            items: (row.items ?? []).map((item, index) => mapStoredItem(item, index)),
            readOnly: row.status === 'approved',
            companyPackage,
        };
    }
    async getDiscrepancyReport(companyId, agentId, currencyCode = 'USD') {
        return this.repository.listDiscrepancies(companyId, agentId, currencyCode);
    }
    async getBalanceHistoryReport(companyId, agentId, currencyCode = 'USD') {
        return this.repository.listApprovedHistory(companyId, agentId, currencyCode);
    }
    normalizeItems(items) {
        return items.map((item, index) => {
            const companyAmount = money(item.companyAmount);
            const agentAmount = item.agentAmount == null ? null : money(item.agentAmount);
            const difference = agentAmount == null ? null : money(agentAmount - companyAmount);
            return {
                itemType: item.itemType,
                description: item.description,
                companyAmount,
                agentAmount,
                difference,
                status: itemStatus(companyAmount, agentAmount),
                notes: item.notes ?? null,
                sortOrder: item.sortOrder ?? index,
            };
        });
    }
    assertCanApprove(items, forceApprove, forceNote) {
        const blocking = items.filter((item) => item.itemType !== 'balance' && (item.agentAmount == null || item.status === 'unmatched'));
        if (blocking.length > 0 && !forceApprove) {
            throw new HttpError(400, `لا يمكن الاعتماد: يوجد ${blocking.length} بند غير متطابق أو لم يُدخل رقم الوكيل بعده. راجع البنود أو استخدم الاعتماد القسري مع ملاحظة.`);
        }
        if (forceApprove && !forceNote?.trim()) {
            throw new HttpError(400, 'ملاحظة الاعتماد القسري مطلوبة عند وجود فروقات.');
        }
    }
    buildPayload(input) {
        const items = this.normalizeItems(input.items);
        const balanceItem = items.find((item) => item.itemType === 'balance');
        const previousBalance = money(input.previousBalance ?? 0);
        const periodMovement = money(input.periodMovement ?? (balanceItem ? balanceItem.companyAmount : 0));
        const agreedPeriodNet = balanceItem?.agentAmount != null
            ? money(balanceItem.agentAmount)
            : periodMovement;
        const currentBalance = money(input.currentBalance ?? previousBalance + agreedPeriodNet);
        if (balanceItem) {
            balanceItem.agentAmount = balanceItem.agentAmount ?? agreedPeriodNet;
            balanceItem.difference = money((balanceItem.agentAmount ?? 0) - balanceItem.companyAmount);
            balanceItem.status = itemStatus(balanceItem.companyAmount, balanceItem.agentAmount);
        }
        return {
            agentId: input.agentId,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            currencyCode: input.currencyCode || 'USD',
            status: input.status,
            previousBalance,
            periodMovement,
            currentBalance,
            notes: input.notes ?? null,
            agentNotes: input.agentNotes ?? null,
            forceApproveNote: input.forceApprove ? input.forceNote?.trim() || null : null,
            disputeNote: input.disputeNote ?? null,
            items,
            createdByUserId: input.createdByUserId ?? null,
            approvedByUserId: input.approvedByUserId ?? null,
            approvedAt: input.approvedAt ?? null,
        };
    }
    async saveDraft(companyId, input) {
        const payload = this.buildPayload({ ...input, status: 'draft' });
        if (input.id) {
            const existing = await this.repository.getById(companyId, input.id);
            if (!existing)
                throw new HttpError(404, 'المطابقة غير موجودة.');
            if (existing.status === 'approved') {
                throw new HttpError(400, 'لا يمكن تعديل مطابقة معتمدة.');
            }
            const updated = await this.repository.update(companyId, input.id, payload);
            if (!updated)
                throw new HttpError(404, 'المطابقة غير موجودة.');
            return updated;
        }
        return this.repository.create(companyId, payload);
    }
    async sendToAgent(companyId, id, agentNotes) {
        const existing = await this.repository.getById(companyId, id);
        if (!existing)
            throw new HttpError(404, 'المطابقة غير موجودة.');
        if (existing.status === 'approved') {
            throw new HttpError(400, 'المطابقة معتمدة بالفعل.');
        }
        return this.repository.updateStatus(companyId, id, 'pending', { agentNotes });
    }
    async markDisputed(companyId, id, disputeNote) {
        if (!disputeNote?.trim())
            throw new HttpError(400, 'ملاحظة الاعتراض مطلوبة.');
        const existing = await this.repository.getById(companyId, id);
        if (!existing)
            throw new HttpError(404, 'المطابقة غير موجودة.');
        if (existing.status === 'approved') {
            throw new HttpError(400, 'لا يمكن الاعتراض على مطابقة معتمدة.');
        }
        return this.repository.updateStatus(companyId, id, 'disputed', { disputeNote: disputeNote.trim() });
    }
    async approve(companyId, input) {
        const items = this.normalizeItems(input.items);
        this.assertCanApprove(items, input.forceApprove, input.forceNote);
        const approvedAt = input.periodTo;
        const payload = this.buildPayload({
            ...input,
            status: 'approved',
            approvedAt,
            forceApprove: input.forceApprove,
            forceNote: input.forceNote,
        });
        const saved = input.id
            ? await this.repository.update(companyId, input.id, payload)
            : await this.repository.create(companyId, payload);
        if (!saved)
            throw new HttpError(404, 'المطابقة غير موجودة.');
        await this.agentRepository.createAgentReconciliation(companyId, input.agentId, {
            balanceAmount: payload.currentBalance,
            currencyCode: input.currencyCode || 'USD',
            notes: input.forceApprove
                ? `مطابقة ثنائية معتمدة (قسراً): ${input.forceNote?.trim()}`
                : input.notes?.trim() || 'مطابقة ثنائية معتمدة',
            createdByUserId: input.approvedByUserId ?? input.createdByUserId ?? null,
            reconciledAt: input.periodTo,
            bilateralReconciliationId: saved.id,
        });
        const htmlContent = buildBilateralReconciliationPrintHtmlServer({
            agent: { name: saved.agent_name, code: saved.agent_code },
            periodFrom: saved.period_from,
            periodTo: saved.period_to,
            currencyCode: saved.currency_code,
            previousBalance: saved.previous_balance,
            periodMovement: saved.period_movement,
            currentBalance: saved.current_balance,
            status: saved.status,
            notes: saved.notes,
            agentNotes: saved.agent_notes,
            forceApproveNote: saved.force_approve_note,
            items: saved.items,
        });
        await this.repository.saveGeneratedDocument({
            companyId,
            documentType: 'bilateral_reconciliation',
            reconciliationId: saved.id,
            htmlContent,
            createdByUserId: input.approvedByUserId ?? input.createdByUserId ?? null,
            metadata: { forceApprove: Boolean(input.forceApprove) },
        });
        return { ...saved, archivedDocumentHtml: htmlContent };
    }
}
