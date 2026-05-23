import { Router } from 'express';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { pool } from '../db/pool.js';
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId) {
        throw new HttpError(403, 'Company scope is required.');
    }
    return companyId;
}
export function createSystemDiagnosticsRouter(systemSettingsService, backupService) {
    const router = Router();
    router.get('/desktop-handshake', asyncHandler(async (req, res) => {
        const schemaVersionResult = await pool.query(`
        select name
        from schema_migrations
        order by id desc
        limit 1
        `);
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
    }));
    router.get('/diagnostics', requirePermissions(['settings.system.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const branchId = req.requestUserContext?.branchId ?? null;
        const runtimeConfig = await systemSettingsService.getRuntimeConfig(companyId);
        const networkConfig = await systemSettingsService.getNetworkConfig(companyId);
        const dbStart = Date.now();
        const dbStatus = await pool
            .query('select 1 as ok')
            .then(() => 'connected')
            .catch(() => 'error');
        const dbLatencyMs = Date.now() - dbStart;
        const activeSessionsResult = await pool.query(`
        select count(*)::int as total
        from auth_sessions s
        join users u on u.id = s.user_id
        where s.revoked_at is null
          and s.expires_at > now()
          and u.company_id = $1
        `, [companyId]);
        const activeSessions = Number(activeSessionsResult.rows[0]?.total ?? 0);
        const baseCurrencyResult = await pool.query(`
        select code
        from currencies
        where company_id = $1 and is_base = true and is_active = true
        order by updated_at desc
        limit 1
        `, [companyId]);
        const baseCurrency = baseCurrencyResult.rows[0]?.code ?? 'USD';
        const userAgent = String(req.headers['user-agent'] ?? '');
        const runtimeHeader = String(req.headers['x-electron-runtime'] ?? '');
        const runtimeModeHeader = String(req.headers['x-runtime-mode'] ?? '');
        const runtimeVersionHeader = String(req.headers['x-runtime-version'] ?? '');
        const deviceIdHeader = String(req.headers['x-device-id'] ?? '');
        const backupDiagnostics = backupService ? await backupService.getDiagnostics(companyId) : null;
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
            },
        });
    }));
    return router;
}
