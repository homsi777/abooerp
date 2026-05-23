import { TelegramSettingsRepository } from '../repositories/telegramSettingsRepository.js';
import { NotificationBotRepository } from '../repositories/notificationBotRepository.js';
import { TelegramPartyLinkRepository } from '../repositories/telegramPartyLinkRepository.js';
import { AuditService } from './auditService.js';
import { pool } from '../db/pool.js';

const repo = new TelegramSettingsRepository();
const notifBotRepo = new NotificationBotRepository();
const partyLinkRepo = new TelegramPartyLinkRepository();
const auditService = new AuditService();

// ── Token masking ─────────────────────────────────────────────────────────────

export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

// ── Core send ─────────────────────────────────────────────────────────────────

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json()) as { ok: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? 'Telegram API error' };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Network error' };
  }
}

export interface TelegramInboxCandidate {
  update_id: number;
  chat_id: string;
  message_text: string;
  message_at: string | null;
  display_name: string;
  username: string | null;
}

export async function fetchTelegramInboxCandidates(
  botToken: string,
  limit = 30,
): Promise<{ ok: boolean; data: TelegramInboxCandidate[]; error?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, timeout: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: Array<any>;
    };
    if (!json.ok) {
      return { ok: false, data: [], error: json.description ?? 'Telegram API error' };
    }

    const byChat = new Map<string, TelegramInboxCandidate>();
    const updates = Array.isArray(json.result) ? json.result : [];
    for (const u of updates) {
      const message = u?.message ?? u?.edited_message ?? u?.channel_post;
      const chatIdRaw = message?.chat?.id;
      if (chatIdRaw === undefined || chatIdRaw === null) continue;
      const chatId = String(chatIdRaw);
      const text = String(message?.text ?? message?.caption ?? '').trim() || '(رسالة بدون نص)';
      const firstName = String(message?.from?.first_name ?? '').trim();
      const lastName = String(message?.from?.last_name ?? '').trim();
      const usernameRaw = String(message?.from?.username ?? '').trim();
      const username = usernameRaw ? `@${usernameRaw}` : null;
      const displayName =
        [firstName, lastName].filter(Boolean).join(' ').trim() ||
        usernameRaw ||
        String(message?.chat?.title ?? '').trim() ||
        'مستخدم تيليغرام';
      const messageAt = message?.date ? new Date(Number(message.date) * 1000).toISOString() : null;
      const updateId = Number(u?.update_id ?? 0);
      const current = byChat.get(chatId);
      if (!current || updateId > current.update_id) {
        byChat.set(chatId, {
          update_id: updateId,
          chat_id: chatId,
          message_text: text,
          message_at: messageAt,
          display_name: displayName,
          username,
        });
      }
    }

    const data = Array.from(byChat.values())
      .sort((a, b) => (b.update_id || 0) - (a.update_id || 0))
      .slice(0, Math.max(1, Math.min(limit, 100)));
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, data: [], error: err?.message ?? 'Network error' };
  }
}

// ── Activation notification (INTERNAL — reads from .env, never exposed in UI) ─

/**
 * Sends activation alert to the DEVELOPER'S internal bot.
 * Credentials live in TELEGRAM_ACTIVATION_BOT_TOKEN + TELEGRAM_ACTIVATION_CHAT_ID env vars.
 * The customer never sees or configures this bot.
 * Never throws.
 */
export async function sendActivationNotification(
  _companyId: string,
  payload: {
    licenseType: string;
    deviceName?: string;
    ipAddress?: string;
    appVersion?: string;
  },
): Promise<void> {
  try {
    const botToken = process.env.TELEGRAM_ACTIVATION_BOT_TOKEN;
    const chatId   = process.env.TELEGRAM_ACTIVATION_CHAT_ID;
    if (!botToken || !chatId) return; // not configured — skip silently

    const timestamp = new Date().toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });
    const text = [
      `🚀 <b>تفعيل نظام — شركة عبو المحمود لنقل والخدمات الوجستية</b>`,
      ``,
      `✅ تم تفعيل النظام بنجاح`,
      ``,
      `📦 النظام: شركة عبو المحمود لنقل والخدمات الوجستية`,
      `🔑 نوع التفعيل: ${payload.licenseType}`,
      `💻 الجهاز: ${payload.deviceName ?? 'غير محدد'}`,
      `🌐 IP: ${payload.ipAddress ?? 'غير محدد'}`,
      `🧩 الإصدار: ${payload.appVersion ?? '1.0.0'}`,
      `📅 التاريخ: ${timestamp}`,
    ].join('\n');

    const result = await sendTelegramMessage(botToken, chatId, text);
    auditService.logAsync({
      req: null as any,
      action: result.ok ? 'TELEGRAM_ACTIVATION_SENT' : 'TELEGRAM_SEND_FAILED',
      entityType: 'telegram',
      metadata: { target: 'activation_env', error: result.error },
    });
  } catch {
    // Telegram failures never break business flow
  }
}

