import type { DataScope } from '../utils/scope.js';
import { HttpError } from '../utils/errors.js';
import {
  agentDestinationHints,
  computeAgentTransitStatus,
  destinationMatchesAgentHints,
  filterRowsForAgent,
} from '../utils/agentDocumentationScope.js';
import type { DailyLedgerRowListFilters, DailyLedgerPrintDocumentInput, DailyLedgerPrintDocumentListFilters, DailyLedgerUpsertInput, DailyLedgerPrintDocumentRowSnapshot } from '../repositories/dailyLedgerRepository.js';
import { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';
import type { DailyLedgerShipmentPostingService } from './dailyLedgerShipmentPostingService.js';

export class DailyLedgerService {
  constructor(
    private repo: DailyLedgerRepository,
    private shipmentPosting?: DailyLedgerShipmentPostingService,
  ) {}

  listRows(scope: DataScope, filters: DailyLedgerRowListFilters) {
    return this.repo.listRows(scope, filters);
  }

  async upsertRow(scope: DataScope, input: DailyLedgerUpsertInput) {
    const row = await this.repo.upsertRow(scope, input);
    if (this.shipmentPosting && row.posted_shipment_id && !row.loaded_at) {
      try {
        await this.shipmentPosting.syncPostedShipmentFromLedgerRow(scope, row.id);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'تعذر تحديث الشحنة المرتبطة.';
        throw new HttpError(409, `تم حفظ سطر الدفتر، لكن ${detail}`);
      }
    }
    return row;
  }

  markPosted(
    scope: DataScope,
    input: { rowId: string; shipmentId: string; expectedUpdatedAt?: string },
    allowedBranchIds: string[],
  ) {
    return this.repo.markPosted(scope, { ...input, userId: scope.userId }, allowedBranchIds);
  }

  markLoadedByShipmentIds(input: { manifestId: string; shipmentIds: string[] }) {
    return this.repo.markLoadedByShipmentIds(input);
  }

  postPendingShipments(
    scope: DataScope,
    filters: {
      branchId: string;
      ledgerDate: string;
      lineLabel: string;
      sessionId?: string;
      rowIds?: string[];
      createdByUserId?: string;
    },
    allowedBranchIds: string[],
  ) {
    if (!this.shipmentPosting) {
      throw new Error('Daily ledger shipment posting is not configured.');
    }
    return this.shipmentPosting.postPendingShipments(scope, filters, allowedBranchIds);
  }

  deleteRows(
    scope: DataScope,
    rowIds: string[],
    allowedBranchIds: string[],
    createdByUserId?: string,
  ) {
    return this.repo.deleteRows(
      scope,
      { rowIds, userId: scope.userId, createdByUserId },
      allowedBranchIds,
    );
  }

  cancelSession(
    scope: DataScope,
    sessionId: string,
    allowedBranchIds: string[],
    createdByUserId?: string,
  ) {
    return this.repo.cancelSession(
      scope,
      { sessionId, userId: scope.userId, createdByUserId },
      allowedBranchIds,
    );
  }

  recordSessionPrint(
    scope: DataScope,
    input: {
      sessionId: string;
      printType?: string;
      printScope?: string;
      rowCount?: number;
      piecesCount?: number;
      weightKg?: number;
    },
  ) {
    return this.repo.recordSessionPrint(scope, input);
  }

  createPrintDocument(scope: DataScope, input: DailyLedgerPrintDocumentInput) {
    return this.repo.createPrintDocument(scope, input);
  }

  listPrintDocuments(scope: DataScope, filters: DailyLedgerPrintDocumentListFilters) {
    return this.repo.listPrintDocuments(scope, filters);
  }

  getPrintDocument(scope: DataScope, documentId: string) {
    return this.repo.getPrintDocument(scope, documentId);
  }

  listAgentPrintDocuments(scope: DataScope, filters: DailyLedgerPrintDocumentListFilters) {
    const hints = agentDestinationHints(scope);
    if (!scope.companyId || !hints.length) {
      return Promise.resolve([]);
    }
    return this.repo.listAgentPrintDocuments(scope, filters, hints);
  }

  async getAgentPrintDocument(scope: DataScope, documentId: string) {
    const hints = agentDestinationHints(scope);
    if (!hints.length) {
      throw new HttpError(403, 'AGENT_NOT_LINKED');
    }
    const doc = await this.repo.getPrintDocument(scope, documentId);
    if (!doc) return null;
    const raw = doc as Record<string, unknown> & DailyLedgerPrintDocumentInput;
    const destinationLabel = String(raw.destination_label ?? raw.destinationLabel ?? '');
    const searchQuery = String(raw.search_query ?? raw.searchQuery ?? '');
    const headerMatch =
      destinationMatchesAgentHints(destinationLabel, hints) ||
      destinationMatchesAgentHints(searchQuery, hints);
    const snapshot = (raw.rows_snapshot ?? raw.rowsSnapshot ?? []) as DailyLedgerPrintDocumentRowSnapshot[];
    const filteredRows = filterRowsForAgent(snapshot, hints);
    if (!headerMatch && !filteredRows.length) {
      return null;
    }
    const totals = filteredRows.reduce(
      (acc, row) => {
        acc.rowCount += 1;
        acc.piecesCount += Number(row.parcelCount ?? 0) || 0;
        acc.weightKg += Number(String(row.weightKg ?? '').replace(/[^\d.-]/g, '')) || 0;
        acc.collectTotalUsd += Number(String(row.collectAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
        acc.prepaidTotalUsd += Number(String(row.prepaidAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
        acc.hawalaTotalUsd += Number(String(row.hawalaAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
        acc.transferFeeTotalUsd += Number(String(row.transferServiceFeeUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
        return acc;
      },
      {
        rowCount: 0,
        piecesCount: 0,
        weightKg: 0,
        collectTotalUsd: 0,
        prepaidTotalUsd: 0,
        hawalaTotalUsd: 0,
        transferFeeTotalUsd: 0,
      },
    );
    const transit = computeAgentTransitStatus(
      String(raw.ledger_date ?? raw.ledgerDate ?? ''),
      String(raw.printed_at ?? raw.printedAt ?? ''),
    );
    return {
      ...doc,
      rows_snapshot: filteredRows,
      row_count: totals.rowCount,
      pieces_count: totals.piecesCount,
      weight_kg: totals.weightKg,
      collect_total_usd: totals.collectTotalUsd,
      prepaid_total_usd: totals.prepaidTotalUsd,
      hawala_total_usd: totals.hawalaTotalUsd,
      transfer_fee_total_usd: totals.transferFeeTotalUsd,
      transit_status: transit.transitStatus,
      transit_status_label: transit.transitStatusLabel,
    };
  }
}
