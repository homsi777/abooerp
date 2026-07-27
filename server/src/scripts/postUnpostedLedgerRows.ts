import dotenv from 'dotenv';
import { pool } from '../db/pool.js';
import { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';
import { DailyLedgerService } from '../services/dailyLedgerService.js';
import { DailyLedgerShipmentPostingService } from '../services/dailyLedgerShipmentPostingService.js';
import { ShipmentRepository } from '../repositories/shipmentRepository.js';
import { FinanceRepository } from '../repositories/financeRepository.js';
import { ShipmentFinancialPostingService } from '../services/shipmentFinancialPostingService.js';
import { TransfersService } from '../services/transfersService.js';
import { TransfersRepository } from '../repositories/transfersRepository.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { ShipmentService } from '../services/shipmentService.js';
import { InventoryService } from '../services/inventoryService.js';

dotenv.config();

const branchId = process.argv[2] ?? '181d4f0c-fbad-4beb-9103-8a42c6f8d1d4';
const ledgerDate = process.argv[3] ?? '2026-06-06';
const lineLabel = process.argv[4] ?? 'فرع حلب';
const shipmentRepository = new ShipmentRepository();
const financeRepository = new FinanceRepository();
const shipmentFinancialPostingService = new ShipmentFinancialPostingService(shipmentRepository, financeRepository);
const agentRepository = new AgentRepository();
const shipmentService = new ShipmentService(
  shipmentRepository,
  new InventoryService(),
  shipmentFinancialPostingService,
  new TransfersService(new TransfersRepository(pool), financeRepository),
  agentRepository,
);
const dailyLedgerRepository = new DailyLedgerRepository();
const postingService = new DailyLedgerShipmentPostingService(dailyLedgerRepository, shipmentService, agentRepository);
const dailyLedgerService = new DailyLedgerService(dailyLedgerRepository, postingService);

const company = await pool.query<{ id: string }>('select company_id as id from branches where id = $1', [branchId]);
const companyId = company.rows[0]?.id;
if (!companyId) {
  throw new Error(`Branch not found: ${branchId}`);
}

const result = await dailyLedgerService.postPendingShipments(
  { companyId, branchId, userId: undefined },
  { branchId, ledgerDate, lineLabel },
  [],
);

console.log(JSON.stringify(result, null, 2));
await pool.end();
