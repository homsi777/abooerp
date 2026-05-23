import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import { NotificationBotRepository } from '../repositories/notificationBotRepository.js';
import { TelegramPartyLinkRepository } from '../repositories/telegramPartyLinkRepository.js';
import { fetchTelegramInboxCandidates, sendTelegramMessage } from '../services/telegramService.js';
import { AuditService } from '../services/auditService.js';
import { pool } from '../db/pool.js';

function requireCompanyId(req: any): string {
  const id = req.requestUserContext?.companyId as string | undefined;
  if (!id) throw new HttpError(403, 'Company scope required.');
  return id;
}

function maskToken(token: string): string {
  if (token.length <= 12) return '****';
  return token.slice(0, 6) + '****' + token.slice(-4);
}

const createSchema = z.object({
  name:       z.string().min(1).max(80),
  bot_token:  z.string().min(20).max(200),
  is_default: z.boolean().optional(),
  notes:      z.string().max(500).optional().nullable(),
});

const updateSchema = createSchema.partial();
const bindSchema = z.object({
  party_type: z.enum(['agent', 'customer', 'sender_receiver']),
  party_id: z.string().uuid(),
  chat_id: z.string().min(1),
  notification_bot_id: z.string().uuid().optional().nullable(),
  last_message: z.string().max(2000).optional().nullable(),
  last_message_at: z.string().datetime().optional().nullable(),
  last_seen_username: z.string().max(120).optional().nullable(),
  last_seen_name: z.string().max(200).optional().nullable(),
  source_update_id: z.coerce.number().int().optional().nullable(),
});

export function createNotificationBotRouter(repo: NotificationBotRepository) {
  const router = Router();
  const audit  = new AuditService();
  const partyLinks = new TelegramPartyLinkRepository();

  // ── قائمة بوتات الإشعارات ────────────────────────────────────────────────
  router.get('/', requirePermissions(['settings.system.read']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const bots = await repo.list(companyId);
    // نخفي التوكن في الاستجابة
    res.json({
      success: true,
      data: bots.map(b => ({ ...b, bot_token: maskToken(b.bot_token) })),
    });
  }));

  // ── إضافة بوت جديد ───────────────────────────────────────────────────────
  router.post('/', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const payload = createSchema.parse(req.body);
    const bot = await repo.create({ ...payload, company_id: companyId });
    audit.logAsync({ req, action: 'NOTIFICATION_BOT_CREATED', entityType: 'notification_bot', entityId: bot.id, metadata: { name: bot.name } });
    res.status(201).json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
  }));

  // ── تعديل بوت ────────────────────────────────────────────────────────────
  router.put('/:id', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const payload = updateSchema.parse(req.body);
    const bot = await repo.update(id, companyId, payload);
    if (!bot) throw new HttpError(404, 'Bot not found.');
    audit.logAsync({ req, action: 'NOTIFICATION_BOT_UPDATED', entityType: 'notification_bot', entityId: bot.id, metadata: { name: bot.name } });
    res.json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
  }));

  // ── حذف بوت ──────────────────────────────────────────────────────────────
  router.delete('/:id', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const ok = await repo.delete(id, companyId);
    if (!ok) throw new HttpError(404, 'Bot not found.');
    audit.logAsync({ req, action: 'NOTIFICATION_BOT_DELETED', entityType: 'notification_bot', entityId: id, metadata: {} });
    res.json({ success: true });
  }));

  // ── تعيين كافتراضي ────────────────────────────────────────────────────────
  router.post('/:id/set-default', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const bot = await repo.update(id, companyId, { is_default: true });
    if (!bot) throw new HttpError(404, 'Bot not found.');
    res.json({ success: true, data: { ...bot, bot_token: maskToken(bot.bot_token) } });
  }));

  // ── اختبار إرسال رسالة ───────────────────────────────────────────────────
  router.post('/:id/test', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const chatId = String(req.body?.chat_id ?? '').trim();
    if (!chatId) throw new HttpError(400, 'chat_id مطلوب لاختبار البوت.');

    const bot = await repo.getById(id, companyId);
    if (!bot) throw new HttpError(404, 'Bot not found.');

    const text = [
      `🧪 <b>اختبار بوت الإشعارات</b>`,
      `📛 البوت: ${bot.name}`,
      `📅 ${new Date().toLocaleString('ar-SY')}`,
      `✅ البوت يعمل بشكل صحيح`,
    ].join('\n');

    const ok = await sendTelegramMessage(bot.bot_token, chatId, text);
    if (ok) {
      await repo.updateTestAt(id);
      res.json({ success: true, message: 'وصلت رسالة الاختبار بنجاح' });
    } else {
      res.status(502).json({ success: false, error: 'فشل إرسال الرسالة — تحقق من التوكن والـ Chat ID' });
    }
  }));

  // ── جلب رسائل البوت واستخراج chat_id بطريقة ذكية ───────────────────────────
  router.get('/:id/inbox-candidates', requirePermissions(['settings.system.read']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const limit = Math.max(1, Math.min(100, Number(req.query['limit'] ?? 30) || 30));
    const bot = await repo.getById(id, companyId);
    if (!bot) throw new HttpError(404, 'Bot not found.');

    const result = await fetchTelegramInboxCandidates(bot.bot_token, limit);
    if (!result.ok) {
      res.status(502).json({ success: false, error: result.error ?? 'Failed to fetch Telegram updates' });
      return;
    }
    res.json({ success: true, data: result.data });
  }));

  // ── عرض روابط chat_id الحالية مع الأطراف ───────────────────────────────────
  router.get('/party-links/all', requirePermissions(['settings.system.read']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const rows = await partyLinks.list(companyId);
    res.json({ success: true, data: rows });
  }));

  // ── ربط chat_id مع وكيل/عميل/مرسل-مستلم ───────────────────────────────────
  router.post('/party-links/bind', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const actorUserId = (req as any).requestUserContext?.userId as string | undefined;
    const payload = bindSchema.parse(req.body);
    const row = await partyLinks.save({
      companyId,
      partyType: payload.party_type,
      partyId: payload.party_id,
      chatId: payload.chat_id,
      notificationBotId: payload.notification_bot_id ?? null,
      actorUserId: actorUserId ?? null,
      lastMessage: payload.last_message ?? null,
      lastMessageAt: payload.last_message_at ?? null,
      lastSeenUsername: payload.last_seen_username ?? null,
      lastSeenName: payload.last_seen_name ?? null,
      sourceUpdateId: payload.source_update_id ?? null,
    });

    // Keep legacy agent fallback working immediately.
    if (payload.party_type === 'agent') {
      await pool.query(
        `update agents set telegram_chat_id = $1, updated_at = now() where id = $2`,
        [payload.chat_id.trim(), payload.party_id],
      );
    }

    audit.logAsync({
      req,
      action: 'TELEGRAM_PARTY_LINK_BOUND',
      entityType: 'telegram_party_link',
      entityId: row.id,
      metadata: {
        partyType: payload.party_type,
        partyId: payload.party_id,
        chatId: payload.chat_id,
      },
    });
    res.json({ success: true, data: row });
  }));

  // ── حذف رابط طرف تيليغرام ──────────────────────────────────────────────────
  router.delete('/party-links/:id', requirePermissions(['settings.system.write']), asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req);
    const id = String(req.params['id']);
    const ok = await partyLinks.remove(id, companyId);
    if (!ok) throw new HttpError(404, 'Link not found.');
    res.json({ success: true });
  }));

  return router;
}
