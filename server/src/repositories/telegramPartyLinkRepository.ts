import { pool } from '../db/pool.js';

export type TelegramPartyType = 'agent' | 'customer' | 'sender_receiver';

export interface TelegramPartyLinkRow {
  id: string;
  company_id: string;
  notification_bot_id: string | null;
  agent_id: string | null;
  customer_id: string | null;
  sender_receiver_id: string | null;
  chat_id: string;
  is_active: boolean;
  last_message: string | null;
  last_message_at: string | null;
  last_seen_username: string | null;
  last_seen_name: string | null;
  source_update_id: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramPartyLinkView extends TelegramPartyLinkRow {
  party_type: TelegramPartyType;
  party_id: string;
  party_name: string | null;
  bot_name: string | null;
}

export interface SaveTelegramPartyLinkInput {
  companyId: string;
  partyType: TelegramPartyType;
  partyId: string;
  chatId: string;
  notificationBotId?: string | null;
  actorUserId?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastSeenUsername?: string | null;
  lastSeenName?: string | null;
  sourceUpdateId?: number | null;
}

export class TelegramPartyLinkRepository {
  async list(companyId: string): Promise<TelegramPartyLinkView[]> {
    const result = await pool.query<TelegramPartyLinkView>(
      `
      select
        l.*,
        case
          when l.agent_id is not null then 'agent'
          when l.customer_id is not null then 'customer'
          else 'sender_receiver'
        end as party_type,
        coalesce(l.agent_id, l.customer_id, l.sender_receiver_id) as party_id,
        coalesce(a.name, c.name, sr.full_name) as party_name,
        nb.name as bot_name
      from telegram_party_links l
      left join agents a on a.id = l.agent_id
      left join customers c on c.id = l.customer_id
      left join senders_receivers sr on sr.id = l.sender_receiver_id
      left join telegram_notification_bots nb on nb.id = l.notification_bot_id
      where l.company_id = $1
      order by l.created_at desc
      `,
      [companyId],
    );
    return result.rows;
  }

  async save(input: SaveTelegramPartyLinkInput): Promise<TelegramPartyLinkView> {
    const client = await pool.connect();
    try {
      await client.query('begin');

      let agentId: string | null = null;
      let customerId: string | null = null;
      let senderReceiverId: string | null = null;
      if (input.partyType === 'agent') agentId = input.partyId;
      if (input.partyType === 'customer') customerId = input.partyId;
      if (input.partyType === 'sender_receiver') senderReceiverId = input.partyId;

      const existing = await client.query<{ id: string }>(
        `
        select id
        from telegram_party_links
        where company_id = $1
          and (
            ($2::uuid is not null and agent_id = $2::uuid)
            or ($3::uuid is not null and customer_id = $3::uuid)
            or ($4::uuid is not null and sender_receiver_id = $4::uuid)
          )
        limit 1
        `,
        [input.companyId, agentId, customerId, senderReceiverId],
      );

      let linkId: string;
      if (existing.rows[0]?.id) {
        linkId = existing.rows[0].id;
        await client.query(
          `
          update telegram_party_links
          set
            notification_bot_id = $2::uuid,
            chat_id = $3,
            is_active = true,
            last_message = coalesce($4, last_message),
            last_message_at = coalesce($5::timestamptz, last_message_at),
            last_seen_username = coalesce($6, last_seen_username),
            last_seen_name = coalesce($7, last_seen_name),
            source_update_id = coalesce($8::bigint, source_update_id),
            updated_by = $9::uuid,
            updated_at = now()
          where id = $1
          `,
          [
            linkId,
            input.notificationBotId ?? null,
            input.chatId.trim(),
            input.lastMessage ?? null,
            input.lastMessageAt ?? null,
            input.lastSeenUsername ?? null,
            input.lastSeenName ?? null,
            input.sourceUpdateId ?? null,
            input.actorUserId ?? null,
          ],
        );
      } else {
        const insert = await client.query<{ id: string }>(
          `
          insert into telegram_party_links (
            company_id, notification_bot_id,
            agent_id, customer_id, sender_receiver_id,
            chat_id, is_active,
            last_message, last_message_at, last_seen_username, last_seen_name, source_update_id,
            created_by, updated_by
          )
          values (
            $1, $2::uuid,
            $3::uuid, $4::uuid, $5::uuid,
            $6, true,
            $7, $8::timestamptz, $9, $10, $11::bigint,
            $12::uuid, $12::uuid
          )
          returning id
          `,
          [
            input.companyId,
            input.notificationBotId ?? null,
            agentId,
            customerId,
            senderReceiverId,
            input.chatId.trim(),
            input.lastMessage ?? null,
            input.lastMessageAt ?? null,
            input.lastSeenUsername ?? null,
            input.lastSeenName ?? null,
            input.sourceUpdateId ?? null,
            input.actorUserId ?? null,
          ],
        );
        linkId = insert.rows[0].id;
      }

      await client.query('commit');
      const rows = await this.list(input.companyId);
      const row = rows.find((r) => r.id === linkId);
      if (!row) throw new Error('Failed to load saved telegram party link.');
      return row;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `delete from telegram_party_links where id = $1 and company_id = $2`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findForShipment(companyId: string, shipmentId: string): Promise<Array<{
    chat_id: string;
    notification_bot_id: string | null;
    bot_token: string | null;
    party_label: string;
  }>> {
    const result = await pool.query<{
      chat_id: string;
      notification_bot_id: string | null;
      bot_token: string | null;
      party_label: string;
    }>(
      `
      with s as (
        select id, customer_id, sender_id, receiver_id
        from shipments
        where id = $2 and company_id = $1
        limit 1
      )
      select
        l.chat_id,
        l.notification_bot_id,
        nb.bot_token,
        case
          when l.customer_id is not null then 'customer'
          when l.sender_receiver_id is not null and l.sender_receiver_id = s.sender_id then 'sender'
          when l.sender_receiver_id is not null and l.sender_receiver_id = s.receiver_id then 'receiver'
          else 'party'
        end as party_label
      from s
      join telegram_party_links l
        on l.company_id = $1
       and l.is_active = true
       and (
         (l.customer_id is not null and l.customer_id = s.customer_id)
         or (l.sender_receiver_id is not null and l.sender_receiver_id in (s.sender_id, s.receiver_id))
       )
      left join telegram_notification_bots nb
        on nb.id = l.notification_bot_id
       and nb.company_id = $1
       and nb.is_active = true
      `,
      [companyId, shipmentId],
    );
    return result.rows;
  }
}

