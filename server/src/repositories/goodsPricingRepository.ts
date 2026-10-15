import { pool } from '../db/pool.js';

export type PricingUnit = 'parcel' | 'kg';

export interface GroupRow {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  general_unit: PricingUnit | null;
  general_price_usd: string | null;
  member_count: number;
  vip_count: number;
}

export class GoodsPricingRepository {
  // ── groups ────────────────────────────────────────────────────────────
  async listGroups(): Promise<GroupRow[]> {
    const { rows } = await pool.query(
      `
      select
        g.id, g.name, g.is_active, g.notes,
        gp.pricing_unit as general_unit,
        gp.unit_price_usd as general_price_usd,
        (select count(*) from goods_pricing_group_members m where m.group_id = g.id) as member_count,
        (select count(*) from party_goods_prices pp where pp.group_id = g.id and pp.is_active) as vip_count
      from goods_pricing_groups g
      left join goods_group_prices gp on gp.group_id = g.id and gp.is_active
      order by g.is_active desc, g.name asc
      `,
    );
    return rows;
  }

  async getGroupByNormalizedName(nameNormalized: string): Promise<{ id: string } | null> {
    const { rows } = await pool.query(
      `select id from goods_pricing_groups where name_normalized = $1 and is_active limit 1`,
      [nameNormalized],
    );
    return rows[0] ?? null;
  }

  async createGroup(input: { name: string; nameNormalized: string; notes?: string | null; userId?: string | null }) {
    const { rows } = await pool.query(
      `
      insert into goods_pricing_groups (name, name_normalized, notes, created_by, updated_by)
      values ($1, $2, $3, $4, $4)
      returning id, name, is_active, notes
      `,
      [input.name, input.nameNormalized, input.notes ?? null, input.userId ?? null],
    );
    return rows[0];
  }

  async updateGroup(id: string, input: { name?: string; nameNormalized?: string; notes?: string | null; isActive?: boolean; userId?: string | null }) {
    const { rows } = await pool.query(
      `
      update goods_pricing_groups set
        name            = coalesce($2, name),
        name_normalized = coalesce($3, name_normalized),
        notes           = coalesce($4, notes),
        is_active       = coalesce($5, is_active),
        updated_by      = $6,
        updated_at      = now()
      where id = $1
      returning id, name, is_active, notes
      `,
      [id, input.name ?? null, input.nameNormalized ?? null, input.notes ?? null, input.isActive ?? null, input.userId ?? null],
    );
    return rows[0] ?? null;
  }

  // ── membership ────────────────────────────────────────────────────────
  async addMembers(groupId: string, goodsTypeIds: string[], userId?: string | null) {
    if (goodsTypeIds.length === 0) return 0;
    const { rowCount } = await pool.query(
      `
      insert into goods_pricing_group_members (goods_type_id, group_id, created_by)
      select unnest($2::uuid[]), $1, $3
      on conflict (goods_type_id) do update set group_id = excluded.group_id, created_by = excluded.created_by
      `,
      [groupId, goodsTypeIds, userId ?? null],
    );
    return rowCount ?? 0;
  }

  async removeMember(groupId: string, goodsTypeId: string) {
    await pool.query(`delete from goods_pricing_group_members where group_id = $1 and goods_type_id = $2`, [groupId, goodsTypeId]);
  }

  async listUnclassified(search: string | undefined, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const likeParam = search ? `%${search.trim()}%` : null;
    const { rows } = await pool.query(
      `
      with usage as (
        select lower(trim(parcel_type)) as name_key, count(*) as rows_count
        from daily_ledger_rows
        where deleted_at is null and parcel_type is not null and trim(parcel_type) <> ''
        group by 1
      )
      select gt.id, gt.name, coalesce(u.rows_count, 0) as rows_count
      from goods_types gt
      left join goods_pricing_group_members m on m.goods_type_id = gt.id
      left join usage u on u.name_key = lower(trim(gt.name))
      where m.goods_type_id is null
        and ($1::text is null or gt.name ilike $1)
      order by coalesce(u.rows_count, 0) desc, gt.name asc
      limit $2 offset $3
      `,
      [likeParam, pageSize, offset],
    );
    const { rows: countRows } = await pool.query(
      `
      select count(*) as total
      from goods_types gt
      left join goods_pricing_group_members m on m.goods_type_id = gt.id
      where m.goods_type_id is null
        and ($1::text is null or gt.name ilike $1)
      `,
      [likeParam],
    );
    return { rows, total: Number(countRows[0]?.total ?? 0) };
  }

