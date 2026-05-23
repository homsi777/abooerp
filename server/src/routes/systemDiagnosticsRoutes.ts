import { Router } from 'express';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { pool } from '../db/pool.js';
import { SystemSettingsService } from '../services/systemSettingsService.js';
import { BackupService } from '../services/backupService.js';
import { ShipmentInventoryMovementRepository } from '../repositories/shipmentInventoryMovementRepository.js';
import { LinkedDeviceRepository } from '../repositories/linkedDeviceRepository.js';
import { LicenseRepository } from '../repositories/licenseRepository.js';
import { TelegramSettingsRepository } from '../repositories/telegramSettingsRepository.js';
import { getLocalLanAddresses } from '../utils/network.js';
import { env } from '../config/env.js';
import { eventBus } from '../events/eventBus.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createSystemDiagnosticsRouter(systemSettingsService: SystemSettingsService, backupService?: BackupService) {
  const router = Router();

  router.get(
    '/desktop-handshake',
    asyncHandler(async (req, res) => {
      const schemaVersionResult = await pool.query<{ name: string }>(
        `
        select name
        from schema_migrations
        order by id desc
        limit 1
        `
      );
      const schemaVersion = schemaVersionResult.rows[0]?.name?.replace('.sql', '') ?? 'unknown';
      const runtimeHeader = String(req.headers['x-electron-runtime'] ?? '');
      const runtimeModeHeader = String(req.headers['x-runtime-mode'] ?? '');
      res.json({
        success: true,
        data: {
          ok: true,
          timestamp: new Date().toISOString(),
          schemaVersion,
          electron: {
            detected: runtimeHeader === '1' || runtimeHeader.toLowerCase() === 'true',
            runtimeMode: runtimeModeHeader || null,
          },
        },
      });
    })
  );

  router.get(
    '/diagnostics',
    requirePermissions(['settings.system.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const branchId = (req as any).requestUserContext?.branchId ?? null;
      const runtimeConfig = await systemSettingsService.getRuntimeConfig(companyId);
      const networkConfig = await systemSettingsService.getNetworkConfig(companyId);
      const dbStart = Date.now();
      const dbStatus = await pool
        .query('select 1 as ok')
        .then(() => 'connected')
        .catch(() => 'error');
      const dbLatencyMs = Date.now() - dbStart;

      const activeSessionsResult = await pool.query(
        `
        select count(*)::int as total
        from auth_sessions s
        join users u on u.id = s.user_id
        where s.revoked_at is null
          and s.expires_at > now()
          and u.company_id = $1
        `,
        [companyId]
      );
      const activeSessions = Number(activeSessionsResult.rows[0]?.total ?? 0);

      const baseCurrencyResult = await pool.query(
        `
        select code
        from currencies
        where company_id = $1 and is_base = true and is_active = true
        order by updated_at desc
        limit 1
        `,
        [companyId]
      );
      const baseCurrency = (baseCurrencyResult.rows[0]?.code as string | undefined) ?? 'USD';
      const userAgent = String(req.headers['user-agent'] ?? '');
      const runtimeHeader = String(req.headers['x-electron-runtime'] ?? '');
      const runtimeModeHeader = String(req.headers['x-runtime-mode'] ?? '');
      const runtimeVersionHeader = String(req.headers['x-runtime-version'] ?? '');
      const deviceIdHeader = String(req.headers['x-device-id'] ?? '');
      const backupDiagnostics = backupService ? await backupService.getDiagnostics(companyId) : null;
      const inventoryRepo = new ShipmentInventoryMovementRepository();
      const deviceRepo = new LinkedDeviceRepository();
      const licenseRepo = new LicenseRepository();
      const telegramRepo = new TelegramSettingsRepository();
      const [
        shipmentInventoryLinked,
        inventoryCrudReady,
        inventoryAdjustmentReady,
        shipmentLabelPersistenceReady,
        financeCompanyIsolationComplete,
        cleanStateResult,
        deviceStats,
        activeLicense,
        telegramDiagnostics,
      ] = await Promise.all([
        inventoryRepo.isLinked(),
        inventoryRepo.isCrudReady(),
        inventoryRepo.isAdjustmentReady(),
        inventoryRepo.isLabelPersistenceReady(),
        inventoryRepo.isFinanceCompanyIsolationComplete(),
        pool.query<{ total: string }>(`
          select (
            (select count(*) from shipments          where deleted_at is null) +
            (select count(*) from manifests          where deleted_at is null) +
            (select count(*) from deliveries         where deleted_at is null) +
            (select count(*) from shipment_inventory_movements) +
            (select count(*) from shipment_labels) +
            (select count(*) from receipt_vouchers) +
            (select count(*) from payment_vouchers) +
            (select count(*) from cashbox_transactions) +
            (select count(*) from items              where deleted_at is null) +
            (select count(*) from warehouses         where deleted_at is null)
          )::text as total
        `),
        deviceRepo.getStats(companyId),
        licenseRepo.findActiveByCompany(companyId),
        telegramRepo.getDiagnostics(companyId),
      ]);
      const systemCleanState = parseInt(cleanStateResult.rows[0]?.total ?? '1', 10) === 0;

      let licenseQuotaRemaining: Record<string, number | null> | null = null;
      if (activeLicense && (activeLicense.shipmentLimit != null)) {
        const usage = await licenseRepo.getUsage(companyId);
        licenseQuotaRemaining = {
          shipments: activeLicense.shipmentLimit != null ? Math.max(0, activeLicense.shipmentLimit - usage.shipmentsUsed) : null,
          deliveries: activeLicense.deliveryLimit != null ? Math.max(0, activeLicense.deliveryLimit - usage.deliveriesUsed) : null,
          receipts: activeLicense.receiptLimit != null ? Math.max(0, activeLicense.receiptLimit - usage.receiptsUsed) : null,
        };
      }

      res.json({
        success: true,
        data: {
          uptimeSeconds: Math.floor(process.uptime()),
          environmentMode: runtimeConfig.environment,
          networkMode: networkConfig.mode,
          host: networkConfig.host,
          port: networkConfig.port,
          databaseStatus: dbStatus,
          databaseLatencyMs: dbLatencyMs,
          baseCurrency,
          companyId,
          branchId,
          activeSessions,
          queueDepth: null,
          pool: {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount,
          },
          electronAvailable: userAgent.toLowerCase().includes('electron') || runtimeHeader === '1',
          electronRuntime: {
            viaUserAgent: userAgent.toLowerCase().includes('electron'),
            viaRuntimeHeader: runtimeHeader === '1' || runtimeHeader.toLowerCase() === 'true',
            runtimeMode: runtimeModeHeader || null,
            runtimeVersion: runtimeVersionHeader || null,
            deviceId: deviceIdHeader || null,
          },
          backup: backupDiagnostics,
          shipmentInventoryLinked,
          inventoryCrudReady,
          inventoryAdjustmentReady,
          shipmentLabelPersistenceReady,
          financeCompanyIsolationComplete,
          systemCleanState,
          linkedDevicesCount: parseInt(deviceStats?.total ?? '0', 10),
          approvedDevicesCount: parseInt(deviceStats?.approved ?? '0', 10),
          pendingDevicesCount: parseInt(deviceStats?.pending ?? '0', 10),
          licenseActive: activeLicense !== null,
          licenseType: activeLicense?.licenseType ?? null,
          cloudEnabled: activeLicense?.cloudEnabled ?? false,
          licenseQuotaRemaining,
          telegramActivationConfigured: telegramDiagnostics.activationConfigured,
          telegramAgentBotsCount: telegramDiagnostics.agentBotsCount,
          telegramEnabledAgentBotsCount: telegramDiagnostics.enabledAgentBotsCount,
          // ── LAN Runtime ──────────────────────────────────────────────────────
          lan: {
            serverHost: env.SERVER_HOST,
            serverPort: env.SERVER_PORT,
            lanAddresses: getLocalLanAddresses(),
            realtimeConnectedClients: eventBus.clientCount,
            lanFirewallHint: `افتح منفذ TCP ${env.SERVER_PORT} في Windows Firewall إذا لم تستطع الأجهزة الأخرى الاتصال.`,
          },
        },
      });
    })
  );

  return router;
}
