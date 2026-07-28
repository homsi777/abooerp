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
      let cashboxId=input.cashboxId;
      const selectedCashbox=await pool.query<{id:string}>(
        `select id from cashboxes where id=$1::uuid and company_id=$2::uuid and is_active=true limit 1`,
        [cashboxId,context.companyId],
      );
      if(!selectedCashbox.rowCount){
        const compatibleCashboxes=await pool.query<{id:string}>(
          `select cb.id
             from transfers t
             join cashboxes cb
               on cb.company_id=t.company_id
              and cb.agent_id=coalesce(t.destination_agent_id,t.agent_id)
              and upper(cb.currency_code)=upper(t.currency)
              and cb.is_active=true
            where t.id=$1::uuid and t.company_id=$2::uuid
            order by cb.created_at asc`,
          [input.transferId,context.companyId],
        );
        if(compatibleCashboxes.rowCount!==1)throw new Error('CENTRAL_CASHBOX_MAPPING_REQUIRED');
        cashboxId=compatibleCashboxes.rows[0].id;
      }
      const transfer=await transfersService.completeTransfer({
        id:input.transferId,
        companyId:context.companyId,
        cashboxId,
        voucherNo:input.voucherNo,
        userId:context.userId,
        baseCurrency:context.baseCurrency,
      });
      const [cashbox,paymentVoucher]=await Promise.all([
        pool.query(`select * from cashboxes where id=$1::uuid and company_id=$2::uuid limit 1`,[cashboxId,context.companyId]),
        transfer?.payout_payment_voucher_id
          ?pool.query(`select * from payment_vouchers where id=$1::uuid and company_id=$2::uuid limit 1`,[transfer.payout_payment_voucher_id,context.companyId])
          :Promise.resolve({rows:[]}),
      ]);
      return {
        transfer,
        cashbox:cashbox.rows[0]??null,
        paymentVoucher:paymentVoucher.rows[0]??null,
      };
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