// ── Agent shipment notification (customer-facing — uses env bot token) ────────

/**
 * Send shipment notification to an agent via Telegram.
 * Priority:
 *   1. Dedicated agent_telegram_bots entries (per-agent custom bot tokens)
 *   2. Agent's personal telegram_chat_id + TELEGRAM_NOTIFICATION_BOT_TOKEN from env
 * Never throws.
 */
export async function sendAgentShipmentNotification(
  companyId: string,
  agentId: string,
  payload: {
    shipmentNo: string;
    branchName?: string;
    senderName?: string;
    receiverName?: string;
    destinationCity?: string;
    piecesCount?: number;
    weightKg?: number;
  },
): Promise<void> {
  try {
    const bots = await repo.getEnabledAgentBots(companyId, agentId);
    const timestamp = new Date().toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });

    const text = [
      `📦 <b>شحن — شحنة جديدة للوكيل</b>`,
      ``,
      `🔢 رقم الشحنة: ${payload.shipmentNo}`,
      `🏢 الفرع: ${payload.branchName ?? '-'}`,
      `👤 المرسل: ${payload.senderName ?? '-'}`,
      `👤 المستلم: ${payload.receiverName ?? '-'}`,
      `📍 الوجهة: ${payload.destinationCity ?? '-'}`,
      `📦 عدد القطع: ${payload.piecesCount ?? 1}`,
      `⚖️ الوزن: ${payload.weightKg != null ? `${payload.weightKg} كغ` : '-'}`,
      `📅 التاريخ: ${timestamp}`,
    ].join('\n');

    // ─── الأولوية 1: بوت مخصص للوكيل (agent_telegram_bots) ─────────────────
    if (bots.length) {
      for (const bot of bots) {
        const result = await sendTelegramMessage(bot.bot_token, bot.chat_id, text);
        auditService.logAsync({
          req: null as any,
          action: result.ok ? 'TELEGRAM_AGENT_SHIPMENT_SENT' : 'TELEGRAM_SEND_FAILED',
          entityType: 'telegram',
          metadata: { botId: bot.id, agentId, shipmentNo: payload.shipmentNo, maskedToken: maskToken(bot.bot_token), error: result.error },
        });
      }
      return;
    }

    // ─── الأولوية 2: Chat ID للوكيل + بوت الإشعارات من DB (telegram_notification_bots) ──
    const agentRow = await pool.query<{ telegram_chat_id: string | null }>(
      `select telegram_chat_id from agents where id = $1 limit 1`,
      [agentId],
    );
    const chatId = agentRow.rows[0]?.telegram_chat_id;
    if (!chatId) return;

    // أولاً: ابحث عن بوت إشعارات مفعّل في DB
    const dbNotifBot = await notifBotRepo.getFirstActive(companyId);
    const botToken = dbNotifBot?.bot_token ?? process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN;
    if (!botToken) return;

    const result = await sendTelegramMessage(botToken, chatId, text);
    auditService.logAsync({
      req: null as any,
      action: result.ok ? 'TELEGRAM_AGENT_SHIPMENT_SENT' : 'TELEGRAM_SEND_FAILED',
      entityType: 'telegram',
      metadata: {
        agentId,
        shipmentNo: payload.shipmentNo,
        via: dbNotifBot ? 'db_notification_bot' : 'env_fallback',
        botName: dbNotifBot?.name ?? null,
        chatId,
        error: result.error,
      },
    });
  } catch {
    // Never break shipment flow
  }
}

