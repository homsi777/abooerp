import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { createReferenceRouters } from './modules/referenceModules.js';
import { ShipmentRepository } from './repositories/shipmentRepository.js';
import { ShipmentService } from './services/shipmentService.js';
import { createShipmentRouter } from './routes/shipmentRoutes.js';
import { ManifestRepository } from './repositories/manifestRepository.js';
import { ManifestService } from './services/manifestService.js';
import { createManifestRouter } from './routes/manifestRoutes.js';
import { DeliveryRepository } from './repositories/deliveryRepository.js';
import { DeliveryService } from './services/deliveryService.js';
import { createDeliveryRouter } from './routes/deliveryRoutes.js';
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
import { CurrencyRepository } from './repositories/currencyRepository.js';
import { ExchangeRateRepository } from './repositories/exchangeRateRepository.js';
import { createCurrencyRouter } from './routes/currencyRoutes.js';
import { createExchangeRateRouter } from './routes/exchangeRateRoutes.js';
import { createAuditRouter } from './routes/auditRoutes.js';
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
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { normalizeError } from './utils/errorNormalization.js';
import { requestTracingMiddleware } from './middleware/requestTracing.js';
export const app = express();
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);
app.use(requestTracingMiddleware);
app.use(requestContextMiddleware);
const referenceRouters = createReferenceRouters();
const shipmentService = new ShipmentService(new ShipmentRepository());
const manifestService = new ManifestService(new ManifestRepository());
const financeService = new FinanceService(new FinanceRepository());
const authService = new AuthService();
const deliveryService = new DeliveryService(new DeliveryRepository(), financeService);
const systemSettingsService = new SystemSettingsService();
const printerService = new PrinterService();
const backupService = new BackupService();
const terminologyService = new TerminologyService();
const shippingLabelSettingsService = new ShippingLabelSettingsService();
app.get('/api/health', (_req, res) => {
    res.json({ success: true, service: 'backend-phase1', status: 'ok' });
});
app.use('/api/v1/auth', createAuthRouter(authService));
app.use('/api/v1/branches', createBranchRouter(new BranchRepository()));
app.use('/api/v1/agents', createAgentRouter(new AgentRepository()));
app.use('/api/v1/users', createUserRouter(new UserRepository()));
app.use('/api/v1/roles', createRoleRouter(new RoleRepository()));
app.use('/api/v1/currencies', createCurrencyRouter(new CurrencyRepository(), new ExchangeRateRepository()));
app.use('/api/v1/exchange-rates', createExchangeRateRouter(new ExchangeRateRepository(), new CurrencyRepository()));
app.use('/api/v1/audit-logs', createAuditRouter(new AuditService()));
app.use('/api/v1/system-settings', createSystemSettingsRouter(systemSettingsService));
app.use('/api/v1/system', createSystemDiagnosticsRouter(systemSettingsService, backupService));
app.use('/api/v1', createPrinterRouter(printerService));
app.use('/api/v1', createBackupRouter(backupService));
app.use('/api/v1', createTerminologyRouter(terminologyService));
app.use('/api/v1', createShippingLabelSettingsRouter(shippingLabelSettingsService));
app.use('/api/v1/customers', referenceRouters.customers);
app.use('/api/v1/senders-receivers', referenceRouters.sendersReceivers);
app.use('/api/v1/drivers', referenceRouters.drivers);
app.use('/api/v1/vehicles', referenceRouters.vehicles);
app.use('/api/v1/cities', referenceRouters.cities);
app.use('/api/v1/goods-types', referenceRouters.goodsTypes);
app.use('/api/v1/tariffs', referenceRouters.tariffs);
app.use('/api/v1/shipments', createShipmentRouter(shipmentService));
app.use('/api/v1/manifests', createManifestRouter(manifestService));
app.use('/api/v1/deliveries', createDeliveryRouter(deliveryService));
app.use('/api/v1', createFinanceRouter(financeService));
app.use((error, req, res, _next) => {
    const correlationId = req.correlationId;
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
