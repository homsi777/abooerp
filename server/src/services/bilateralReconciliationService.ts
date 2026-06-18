import { HttpError } from '../utils/errors.js';
import { buildAgentMainBranchReconciliationPackage } from './accountingReportsService.js';
import type { AgentRepository } from '../repositories/agentRepository.js';
import {
  BilateralReconciliationRepository,
  type BilateralItemStatus,
  type BilateralReconciliationItemInput,
  type SaveBilateralReconciliationInput,
} from '../repositories/bilateralReconciliationRepository.js';

const DEFAULT_PERIOD_START = '2026-06-01T00:00:00.000Z';
const MATCH_TOLERANCE = 0.01;

function money(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function itemStatus(companyAmount: number, agentAmount: number): BilateralItemStatus {
  return Math.abs(companyAmount - agentAmount) <= MATCH_TOLERANCE ? 'matched' : 'unmatched';
}

export function buildBilateralItemsFromPackage(pkg: Record<string, any>): BilateralReconciliationItemInput[] {
  const mb = pkg.mainBranch ?? {};
  const shipments = Array.isArray(pkg.shipments) ? pkg.shipments : [];
  const hawalaStandalone = (pkg.hawalaSection?.transfers ?? []).filter((t: any) => !t.shipment_id);

  const rows: Array<{ itemType: string; description: string; companyAmount: number }> = [
    { itemType: 'shipment', description: 'عدد الشحنات', companyAmount: shipments.length },
    {
      itemType: 'shipment',
      description: 'تحصيل شحن (COD مع الوكيل)',
      companyAmount: money(mb.collectionCollectedByAgent),
    },
    {
      itemType: 'hawala',
      description: 'مطلوب حوالات (أصل + أجور)',
      companyAmount: money(mb.hawalaRemittanceTotal),
    },
    {
      itemType: 'hawala',
      description: 'عدد حوالات مستقلة',
      companyAmount: hawalaStandalone.length,
    },
    {
      itemType: 'commission',
      description: 'عمولة شحن مستحقة للوكيل',
      companyAmount: money(mb.totalShippingCommissionDueToAgent),
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
      description: 'ذمة الوكيل / فارق المطابقة',
      companyAmount: money(mb.reconciliationGap ?? mb.agentBalanceDue),
    },
  ];

  return rows.map((row, index) => ({
    itemType: row.itemType,
    description: row.description,
    companyAmount: row.companyAmount,
    agentAmount: row.companyAmount,
    difference: 0,
    status: 'matched' as BilateralItemStatus,
    sortOrder: index,
  }));
}

export class BilateralReconciliationService {
  private readonly repository = new BilateralReconciliationRepository();

  constructor(private readonly agentRepository: AgentRepository) {}

  async getPreview(
    companyId: string,
    agentId: string,
    options?: { fromAt?: string; toAt?: string; currencyCode?: string },
  ) {
    const currencyCode = options?.currencyCode || 'USD';
    const lastApproved = await this.repository.getLastApproved(companyId, agentId, currencyCode);
    const legacyLast = await this.agentRepository.getLastAgentReconciliationRecord(companyId, agentId);

    const resolvedPeriodFrom =
      options?.fromAt
      ?? lastApproved?.period_to
      ?? legacyLast?.reconciled_at
      ?? DEFAULT_PERIOD_START;
    const periodTo = options?.toAt ?? new Date().toISOString();

    const raw = await this.agentRepository.getAgentFinancialStatement(companyId, agentId, {
      currencyCode,
      fromAt: resolvedPeriodFrom,
      toAt: periodTo,
    });
    if (!raw) return null;

    const pkg = buildAgentMainBranchReconciliationPackage(raw) as Record<string, any>;
    const previousBalance = money(
      lastApproved?.current_balance ?? legacyLast?.balance_amount ?? 0,
    );
    const items = buildBilateralItemsFromPackage(pkg);
    const balanceItem = items.find((item) => item.itemType === 'balance');
    const currentBalance = money(balanceItem?.companyAmount ?? pkg.mainBranch?.reconciliationGap ?? 0);

    const unmatchedCount = items.filter((item) => item.status !== 'matched').length;

    return {
      agent: pkg.agent,
      periodFrom: resolvedPeriodFrom,
      periodTo,
      currencyCode,
      previousBalance,
      currentBalance,
      lastApproved,
      legacyLastReconciliation: legacyLast,
      items,
      summary: {
        shipmentsCount: (pkg.shipments ?? []).length,
        unmatchedItems: unmatchedCount,
        allMatched: unmatchedCount === 0,
        companyBalance: currentBalance,
      },
      companyPackage: pkg,
      generatedAt: new Date().toISOString(),
    };
  }

  async list(companyId: string, agentId: string) {
    return this.repository.listByAgent(companyId, agentId);
  }

  async getById(companyId: string, id: string) {
    return this.repository.getById(companyId, id);
  }

  private normalizeItems(
    items: Array<{
      itemType: string;
      description: string;
      companyAmount: number;
      agentAmount: number;
      notes?: string | null;
      sortOrder?: number;
    }>,
  ): BilateralReconciliationItemInput[] {
    return items.map((item, index) => {
      const companyAmount = money(item.companyAmount);
      const agentAmount = money(item.agentAmount);
      return {
        itemType: item.itemType,
        description: item.description,
        companyAmount,
        agentAmount,
        difference: money(agentAmount - companyAmount),
        status: itemStatus(companyAmount, agentAmount),
        notes: item.notes ?? null,
        sortOrder: item.sortOrder ?? index,
      };
    });
  }

  async saveDraft(
    companyId: string,
    input: {
      id?: string;
      agentId: string;
      periodFrom: string;
      periodTo: string;
      currencyCode?: string;
      previousBalance?: number;
      currentBalance?: number;
      notes?: string;
      agentNotes?: string;
      items: Array<{
        itemType: string;
        description: string;
        companyAmount: number;
        agentAmount: number;
        notes?: string | null;
        sortOrder?: number;
      }>;
      createdByUserId?: string | null;
    },
  ) {
    const items = this.normalizeItems(input.items);
    const balanceItem = items.find((item) => item.itemType === 'balance');
    const payload: SaveBilateralReconciliationInput = {
      agentId: input.agentId,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      currencyCode: input.currencyCode || 'USD',
      status: 'draft',
      previousBalance: money(input.previousBalance ?? 0),
      currentBalance: money(input.currentBalance ?? balanceItem?.agentAmount ?? balanceItem?.companyAmount ?? 0),
      notes: input.notes ?? null,
      agentNotes: input.agentNotes ?? null,
      items,
      createdByUserId: input.createdByUserId ?? null,
    };

    if (input.id) {
      const updated = await this.repository.update(companyId, input.id, payload);
      if (!updated) throw new HttpError(404, 'المطابقة غير موجودة.');
      return updated;
    }
    return this.repository.create(companyId, payload);
  }

  async approve(
    companyId: string,
    input: {
      id?: string;
      agentId: string;
      periodFrom: string;
      periodTo: string;
      currencyCode?: string;
      previousBalance?: number;
      currentBalance?: number;
      notes?: string;
      agentNotes?: string;
      items: Array<{
        itemType: string;
        description: string;
        companyAmount: number;
        agentAmount: number;
        notes?: string | null;
        sortOrder?: number;
      }>;
      approvedByUserId?: string | null;
      createdByUserId?: string | null;
    },
  ) {
    const items = this.normalizeItems(input.items);
    const balanceItem = items.find((item) => item.itemType === 'balance');
    const currentBalance = money(
      input.currentBalance ?? balanceItem?.agentAmount ?? balanceItem?.companyAmount ?? 0,
    );
    const approvedAt = new Date().toISOString();
    const payload: SaveBilateralReconciliationInput = {
      agentId: input.agentId,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      currencyCode: input.currencyCode || 'USD',
      status: 'approved',
      previousBalance: money(input.previousBalance ?? 0),
      currentBalance,
      notes: input.notes ?? null,
      agentNotes: input.agentNotes ?? null,
      items,
      approvedAt,
      approvedByUserId: input.approvedByUserId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    };

    const saved = input.id
      ? await this.repository.update(companyId, input.id, payload)
      : await this.repository.create(companyId, payload);
    if (!saved) throw new HttpError(404, 'المطابقة غير موجودة.');

    await this.agentRepository.createAgentReconciliation(companyId, input.agentId, {
      balanceAmount: currentBalance,
      currencyCode: input.currencyCode || 'USD',
      notes: input.notes?.trim() || 'مطابقة ثنائية معتمدة',
      createdByUserId: input.approvedByUserId ?? input.createdByUserId ?? null,
    });

    return saved;
  }
}
