import type { DataScope } from '../utils/scope.js';
import { HttpError } from '../utils/errors.js';
import type { DailyLedgerRowListFilters, DailyLedgerPrintDocumentInput, DailyLedgerPrintDocumentListFilters, DailyLedgerUpsertInput } from '../repositories/dailyLedgerRepository.js';
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
}
