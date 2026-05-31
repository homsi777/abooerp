import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { getLocalLanAddresses } from './utils/network.js';
import { createReferenceRouters } from './modules/referenceModules.js';
import { ShipmentRepository } from './repositories/shipmentRepository.js';
import { ShipmentService } from './services/shipmentService.js';
import { ShipmentFinancialPostingService } from './services/shipmentFinancialPostingService.js';
import { createShipmentRouter } from './routes/shipmentRoutes.js';
import { ManifestRepository } from './repositories/manifestRepository.js';
import { ManifestService } from './services/manifestService.js';
import { createManifestRouter } from './routes/manifestRoutes.js';
import { DeliveryRepository } from './repositories/deliveryRepository.js';
import { DeliveryService } from './services/deliveryService.js';
import { createDeliveryRouter } from './routes/deliveryRoutes.js';
import { CenterReceiptRepository } from './repositories/centerReceiptRepository.js';
import { CenterReceiptService } from './services/centerReceiptService.js';
import { createCenterReceiptRouter } from './routes/centerReceiptRoutes.js';
import { HttpError } from './utils/errors.js';
import { requestContextMiddleware } from './middleware/requestContext.js';
import { FinanceRepository } from './repositories/financeRepository.js';
import { FinanceService } from './services/financeService.js';
import { createFinanceRouter } from './routes/financeRoutes.js';
import { AuthService } from './services/authService.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { BranchRepository } from './repositories/branchRepository.js';
import { createBranchRouter } from './routes/branchRoutes.js';
import { AgentRepository } from './repositories/agentRepository.js';
import { createAgentRouter } from './routes/agentRoutes.js';
import { UserRepository } from './repositories/userRepository.js';
import { createUserRouter } from './routes/userRoutes.js';
import { RoleRepository } from './repositories/roleRepository.js';
import { createRoleRouter } from './routes/roleRoutes.js';
import { createPermissionsRouter } from './routes/permissionsRoutes.js';
import { CurrencyRepository } from './repositories/currencyRepository.js';
import { ExchangeRateRepository } from './repositories/exchangeRateRepository.js';
import { createCurrencyRouter } from './routes/currencyRoutes.js';
import { createExchangeRateRouter } from './routes/exchangeRateRoutes.js';
import { createAuditRouter } from './routes/auditRoutes.js';
import { createAdminActivityRouter } from './routes/adminActivityRoutes.js';
import { AuditService } from './services/auditService.js';
import { SystemSettingsService } from './services/systemSettingsService.js';
import { createSystemSettingsRouter } from './routes/systemSettingsRoutes.js';
import { createSystemDiagnosticsRouter } from './routes/systemDiagnosticsRoutes.js';
import { createPrinterRouter } from './routes/printerRoutes.js';
import { PrinterService } from './services/printerService.js';
import { BackupService } from './services/backupService.js';
import { createBackupRouter } from './routes/backupRoutes.js';
import { createTerminologyRouter } from './routes/terminologyRoutes.js';
import { TerminologyService } from './services/terminologyService.js';
import { createShippingLabelSettingsRouter } from './routes/shippingLabelSettingsRoutes.js';
import { ShippingLabelSettingsService } from './services/shippingLabelSettingsService.js';
import { createShippingPrintPlanRouter } from './routes/shippingPrintPlanRoutes.js';
import { InventoryService } from './services/inventoryService.js';
import { createInventoryAdjustRouter } from './routes/inventoryAdjustRoutes.js';
import { EmployeeRepository } from './repositories/employeeRepository.js';
import { createEmployeeRouter } from './routes/employeeRoutes.js';
import { SalaryRepository } from './repositories/salaryRepository.js';
import { createSalaryRouter } from './routes/salaryRoutes.js';
import { LinkedDeviceRepository } from './repositories/linkedDeviceRepository.js';
import { createLinkedDeviceRouter } from './routes/linkedDeviceRoutes.js';
import { LicenseRepository } from './repositories/licenseRepository.js';
import { createLicenseRouter } from './routes/licenseRoutes.js';
import { WarehouseRepository } from './repositories/warehouseRepository.js';
import { WarehouseService } from './services/warehouseService.js';
import { createWarehouseRouter } from './routes/warehouseRoutes.js';
import { ItemRepository } from './repositories/itemRepository.js';
import { ItemService } from './services/itemService.js';
import { createItemRouter } from './routes/itemRoutes.js';
import { createCompanyRouter } from './routes/companyRoutes.js';
import { CompanyRepository } from './repositories/companyRepository.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { normalizeError } from './utils/errorNormalization.js';
import { requestTracingMiddleware } from './middleware/requestTracing.js';
import { TelegramSettingsRepository } from './repositories/telegramSettingsRepository.js';
import { createTelegramSettingsRouter } from './routes/telegramSettingsRoutes.js';
import { createEventsRouter } from './routes/eventsRoutes.js';
import { getLocalLanAddresses as _getLan } from './utils/network.js';
import { createNotificationBotRouter } from './routes/notificationBotRoutes.js';
import { NotificationBotRepository } from './repositories/notificationBotRepository.js';
import { createAgentPortalRouter } from './routes/agentPortalRoutes.js';
import { createDashboardRouter } from './routes/dashboardRoutes.js';
import { TransfersRepository } from './repositories/transfersRepository.js';
import { TransfersService } from './services/transfersService.js';
import { createTransfersRouter } from './routes/transfers.js';
import { DailyLedgerRepository } from './repositories/dailyLedgerRepository.js';
import { DailyLedgerService } from './services/dailyLedgerService.js';
import { createDailyLedgerRouter } from './routes/dailyLedgerRoutes.js';
import { pool } from './db/pool.js';
import customerRouter from './routes/customerRoutes.js';
import partiesRouter from './routes/partiesRoutes.js';

