import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import { TelegramSettingsRepository } from '../repositories/telegramSettingsRepository.js';
import { sendTestMessage, maskToken } from '../services/telegramService.js';

// NOTE: Activation bot routes are intentionally REMOVED.
// The activation bot is a developer-internal tool — credentials live in .env only.
// Customers never see or configure it.

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

const agentBotSchema = z.object({
  agentId:     z.string().uuid(),
  botToken:    z.string().min(10),
  chatId:      z.string().min(1),
  botUsername: z.string().optional().nullable(),
  isEnabled:   z.boolean().optional().default(true),
  notes:       z.string().optional().nullable(),
});

export function createTelegramSettingsRouter(repo: TelegramSettingsRepository) {
  const router = Router();
  const auditService = new AuditService();

  // ── Notification Bot Status (read-only, from .env — no token exposed) ────────

  router.get(
    '/notification-bot-status',
    requirePermissions(['settings.telegram.read']),
    asyncHandler(async (_req, res) => {
      const token = process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN;
      res.json({
        success: true,
        data: {
          configured: Boolean(token && token.length > 10),
          maskedToken: token ? maskToken(token) : null,
        },
      });
    }),
  );

  // ── Agent Bots ────────────────────────────────────────────────────────────

  router.get(
    '/agent-bots',
    requirePermissions(['settings.telegram.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const bots = await repo.listAgentBots(companyId);
      res.json({
        success: true,
        data: bots.map((b) => ({ ...b, bot_token: maskToken(b.bot_token) })),
      });
    }),
  );

  // Returns full token for edit modal
  router.get(
    '/agent-bots/:id/full',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const bot = await repo.getAgentBotById(companyId, String(req.params.id));
      if (!bot) throw new HttpError(404, 'Agent bot not found.');
      res.json({ success: true, data: bot });
    }),
  );

  router.post(
    '/agent-bots',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = requireUserId(req);
      const data = agentBotSchema.parse(req.body);
      const bot = await repo.createAgentBot(companyId, data);
      auditService.logAsync({
        req,
        action: 'TELEGRAM_AGENT_BOT_CREATED',
        entityType: 'telegram',
        entityId: bot.id,
        metadata: { agentId: data.agentId, maskedToken: maskToken(data.botToken), createdBy: userId },
      });
      res.status(201).json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
    }),
  );

  router.put(
    '/agent-bots/:id',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = requireUserId(req);
      const data = agentBotSchema.partial().parse(req.body);
      const bot = await repo.updateAgentBot(companyId, String(req.params.id), data);
      if (!bot) throw new HttpError(404, 'Agent bot not found.');
      auditService.logAsync({
        req,
        action: 'TELEGRAM_AGENT_BOT_UPDATED',
        entityType: 'telegram',
        entityId: bot.id,
        metadata: { updatedBy: userId, maskedToken: data.botToken ? maskToken(data.botToken) : undefined },
      });
      res.json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
    }),
  );

  router.delete(
    '/agent-bots/:id',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repo.deleteAgentBot(companyId, String(req.params.id));
      if (!removed) throw new HttpError(404, 'Agent bot not found.');
      res.json({ success: true });
    }),
  );

  router.post(
    '/agent-bots/:id/disable',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = requireUserId(req);
      const bot = await repo.disableAgentBot(companyId, String(req.params.id));
      if (!bot) throw new HttpError(404, 'Agent bot not found.');
      auditService.logAsync({
        req,
        action: 'TELEGRAM_AGENT_BOT_DISABLED',
        entityType: 'telegram',
        entityId: bot.id,
        metadata: { disabledBy: userId },
      });
      res.json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
    }),
  );

  router.post(
    '/agent-bots/:id/test',
    requirePermissions(['settings.telegram.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const result = await sendTestMessage(companyId, 'agent_bot', String(req.params.id));
      res.json({ success: result.ok, error: result.error });
    }),
  );

  return router;
}
