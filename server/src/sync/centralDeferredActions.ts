import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';
import { FinanceRepository } from '../repositories/financeRepository.js';
import { ShipmentRepository } from '../repositories/shipmentRepository.js';
import { TransfersRepository } from '../repositories/transfersRepository.js';
import { DailyLedgerService } from '../services/dailyLedgerService.js';
import { DailyLedgerShipmentPostingService } from '../services/dailyLedgerShipmentPostingService.js';
import { InventoryService } from '../services/inventoryService.js';
import { ShipmentFinancialPostingService } from '../services/shipmentFinancialPostingService.js';
import { ShipmentService } from '../services/shipmentService.js';
import { TransfersService } from '../services/transfersService.js';
import type { SyncRequestContext } from './centralSyncService.js';

const postLedgerShipmentsSchema=z.object({
  action:z.literal('POST_DAILY_LEDGER_SHIPMENTS'),branchId:z.string().uuid(),ledgerDate:z.string().min(1),lineLabel:z.string().min(1),
  sessionId:z.string().uuid().optional(),rowIds:z.array(z.string().uuid()).optional(),createdByUserId:z.string().uuid().optional(),
  saveOperationId:z.string().uuid().optional(),
});
const completeTransferSchema=z.object({
  action:z.literal('COMPLETE_TRANSFER'),
  transferId:z.string().uuid(),
  cashboxId:z.string().uuid(),
  voucherNo:z.string().trim().min(1).max(100).optional(),
});
const cancelTransferSchema=z.object({
  action:z.literal('CANCEL_TRANSFER'),
  transferId:z.string().uuid(),
  reason:z.string().trim().max(1000).optional(),
});
const payloadSchema=z.discriminatedUnion('action',[
  postLedgerShipmentsSchema,
  completeTransferSchema,
  cancelTransferSchema,
]);

let service:DailyLedgerService|null=null;
function postingService(){
  if(service)return service;
  const ledgerRepository=new DailyLedgerRepository();const shipmentRepository=new ShipmentRepository();const financeRepository=new FinanceRepository();const agentRepository=new AgentRepository();
  const financialPosting=new ShipmentFinancialPostingService(shipmentRepository,financeRepository);
  const shipmentService=new ShipmentService(shipmentRepository,new InventoryService(),financialPosting,new TransfersService(new TransfersRepository(pool),financeRepository),agentRepository);
  service=new DailyLedgerService(ledgerRepository,new DailyLedgerShipmentPostingService(ledgerRepository,shipmentService,agentRepository,financialPosting));return service;
}

export async function executeCentralDeferredAction(context:SyncRequestContext,payload:Record<string,unknown>){
  const input=payloadSchema.parse(payload);
  if(input.action==='COMPLETE_TRANSFER'||input.action==='CANCEL_TRANSFER'){
    if(!context.permissionCodes?.includes('transfers.write'))throw new Error('DEFERRED_ACTION_PERMISSION_REJECTED');
    const transfersService=new TransfersService(new TransfersRepository(pool),new FinanceRepository());
    if(input.action==='COMPLETE_TRANSFER'){
      return transfersService.completeTransfer({
        id:input.transferId,
        companyId:context.companyId,
        cashboxId:input.cashboxId,
        voucherNo:input.voucherNo,
        userId:context.userId,
        baseCurrency:context.baseCurrency,
      });
    }
    return transfersService.cancelTransfer({
      id:input.transferId,
      companyId:context.companyId,
      userId:context.userId,
      reason:input.reason,
    });
  }
  if(!context.allowedBranchIds.includes(input.branchId))throw new Error('DEFERRED_ACTION_SCOPE_REJECTED');
  return postingService().postPendingShipments(
    {companyId:context.companyId,branchId:input.branchId,userId:context.userId},
    {
      branchId:input.branchId,
      ledgerDate:input.ledgerDate,
      lineLabel:input.lineLabel,
      sessionId:input.sessionId,
      rowIds:input.rowIds,
      createdByUserId:input.createdByUserId??context.userId,
      operationId:input.saveOperationId,
    },
    context.allowedBranchIds,
  );
}