  async getCoverage(): Promise<{ totalRows: number; classifiedRows: number; pricedRows: number }> {
    const { rows } = await pool.query(
      `
      with usage as (
        select lower(trim(parcel_type)) as name_key, count(*) as rows_count
        from daily_ledger_rows
        where deleted_at is null
        group by 1
      ),
      mapped as (
        select u.name_key, u.rows_count, m.group_id
        from usage u
        left join goods_types gt on lower(trim(gt.name)) = u.name_key
        left join goods_pricing_group_members m on m.goods_type_id = gt.id
      )
      select
        (select count(*) from daily_ledger_rows where deleted_at is null) as total_rows,
        coalesce(sum(rows_count) filter (where group_id is not null), 0) as classified_rows,
        coalesce(sum(rows_count) filter (where group_id in (select group_id from goods_group_prices where is_active)), 0) as priced_rows
      from mapped
      `,
    );
    const r = rows[0] ?? {};
    return {
      totalRows: Number(r.total_rows ?? 0),
      classifiedRows: Number(r.classified_rows ?? 0),
      pricedRows: Number(r.priced_rows ?? 0),
    };
  }

  // ── general prices ───────────────────────────────────────────────────
  async getActiveGroupPrice(groupId: string) {
    const { rows } = await pool.query(
      `select id, pricing_unit, unit_price_usd from goods_group_prices where group_id = $1 and is_active limit 1`,
      [groupId],
    );
    return rows[0] ?? null;
  }

  async setGroupPrice(groupId: string, input: { pricingUnit: PricingUnit; unitPriceUsd: string; userId?: string | null }) {
    await pool.query(`update goods_group_prices set is_active = false, updated_by = $2 where group_id = $1 and is_active`, [
      groupId,
      input.userId ?? null,
    ]);
    const { rows } = await pool.query(
      `
      insert into goods_group_prices (group_id, pricing_unit, unit_price_usd, created_by, updated_by)
      values ($1, $2, $3, $4, $4)
      returning id, pricing_unit, unit_price_usd
      `,
      [groupId, input.pricingUnit, input.unitPriceUsd, input.userId ?? null],
    );
    return rows[0];
  }

  async deactivateGroupPrice(groupId: string, userId?: string | null) {
    await pool.query(`update goods_group_prices set is_active = false, updated_by = $2 where group_id = $1 and is_active`, [
      groupId,
      userId ?? null,
    ]);
  }

  // ── parties / VIP prices ─────────────────────────────────────────────
  async searchParties(search: string | undefined, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    if (search && search.trim().length >= 2) {
      const likeParam = `%${search.trim()}%`;
      const { rows } = await pool.query(
        `
        select s.id, s.full_name, s.city,
          (select count(*) from party_goods_prices p where p.party_id = s.id and p.is_active) as vip_price_count
        from senders_receivers s
        where s.full_name ilike $1
        order by vip_price_count desc, s.full_name asc
        limit $2 offset $3
        `,
        [likeParam, pageSize, offset],
      );
      return rows;
    }
    const { rows } = await pool.query(
      `
      select s.id, s.full_name, s.city,
        (select count(*) from party_goods_prices p where p.party_id = s.id and p.is_active) as vip_price_count
      from senders_receivers s
      where exists (select 1 from party_goods_prices p where p.party_id = s.id and p.is_active)
      order by vip_price_count desc, s.full_name asc
      limit $1 offset $2
      `,
      [pageSize, offset],
    );
    return rows;
  }

  async getPartyPrices(partyId: string) {
    const { rows } = await pool.query(
      `
      select p.id, p.group_id, g.name as group_name, p.pricing_unit, p.unit_price_usd, p.is_active,
        gp.pricing_unit as general_unit, gp.unit_price_usd as general_price_usd
      from party_goods_prices p
      join goods_pricing_groups g on g.id = p.group_id
      left join goods_group_prices gp on gp.group_id = p.group_id and gp.is_active
      where p.party_id = $1 and p.is_active
      order by g.name asc
      `,
      [partyId],
    );
    return rows;
  }

