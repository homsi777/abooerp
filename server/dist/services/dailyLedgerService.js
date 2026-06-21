import { HttpError } from '../utils/errors.js';
import { agentDestinationHints, computeAgentTransitStatus, destinationMatchesAgentHints, filterRowsForAgent, } from '../utils/agentDocumentationScope.js';
export class DailyLedgerService {
    repo;
    shipmentPosting;
    constructor(repo, shipmentPosting) {
        this.repo = repo;
        this.shipmentPosting = shipmentPosting;
    }
    listRows(scope, filters) {
        return this.repo.listRows(scope, filters);
    }
    async upsertRow(scope, input) {
        const row = await this.repo.upsertRow(scope, input);
        if (this.shipmentPosting && row.posted_shipment_id && !row.loaded_at) {
            try {
                await this.shipmentPosting.syncPostedShipmentFromLedgerRow(scope, row.id);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : 'تعذر تحديث الشحنة المرتبطة.';
                throw new HttpError(409, `تم حفظ سطر الدفتر، لكن ${detail}`);
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