export async function sendLinkedPartyShipmentNotifications(
  companyId: string,
  shipmentId: string,
): Promise<void> {
  try {
    const shipmentRes = await pool.query<{
      shipment_no: string;
      destination_city: string | null;
      pieces_count: number | null;
      weight_kg: number | null;
      sender_name: string | null;
      receiver_name: string | null;
      customer_name: string | null;
    }>(
      `
      select
        s.shipment_no,
        s.destination_city,
        s.pieces_count,
        s.weight_kg,
        sr_s.full_name as sender_name,
        sr_r.full_name as receiver_name,
        c.name as customer_name
      from shipments s
      left join senders_receivers sr_s on sr_s.id = s.sender_id
      left join senders_receivers sr_r on sr_r.id = s.receiver_id
      left join customers c on c.id = s.customer_id
      where s.id = $1 and s.company_id = $2
      limit 1
      `,
      [shipmentId, companyId],
    );
    const shipment = shipmentRes.rows[0];
    if (!shipment) return;

    const links = await partyLinkRepo.findForShipment(companyId, shipmentId);
    if (!links.length) return;

    const defaultBot = await notifBotRepo.getFirstActive(companyId);
    const fallbackToken = defaultBot?.bot_token ?? process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN ?? null;
    if (!fallbackToken && !links.some((l) => l.bot_token)) return;

    const sent = new Set<string>();
    const timestamp = new Date().toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });
    for (const link of links) {
      const token = link.bot_token ?? fallbackToken;
      if (!token) continue;
      const dedupeKey = `${token}|${link.chat_id}`;
      if (sent.has(dedupeKey)) continue;
      sent.add(dedupeKey);

      const text = [
        `📦 <b>شحن — تحديث شحنة مرتبطة بك</b>`,
        ``,
        `🔢 رقم الشحنة: ${shipment.shipment_no}`,
        `👤 المرسل: ${shipment.sender_name ?? '-'}`,
        `👤 المستلم: ${shipment.receiver_name ?? '-'}`,
        `🏷️ عميل الحساب: ${shipment.customer_name ?? '-'}`,
        `📍 الوجهة: ${shipment.destination_city ?? '-'}`,
        `📦 عدد القطع: ${shipment.pieces_count ?? 1}`,
        `⚖️ الوزن: ${shipment.weight_kg != null ? `${shipment.weight_kg} كغ` : '-'}`,
        `🧾 نوع الربط: ${link.party_label}`,
        `📅 ${timestamp}`,
      ].join('\n');

      const result = await sendTelegramMessage(token, link.chat_id, text);
      auditService.logAsync({
        req: null as any,
        action: result.ok ? 'TELEGRAM_SHIPMENT_PARTY_SENT' : 'TELEGRAM_SEND_FAILED',
        entityType: 'telegram',
        metadata: {
          shipmentId,
          shipmentNo: shipment.shipment_no,
          partyLabel: link.party_label,
          chatId: link.chat_id,
          error: result.error,
        },
      });
    }
  } catch {
    // Never break shipment flow
  }
}

// ── Test message for agent bot UI ─────────────────────────────────────────────

/**
 * Sends a test message for agent bots only (UI-facing).
 * Activation bot is never tested from UI.
 */
export async function sendTestMessage(
  companyId: string,
  targetType: 'agent_bot',
  targetId?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const timestamp = new Date().toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });

    if (targetType === 'agent_bot' && targetId) {
      const bot = await repo.getAgentBotById(companyId, targetId);
      if (!bot) return { ok: false, error: 'البوت غير موجود' };

      const text = [
        `🧪 <b>شحن — رسالة اختبار لبوت وكيل</b>`,
        ``,
        `✅ رسالة اختبار تيليجرام`,
        `🤖 البوت: ${bot.bot_username ?? 'غير محدد'}`,
        `📦 النظام: شركة عبو المحمود لنقل والخدمات الوجستية`,
        `📅 ${timestamp}`,
      ].join('\n');

      const result = await sendTelegramMessage(bot.bot_token, bot.chat_id, text);
      if (result.ok) await repo.markAgentBotTested(companyId, targetId);
      auditService.logAsync({
        req: null as any,
        action: result.ok ? 'TELEGRAM_TEST_SENT' : 'TELEGRAM_SEND_FAILED',
        entityType: 'telegram',
        metadata: { target: 'agent_bot', botId: targetId, maskedToken: maskToken(bot.bot_token), error: result.error },
      });
      return result;
    }

    return { ok: false, error: 'نوع هدف غير صالح' };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'خطأ غير متوقع' };
  }
}
