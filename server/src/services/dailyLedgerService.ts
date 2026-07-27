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
import type {
  DailyLedgerDispatchCreateInput,
  DailyLedgerDispatchListFilters,
  DailyLedgerDispatchUpdateInput,
} from '../repositories/dailyLedgerDispatchRepository.js';
import { DailyLedgerDispatchRepository } from '../repositories/dailyLedgerDispatchRepository.js';
import type {
  DispatchSaveLogInput,
  DispatchSaveLogListFilters,
} from '../repositories/dailyLedgerDispatchSaveRepository.js';
import { DailyLedgerDispatchSaveRepository } from '../repositories/dailyLedgerDispatchSaveRepository.js';
import type { BeginDispatchOperationInput } from '../repositories/dailyLedgerDispatchOperationRepository.js';
import { DailyLedgerDispatchOperationRepository } from '../repositories/dailyLedgerDispatchOperationRepository.js';
import type { DailyLedgerShipmentPostingService } from './dailyLedgerShipmentPostingService.js';
import { DailyLedgerDispatchUndoService } from './dailyLedgerDispatchUndoService.js';

export class DailyLedgerService {
  private dispatchUndo = new DailyLedgerDispatchUndoService();

  constructor(
    private repo: DailyLedgerRepository,
    private shipmentPosting?: DailyLedgerShipmentPostingService,
    private dispatchRepo: DailyLedgerDispatchRepository = new DailyLedgerDispatchRepository(),
    private dispatchSaveRepo: DailyLedgerDispatchSaveRepository = new DailyLedgerDispatchSaveRepository(),
    private dispatchOpsRepo: DailyLedgerDispatchOperationRepository = new DailyLedgerDispatchOperationRepository(),
  ) {}

  listRows(scope: DataScope, filters: DailyLedgerRowListFilters) {
    return this.repo.listRows(scope, filters);
  }

  listDuplicateReceiptGroups(
    scope: DataScope,
    filters: {
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      createdByUserId?: string;
      scopeMode?: 'same_day' | 'cross_date' | 'all';
      limit?: number;
    },
  ) {
    return this.repo.listDuplicateReceiptGroups(scope, filters);
  }

  listDispatchDefinitions(scope: DataScope, filters: DailyLedgerDispatchListFilters) {
    return this.dispatchRepo.listDefinitions(scope, filters);
  }

  suggestNextDispatchNo(scope: DataScope, filters: DailyLedgerDispatchListFilters) {
    return this.dispatchRepo.suggestNextDispatchNo(scope, filters);
  }

  createDispatchDefinition(scope: DataScope, input: DailyLedgerDispatchCreateInput) {
    return this.dispatchRepo.createDefinition(scope, input);
  }

  updateDispatchDefinition(scope: DataScope, id: string, input: DailyLedgerDispatchUpdateInput) {
    return this.dispatchRepo.updateDefinition(scope, id, input);
  }

  deleteDispatchDefinition(scope: DataScope, id: string) {
    return this.dispatchRepo.deleteDefinition(scope, id, scope.userId);
  }

  beginDispatchOperation(scope: DataScope, input: BeginDispatchOperationInput) {
    return this.dispatchOpsRepo.begin(scope, input);
  }

  async createDispatchSaveLog(scope: DataScope, input: DispatchSaveLogInput & { operationId?: string | null }) {
    const log = await this.dispatchSaveRepo.create(scope, input);
    if (input.operationId) {
      const status =
        input.outcome === 'failed' ? 'FAILED' : input.outcome === 'partial' ? 'PARTIAL' : 'COMPLETED';
      await this.dispatchOpsRepo.finalize(scope, input.operationId, {
        saveLogId: log.id,
        dispatchId: input.dispatchId ?? null,
        status,
        resultSummary: {
          postedCount: input.postedCount ?? 0,
          errorCount: input.errorCount ?? 0,
          skippedCount: input.skippedCount ?? 0,
          outcome: input.outcome ?? null,
        },
      });
    }
    const detailed = await this.dispatchSaveRepo.getById(scope, log.id);
    if (!detailed) {
      throw new HttpError(500, 'تعذر قراءة سجل حفظ الإرسالية بعد الإنشاء.');
    }
    return detailed;
  }

  listDispatchSaveLogs(scope: DataScope, filters: DispatchSaveLogListFilters) {
    return this.dispatchSaveRepo.list(scope, filters);
  }

  getDispatchSaveLog(scope: DataScope, id: string) {
    return this.dispatchSaveRepo.getById(scope, id);
  }

  markDispatchSavePrinted(scope: DataScope, id: string, input: { printDocumentId?: string | null }) {
    return this.dispatchSaveRepo.markPrinted(scope, id, input);
  }

  previewDispatchSaveUndo(scope: DataScope, saveLogId: string) {
    return this.dispatchUndo.preview(scope, saveLogId);
  }

  undoDispatchSave(scope: DataScope, saveLogId: string, input: { reason?: string | null }) {
    return this.dispatchUndo.undo(scope, saveLogId, { reason: input.reason, userId: scope.userId });
  }

  async upsertRow(scope: DataScope, input: DailyLedgerUpsertInput & { operationId?: string }) {
    const row = await this.repo.upsertRow(scope, input);
    if (input.operationId) {
      try {
        await this.dispatchOpsRepo.ensureRowForUpsert(scope, input.operationId, row.id);
      } catch (error) {
        console.warn(
          '[daily-ledger] operation row journal failed',
          row.id,
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (this.shipmentPosting && row.posted_shipment_id && !row.loaded_at) {
      try {
        await this.shipmentPosting.syncPostedShipmentFromLedgerRow(scope, row.id);
      } catch (error) {
        console.warn(
          '[daily-ledger] ledger row saved but shipment sync failed',
          row.id,
          error instanceof Error ? error.message : error,
        );
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
      operationId?: string;
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

  fetchRowAuditSnapshots(scope: DataScope, rowIds: string[]) {
    return this.repo.fetchRowAuditSnapshots(scope, rowIds);
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

  deletePrintDocument(scope: DataScope, documentId: string) {
    return this.repo.deletePrintDocument(scope, documentId);
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