export const app = express();

// ── CORS — allow localhost, LAN clients, and Electron ─────────────────────────
const STATIC_ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5188',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5188',
  'app://electron',
]);

const WEB_PUBLIC_ORIGINS = new Set(
  String(process.env.WEB_PUBLIC_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const LAN_ORIGIN_RE = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+(:\d+)?$/;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Electron renderer / curl / health checks
    if (STATIC_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    if (WEB_PUBLIC_ORIGINS.has(origin)) return callback(null, true);
    if (LAN_ORIGIN_RE.test(origin)) return callback(null, true);
    // Allow same server's own LAN IPs dynamically
    const serverLanIps = getLocalLanAddresses();
    for (const ip of serverLanIps) {
      if (origin.startsWith(`http://${ip}`)) return callback(null, true);
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(correlationIdMiddleware);
app.use(requestTracingMiddleware);
app.use(requestContextMiddleware);

const referenceRouters = createReferenceRouters();
const inventoryService = new InventoryService();
const warehouseService = new WarehouseService(new WarehouseRepository());
const itemService = new ItemService(new ItemRepository());
const shipmentRepository = new ShipmentRepository();
const financeRepository = new FinanceRepository();
const shipmentFinancialPostingService = new ShipmentFinancialPostingService(shipmentRepository, financeRepository);
const transfersService = new TransfersService(new TransfersRepository(pool), financeRepository);
const dailyLedgerService = new DailyLedgerService(new DailyLedgerRepository());
const agentRepository = new AgentRepository();
const shipmentService = new ShipmentService(shipmentRepository, inventoryService, shipmentFinancialPostingService, transfersService, agentRepository);
const manifestService = new ManifestService(new ManifestRepository());
const financeService = new FinanceService(financeRepository);
const authService = new AuthService();
const deliveryService = new DeliveryService(new DeliveryRepository(), financeService, inventoryService);
const centerReceiptService = new CenterReceiptService(new CenterReceiptRepository());
const systemSettingsService = new SystemSettingsService();
const printerService = new PrinterService();
const backupService = new BackupService();
const terminologyService = new TerminologyService();
const shippingLabelSettingsService = new ShippingLabelSettingsService();

app.get('/api/health', (_req, res) => {
  res.json({ success: true, service: 'backend-phase1', status: 'ok' });
});

// ── LAN health — used by secondary devices to test connectivity ───────────────
app.get('/api/v1/system/lan-health', async (_req, res) => {
  const { pool: dbPool } = await import('./db/pool.js');
  const { env: srvEnv } = await import('./config/env.js');
  const { getLocalLanAddresses } = await import('./utils/network.js');
  const dbOk = await dbPool.query('select 1').then(() => true).catch(() => false);
  res.json({
    ok: true,
    host: srvEnv.SERVER_HOST,
    port: srvEnv.SERVER_PORT,
    lanAddresses: getLocalLanAddresses(),
    databaseConnected: dbOk,
    mode: 'lan',
    timestamp: new Date().toISOString(),
    lanFirewallHint: `افتح منفذ TCP ${srvEnv.SERVER_PORT} في Windows Firewall إذا لم تستطع الأجهزة الأخرى الاتصال.`,
  });
});

app.use('/api/v1/auth', createAuthRouter(authService));
app.use('/api/v1/branches', createBranchRouter(new BranchRepository()));
app.use('/api/v1/agents', createAgentRouter(agentRepository, financeService));
app.use('/api/v1/users', createUserRouter(new UserRepository()));
app.use('/api/v1/roles', createRoleRouter(new RoleRepository()));
app.use('/api/v1/permissions', createPermissionsRouter());
app.use('/api/v1/currencies', createCurrencyRouter(new CurrencyRepository(), new ExchangeRateRepository()));
app.use('/api/v1/exchange-rates', createExchangeRateRouter(new ExchangeRateRepository(), new CurrencyRepository()));
app.use('/api/v1/audit-logs', createAuditRouter(new AuditService()));
app.use('/api/v1/admin/activity-events', createAdminActivityRouter(new AuditService()));
app.use('/api/v1/system-settings', createSystemSettingsRouter(systemSettingsService));
app.use('/api/v1/company', createCompanyRouter(new CompanyRepository()));
app.use('/api/v1/system', createSystemDiagnosticsRouter(systemSettingsService, backupService));
app.use('/api/v1', createPrinterRouter(printerService));
app.use('/api/v1', createBackupRouter(backupService));
app.use('/api/v1', createTerminologyRouter(terminologyService));
app.use('/api/v1', createShippingLabelSettingsRouter(shippingLabelSettingsService));
app.use('/api/v1', createShippingPrintPlanRouter(shippingLabelSettingsService));
app.use('/api/v1', createInventoryAdjustRouter(inventoryService));
const employeeRepositorySingleton = new EmployeeRepository();
app.use('/api/v1/employees', createEmployeeRouter(employeeRepositorySingleton));
app.use(
  '/api/v1',
  createSalaryRouter(new SalaryRepository(), new ExchangeRateRepository(), employeeRepositorySingleton, financeRepository),
);
app.use('/api/v1/system', createLinkedDeviceRouter(new LinkedDeviceRepository()));
app.use('/api/v1/license', createLicenseRouter(new LicenseRepository()));
app.use('/api/v1/telegram/notification-bots', createNotificationBotRouter(new NotificationBotRepository()));
app.use('/api/v1/telegram', createTelegramSettingsRouter(new TelegramSettingsRepository()));
app.use('/api/v1/events', createEventsRouter());
app.use('/api/v1/warehouses', createWarehouseRouter(warehouseService));
app.use('/api/v1/items', createItemRouter(itemService));
app.use('/api/v1/customers', customerRouter);
app.use('/api/v1/parties', partiesRouter);
app.use('/api/v1/senders-receivers', referenceRouters.sendersReceivers);
app.use('/api/v1/drivers', referenceRouters.drivers);
app.use('/api/v1/vehicles', referenceRouters.vehicles);
app.use('/api/v1/cities', referenceRouters.cities);
app.use('/api/v1/goods-types', referenceRouters.goodsTypes);
app.use('/api/v1/tariffs', referenceRouters.tariffs);
app.use('/api/v1/shipments', createShipmentRouter(shipmentService));
app.use('/api/v1/daily-ledger', createDailyLedgerRouter(dailyLedgerService));
app.use('/api/v1/agent-portal', createAgentPortalRouter(shipmentService, financeService, transfersService, new AgentRepository()));
app.use('/api/v1/dashboard', createDashboardRouter());
app.use('/api/v1/manifests', createManifestRouter(manifestService));
app.use('/api/v1/center-receipts', createCenterReceiptRouter(centerReceiptService));
app.use('/api/v1/deliveries', createDeliveryRouter(deliveryService));
app.use('/api/v1', createFinanceRouter(financeService));
app.use('/api/v1/transfers', createTransfersRouter(transfersService));

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const correlationId = (req as any).correlationId as string | undefined;
  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.issues,
      correlationId,
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ success: false, error: error.message, correlationId });
    return;
  }

  const normalized = normalizeError(error);

  console.error('[API] Unhandled error:', {
    correlationId,
    normalized,
    raw: error,
  });
  res.status(normalized.statusCode).json({
    success: false,
    error: normalized.message,
    code: normalized.code,
    details: normalized.details,
    correlationId,
  });
});
