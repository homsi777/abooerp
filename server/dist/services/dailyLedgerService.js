import { HttpError } from '../utils/errors.js';
import { agentDestinationHints, computeAgentTransitStatus, destinationMatchesAgentHints, filterRowsForAgent, } from '../utils/agentDocumentationScope.js';
import { DailyLedgerDispatchRepository } from '../repositories/dailyLedgerDispatchRepository.js';
export class DailyLedgerService {
    repo;
    shipmentPosting;
    dispatchRepo;
    constructor(repo, shipmentPosting, dispatchRepo = new DailyLedgerDispatchRepository()) {
        this.repo = repo;
        this.shipmentPosting = shipmentPosting;
        this.dispatchRepo = dispatchRepo;
    }
    listRows(scope, filters) {
        return this.repo.listRows(scope, filters);
    }
    listDispatchDefinitions(scope, filters) {
        return this.dispatchRepo.listDefinitions(scope, filters);
    }
    suggestNextDispatchNo(scope, filters) {
        return this.dispatchRepo.suggestNextDispatchNo(scope, filters);
    }
    createDispatchDefinition(scope, input) {
        return this.dispatchRepo.createDefinition(scope, input);
    }
    updateDispatchDefinition(scope, id, input) {
        return this.dispatchRepo.updateDefinition(scope, id, input);
    }
    deleteDispatchDefinition(scope, id) {
        return this.dispatchRepo.deleteDefinition(scope, id, scope.userId);
    }
    async upsertRow(scope, input) {
        const row = await this.repo.upsertRow(scope, input);
        if (this.shipmentPosting && row.posted_shipment_id && !row.loaded_at) {
            try {
                await this.shipmentPosting.syncPostedShipmentFromLedgerRow(scope, row.id);
            }
            catch (error) {
                console.warn('[daily-ledger] ledger row saved but shipment sync failed', row.id, error instanceof Error ? error.message : error);
            }
        }
        return row;
    }
    markPosted(scope, input, allowedBranchIds) {
        return this.repo.markPosted(scope, { ...input, userId: scope.userId }, allowedBranchIds);
    }
    markLoadedByShipmentIds(input) {
        return this.repo.markLoadedByShipmentIds(input);
    }
    postPendingShipments(scope, filters, allowedBranchIds) {
        if (!this.shipmentPosting) {
            throw new Error('Daily ledger shipment posting is not configured.');
        }
        return this.shipmentPosting.postPendingShipments(scope, filters, allowedBranchIds);
    }
    deleteRows(scope, rowIds, allowedBranchIds, createdByUserId) {
        return this.repo.deleteRows(scope, { rowIds, userId: scope.userId, createdByUserId }, allowedBranchIds);
    }
    fetchRowAuditSnapshots(scope, rowIds) {
        return this.repo.fetchRowAuditSnapshots(scope, rowIds);
    }
    cancelSession(scope, sessionId, allowedBranchIds, createdByUserId) {
        return this.repo.cancelSession(scope, { sessionId, userId: scope.userId, createdByUserId }, allowedBranchIds);
    }
    recordSessionPrint(scope, input) {
        return this.repo.recordSessionPrint(scope, input);
    }
    createPrintDocument(scope, input) {
        return this.repo.createPrintDocument(scope, input);
    }
    listPrintDocuments(scope, filters) {
        return this.repo.listPrintDocuments(scope, filters);
    }
    getPrintDocument(scope, documentId) {
        return this.repo.getPrintDocument(scope, documentId);
    }
    deletePrintDocument(scope, documentId) {
        return this.repo.deletePrintDocument(scope, documentId);
    }
    listAgentPrintDocuments(scope, filters) {
        const hints = agentDestinationHints(scope);
        if (!scope.companyId || !hints.length) {
            return Promise.resolve([]);
        }
        return this.repo.listAgentPrintDocuments(scope, filters, hints);
    }
    async getAgentPrintDocument(scope, documentId) {
        const hints = agentDestinationHints(scope);
        if (!hints.length) {
            throw new HttpError(403, 'AGENT_NOT_LINKED');
        }
        const doc = await this.repo.getPrintDocument(scope, documentId);
        if (!doc)
            return null;
        const raw = doc;
        const destinationLabel = String(raw.destination_label ?? raw.destinationLabel ?? '');
        const searchQuery = String(raw.search_query ?? raw.searchQuery ?? '');
        const headerMatch = destinationMatchesAgentHints(destinationLabel, hints) ||
            destinationMatchesAgentHints(searchQuery, hints);
        const snapshot = (raw.rows_snapshot ?? raw.rowsSnapshot ?? []);
        const filteredRows = filterRowsForAgent(snapshot, hints);
        if (!headerMatch && !filteredRows.length) {
            return null;
        }
        const totals = filteredRows.reduce((acc, row) => {
            acc.rowCount += 1;
            acc.piecesCount += Number(row.parcelCount ?? 0) || 0;
            acc.weightKg += Number(String(row.weightKg ?? '').replace(/[^\d.-]/g, '')) || 0;
            acc.collectTotalUsd += Number(String(row.collectAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
            acc.prepaidTotalUsd += Number(String(row.prepaidAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
            acc.hawalaTotalUsd += Number(String(row.hawalaAmountUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
            acc.transferFeeTotalUsd += Number(String(row.transferServiceFeeUsd ?? '').replace(/[^\d.-]/g, '')) || 0;
            return acc;
        }, {
            rowCount: 0,
            piecesCount: 0,
            weightKg: 0,
            collectTotalUsd: 0,
            prepaidTotalUsd: 0,
            hawalaTotalUsd: 0,
            transferFeeTotalUsd: 0,
        });
        const transit = computeAgentTransitStatus(String(raw.ledger_date ?? raw.ledgerDate ?? ''), String(raw.printed_at ?? raw.printedAt ?? ''));
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
