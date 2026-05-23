import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import { pool } from '../db/pool.js';
import type { LinkedDeviceRepository } from '../repositories/linkedDeviceRepository.js';

function resolveIp(req: any): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0] ?? null;
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}

function isLocalRequest(req: any): boolean {
  const ip = resolveIp(req) ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

async function getDefaultCompanyId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `select id from companies where code = 'COMP-DEFAULT' limit 1`,
  );
  if (!result.rows[0]) throw new HttpError(500, 'No company configured.');
  return result.rows[0].id;
}

function requireCompanyId(req: any): string {
  const id = req.requestUserContext?.companyId as string | undefined;
  if (!id) throw new HttpError(403, 'Company scope required.');
  return id;
}

function requireUserId(req: any): string {
  const id = req.requestUserContext?.userId as string | undefined;
  if (!id) throw new HttpError(401, 'Authentication required.');
  return id;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  machineId: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(255).default('جهاز غير معرّف'),
  osType: z.string().max(64).optional(),
  ipAddress: z.string().max(64).optional(),
});

const heartbeatSchema = z.object({
  machineId: z.string().min(1).max(256),
});

export function createLinkedDeviceRouter(repository: LinkedDeviceRepository) {
  const router = Router();
  const auditService = new AuditService();

  // ── PUBLIC: Register device ───────────────────────────────────────────────
  // No auth required — called before login
  router.post(
    '/register-device',
    asyncHandler(async (req, res) => {
      const body = registerSchema.parse(req.body);

      // Auto-approve if the request is from localhost (server machine itself)
      const isLocal = isLocalRequest(req);

      const companyId = await getDefaultCompanyId();
      const ip = body.ipAddress ?? resolveIp(req);

      const device = await repository.upsertDevice({
        machineId: body.machineId,
        deviceName: body.deviceName,
        ipAddress: ip,
        osType: body.osType ?? null,
        companyId,
      });

      // Auto-approve local (server) machine on first registration
      if (isLocal && !device.is_approved && !device.is_blocked) {
        // Resolve the admin user ID to satisfy the approved_by FK constraint
        const adminResult = await pool.query<{ id: string }>(
          `select id from users where company_id = $1 order by created_at asc limit 1`,
          [companyId],
        );
        const adminId = adminResult.rows[0]?.id ?? null;
        if (!adminId) {
          // No users yet — just mark as pending, admin will approve after first login
          res.status(202).json({
            success: false,
            error: 'DEVICE_PENDING_APPROVAL',
            message: 'الجهاز في انتظار موافقة المسؤول.',
            data: { deviceId: device.id },
          });
          return;
        }
        await repository.approve(device.id, companyId, adminId);
        res.json({
          success: true,
          data: { status: 'DEVICE_APPROVED', deviceId: device.id, isLocal: true },
        });
        return;
      }

      if (device.is_blocked) {
        res.status(403).json({
          success: false,
          error: 'DEVICE_BLOCKED',
          message: 'هذا الجهاز محظور من قِبل المسؤول.',
        });
        return;
      }

      if (!device.is_approved) {
        res.status(202).json({
          success: false,
          error: 'DEVICE_PENDING_APPROVAL',
          message: 'الجهاز في انتظار موافقة المسؤول.',
          data: { deviceId: device.id },
        });
        return;
      }

      res.json({
        success: true,
        data: { status: 'DEVICE_APPROVED', deviceId: device.id },
      });
    }),
  );

  // ── PUBLIC: Heartbeat ─────────────────────────────────────────────────────
  router.post(
    '/device-heartbeat',
    asyncHandler(async (req, res) => {
      const body = heartbeatSchema.parse(req.body);
      await repository.heartbeat(body.machineId, resolveIp(req));
      res.json({ success: true });
    }),
  );

  // ── ADMIN: List devices ───────────────────────────────────────────────────
  router.get(
    '/linked-devices',
    requirePermissions(['settings.devices.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.listByCompany(companyId);
      res.json({ success: true, data });
    }),
  );

  // ── ADMIN: Approve device ─────────────────────────────────────────────────
  router.post(
    '/linked-devices/:id/approve',
    requirePermissions(['settings.devices.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = requireUserId(req);
      const data = await repository.approve(String(req.params.id), companyId, userId);
      if (!data) throw new HttpError(404, 'Device not found.');
      auditService.logAsync({
        req,
        action: 'DEVICE_APPROVED',
        entityType: 'linked_device',
        entityId: data.id,
        metadata: { machineId: data.machine_id, deviceName: data.device_name },
      });
      res.json({ success: true, data });
    }),
  );

  // ── ADMIN: Block device ───────────────────────────────────────────────────
  router.post(
    '/linked-devices/:id/block',
    requirePermissions(['settings.devices.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await repository.block(String(req.params.id), companyId);
      if (!data) throw new HttpError(404, 'Device not found.');
      auditService.logAsync({
        req,
        action: 'DEVICE_BLOCKED',
        entityType: 'linked_device',
        entityId: data.id,
        metadata: { machineId: data.machine_id, deviceName: data.device_name },
      });
      res.json({ success: true, data });
    }),
  );

  // ── ADMIN: Rename device ──────────────────────────────────────────────────
  router.put(
    '/linked-devices/:id/rename',
    requirePermissions(['settings.devices.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
      const data = await repository.rename(String(req.params.id), companyId, name);
      if (!data) throw new HttpError(404, 'Device not found.');
      auditService.logAsync({
        req,
        action: 'DEVICE_RENAMED',
        entityType: 'linked_device',
        entityId: data.id,
        metadata: { newName: name },
      });
      res.json({ success: true, data });
    }),
  );

  // ── ADMIN: Delete device ──────────────────────────────────────────────────
  router.delete(
    '/linked-devices/:id',
    requirePermissions(['settings.devices.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repository.remove(String(req.params.id), companyId);
      if (!removed) throw new HttpError(404, 'Device not found.');
      auditService.logAsync({
        req,
        action: 'DEVICE_REMOVED',
        entityType: 'linked_device',
        entityId: String(req.params.id),
      });
      res.json({ success: true });
    }),
  );

  return router;
}