  async setPartyPrice(partyId: string, groupId: string, input: { pricingUnit: PricingUnit; unitPriceUsd: string; userId?: string | null }) {
    await pool.query(`update party_goods_prices set is_active = false, updated_by = $3 where party_id = $1 and group_id = $2 and is_active`, [
      partyId,
      groupId,
      input.userId ?? null,
    ]);
    const { rows } = await pool.query(
      `
      insert into party_goods_prices (party_id, group_id, pricing_unit, unit_price_usd, created_by, updated_by)
      values ($1, $2, $3, $4, $5, $5)
      returning id, pricing_unit, unit_price_usd
      `,
      [partyId, groupId, input.pricingUnit, input.unitPriceUsd, input.userId ?? null],
    );
    return rows[0];
  }

  async deactivatePartyPrice(partyId: string, groupId: string, userId?: string | null) {
    await pool.query(`update party_goods_prices set is_active = false, updated_by = $3 where party_id = $1 and group_id = $2 and is_active`, [
      partyId,
      groupId,
      userId ?? null,
    ]);
  }

  // ── history ───────────────────────────────────────────────────────────
  async recordHistory(input: {
    scope: 'general' | 'party';
    groupId: string;
    partyId?: string | null;
    oldUnitPriceUsd?: string | null;
    newUnitPriceUsd?: string | null;
    oldPricingUnit?: string | null;
    newPricingUnit?: string | null;
    action: 'create' | 'update' | 'deactivate';
    userId?: string | null;
  }) {
    await pool.query(
      `
      insert into goods_price_history
        (scope, group_id, party_id, old_unit_price_usd, new_unit_price_usd, old_pricing_unit, new_pricing_unit, action, changed_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        input.scope,
        input.groupId,
        input.partyId ?? null,
        input.oldUnitPriceUsd ?? null,
        input.newUnitPriceUsd ?? null,
        input.oldPricingUnit ?? null,
        input.newPricingUnit ?? null,
        input.action,
        input.userId ?? null,
      ],
    );
  }

  async listHistory(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const { rows } = await pool.query(
      `
      select h.id, h.scope, h.group_id, g.name as group_name, h.party_id, s.full_name as party_name,
        h.old_unit_price_usd, h.new_unit_price_usd, h.old_pricing_unit, h.new_pricing_unit,
        h.action, h.changed_at, u.username as changed_by_username
      from goods_price_history h
      left join goods_pricing_groups g on g.id = h.group_id
      left join senders_receivers s on s.id = h.party_id
      left join users u on u.id = h.changed_by
      order by h.changed_at desc
      limit $1 offset $2
      `,
      [pageSize, offset],
    );
    return rows;
  }

  // ── resolve-context raw data (feeds the in-memory cache) ─────────────
  async loadTypeToGroupRows(): Promise<Array<{ name: string; group_id: string }>> {
    const { rows } = await pool.query(
      `
      select gt.name, m.group_id
      from goods_pricing_group_members m
      join goods_types gt on gt.id = m.goods_type_id
      join goods_pricing_groups g on g.id = m.group_id and g.is_active
      `,
    );
    return rows;
  }

  async loadGeneralPriceRows(): Promise<Array<{ group_id: string; pricing_unit: PricingUnit; unit_price_usd: string }>> {
    const { rows } = await pool.query(`select group_id, pricing_unit, unit_price_usd from goods_group_prices where is_active`);
    return rows;
  }

  async loadPartyPriceRows(): Promise<Array<{ party_id: string; group_id: string; pricing_unit: PricingUnit; unit_price_usd: string }>> {
    const { rows } = await pool.query(`select party_id, group_id, pricing_unit, unit_price_usd from party_goods_prices where is_active`);
    return rows;
  }

  async loadPartyNameRows(): Promise<Array<{ id: string; full_name: string }>> {
    const { rows } = await pool.query(`select id, full_name from senders_receivers`);
    return rows;
  }
}
