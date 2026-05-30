import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { pool } from '../db/pool.js';
import { LinkedDeviceRepository } from '../repositories/linkedDeviceRepository.js';

const deviceRepo = new LinkedDeviceRepository();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  branchId: z.string().uuid().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  branchId: z.string().uuid().optional(),
});

const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .optional();

function resolveIp(req: any): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  return req.ip;
}

function isLocalIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  );
}

function envFlag(name: string): boolean {
  return String(process.env[name] ?? '').trim().toLowerCase() === 'true';
}

function configuredWebOrigins(): Set<string> {
  return new Set(
    String(process.env.WEB_PUBLIC_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isAllowedWebOrigin(req: any): boolean {
  if (!envFlag('WEB_MODE_ENABLED') && !envFlag('DISABLE_DEVICE_AUTH_FOR_WEB')) return false;
  const origin = String(req.headers.origin ?? '').trim();
  return Boolean(origin) && configuredWebOrigins().has(origin);
}

function isAllowedMobileClient(req: any): boolean {
  if (!envFlag('MOBILE_MODE_ENABLED')) return false;
  return String(req.headers['x-client-type'] ?? '').trim().toLowerCase() === 'mobile';
}

async function checkDeviceAuthorization(req: any): Promise<void> {
  // Browser/VPS and native mobile clients use JWT auth without Electron device identity.
  // Each bypass is opt-in through server configuration; Electron/LAN checks remain intact.
  if (isAllowedWebOrigin(req) || isAllowedMobileClient(req)) return;

  const ip = resolveIp(req);

  // Server machine (localhost) is always allowed — skip device check
  if (isLocalIp(ip)) return;

  const machineId = String(req.headers['x-device-id'] ?? '').trim();

  // No device ID header and it's a LAN request → require registration
  if (!machineId) {
    throw new HttpError(403, 'DEVICE_NOT_REGISTERED');
  }

  const device = await deviceRepo.findByMachineId(machineId);

  if (!device) {
    throw new HttpError(403, 'DEVICE_NOT_REGISTERED');
  }

  if (device.is_blocked) {
    throw new HttpError(403, 'DEVICE_BLOCKED');
  }

  if (!device.is_approved) {
    throw new HttpError(403, 'DEVICE_PENDING_APPROVAL');
  }
}

export function createAuthRouter(service: AuthService) {
  const router = Router();

  router.get(
    '/branches',
    asyncHandler(async (_req, res) => {
      const result = await pool.query<{
        id: string;
        code: string;
        name: string;
      }>(
        `
        select id, code, name
        from branches
        where is_active = true
        order by created_at asc
        `,
      );
      res.json({ success: true, data: result.rows });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      // ── Device authorization check (LAN clients only) ──────────────────────
      await checkDeviceAuthorization(req);

      const payload = loginSchema.parse(req.body);
      const data = await service.login({
        username: payload.username,
        password: payload.password,
        branchId: payload.branchId,
        userAgent: req.headers['user-agent'],
        ipAddress: resolveIp(req),
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const context = (req as any).requestUserContext;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }
      const data = await service.me(userId);
      if (context?.activeBranchId) {
        data.branchId = context.activeBranchId;
      }
      if (Array.isArray(context?.allowedBranchIds)) {
        data.allowedBranchIds = context.allowedBranchIds;
      }
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const payload = refreshSchema.parse(req.body);
      const data = await service.refresh({
        refreshToken: payload.refreshToken,
        branchId: payload.branchId,
        userAgent: req.headers['user-agent'],
        ipAddress: resolveIp(req),
      });
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const payload = logoutSchema.parse(req.body);
      const sessionId = (req as any).requestUserContext?.sessionId as string | undefined;
      if (sessionId) {
        await service.logoutBySession(sessionId);
      }
      if (payload?.refreshToken) {
        await service.logoutByRefreshToken(payload.refreshToken);
      }
      res.json({ success: true });
    }),
  );

  return router;
}
