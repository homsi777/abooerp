import { HttpError } from '../../utils/errors.js';
import { GoodsPricingRepository, type PricingUnit } from '../../repositories/goodsPricingRepository.js';
import { normalizeName } from '../dailyLedgerShipmentPostingService.js';
import { getResolveContext, invalidateResolveContext } from './cache.js';
import {
  resolvePrice,
  computeLineTotal,
  decimalStringToCents,
  centsToDecimalString,
  type ResolveResult,
} from './resolve.js';

export class GoodsPricingService {
  constructor(private readonly repo: GoodsPricingRepository) {}

  // ── validation helpers ──────────────────────────────────────────────
  private assertUnitPrice(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new HttpError(400, 'السعر مطلوب ويجب أن يكون رقماً.');
    }
    try {
      const cents = decimalStringToCents(value);
      return centsToDecimalString(cents);
    } catch {
      throw new HttpError(400, 'السعر يجب أن يكون رقماً غير سالب وبحد أقصى رقمين عشريين.');
    }
  }

  private assertPricingUnit(value: unknown): PricingUnit {
    if (value === 'parcel' || value === 'kg') return value;
    throw new HttpError(400, "وحدة التسعير يجب أن تكون 'parcel' أو 'kg'.");
  }

  // ── groups management ───────────────────────────────────────────────
  async listGroups() {
    return this.repo.listGroups();
  }

  async createGroup(input: { name: string; notes?: string | null }, userId?: string | null) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new HttpError(400, 'اسم المجموعة مطلوب.');
    const nameNormalized = normalizeName(name).toLowerCase();
    const existing = await this.repo.getGroupByNormalizedName(nameNormalized);
    if (existing) throw new HttpError(409, 'توجد مجموعة نشطة بهذا الاسم.');
    const created = await this.repo.createGroup({ name, nameNormalized, notes: input.notes ?? null, userId });
    return created;
  }

  async updateGroup(id: string, input: { name?: string; notes?: string | null; isActive?: boolean }, userId?: string | null) {
    const patch: Parameters<GoodsPricingRepository['updateGroup']>[1] = { userId };
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new HttpError(400, 'اسم المجموعة مطلوب.');
      patch.name = name;
      patch.nameNormalized = normalizeName(name).toLowerCase();
    }
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    const updated = await this.repo.updateGroup(id, patch);
    if (!updated) throw new HttpError(404, 'المجموعة غير موجودة.');
    invalidateResolveContext();
    return updated;
  }

  // ── membership ───────────────────────────────────────────────────────
  async addMembers(groupId: string, goodsTypeIds: string[], userId?: string | null) {
    if (!Array.isArray(goodsTypeIds) || goodsTypeIds.length === 0) {
      throw new HttpError(400, 'يجب تحديد صنف واحد على الأقل.');
    }
    await this.repo.addMembers(groupId, goodsTypeIds, userId);
    invalidateResolveContext();
  }

  async removeMember(groupId: string, goodsTypeId: string) {
    await this.repo.removeMember(groupId, goodsTypeId);
    invalidateResolveContext();
  }

  async listUnclassified(search: string | undefined, page: number, pageSize: number) {
    return this.repo.listUnclassified(search, page, pageSize);
  }

  async getCoverage() {
    const c = await this.repo.getCoverage();
    const pct = (n: number) => (c.totalRows > 0 ? Math.round((n / c.totalRows) * 10000) / 100 : 0);
    return {
      totalRows: c.totalRows,
      classifiedRows: c.classifiedRows,
      pricedRows: c.pricedRows,
      classifiedPct: pct(c.classifiedRows),
      pricedPct: pct(c.pricedRows),
    };
  }

  // ── general prices ──────────────────────────────────────────────────
  async setGroupPrice(groupId: string, input: { pricingUnit: unknown; unitPriceUsd: unknown }, userId?: string | null) {
    const pricingUnit = this.assertPricingUnit(input.pricingUnit);
    const unitPriceUsd = this.assertUnitPrice(input.unitPriceUsd);
    const existing = await this.repo.getActiveGroupPrice(groupId);
    const saved = await this.repo.setGroupPrice(groupId, { pricingUnit, unitPriceUsd, userId });
    await this.repo.recordHistory({
      scope: 'general',
      groupId,
      oldUnitPriceUsd: existing?.unit_price_usd ?? null,
      newUnitPriceUsd: unitPriceUsd,
      oldPricingUnit: existing?.pricing_unit ?? null,
      newPricingUnit: pricingUnit,
      action: existing ? 'update' : 'create',
      userId,
    });
    invalidateResolveContext();
    return saved;
  }

  async deactivateGroupPrice(groupId: string, userId?: string | null) {
    const existing = await this.repo.getActiveGroupPrice(groupId);
    if (!existing) throw new HttpError(404, 'لا يوجد سعر عام نشط لهذه المجموعة.');
    await this.repo.deactivateGroupPrice(groupId, userId);
    await this.repo.recordHistory({
      scope: 'general',
      groupId,
      oldUnitPriceUsd: existing.unit_price_usd,
      oldPricingUnit: existing.pricing_unit,
      action: 'deactivate',
      userId,
    });
    invalidateResolveContext();
  }

  // ── parties / VIP ────────────────────────────────────────────────────
  async searchParties(search: string | undefined, page: number, pageSize: number) {
    return this.repo.searchParties(search, page, pageSize);
  }

  async getPartyPrices(partyId: string) {
    return this.repo.getPartyPrices(partyId);
  }

  async setPartyPrice(partyId: string, groupId: string, input: { pricingUnit: unknown; unitPriceUsd: unknown }, userId?: string | null) {
    const pricingUnit = this.assertPricingUnit(input.pricingUnit);
    const unitPriceUsd = this.assertUnitPrice(input.unitPriceUsd);
    const existingList = await this.repo.getPartyPrices(partyId);
    const existing = existingList.find((p: any) => p.group_id === groupId);
    const saved = await this.repo.setPartyPrice(partyId, groupId, { pricingUnit, unitPriceUsd, userId });
    await this.repo.recordHistory({
      scope: 'party',
      groupId,
      partyId,
      oldUnitPriceUsd: existing?.unit_price_usd ?? null,
      newUnitPriceUsd: unitPriceUsd,
      oldPricingUnit: existing?.pricing_unit ?? null,
      newPricingUnit: pricingUnit,
      action: existing ? 'update' : 'create',
      userId,
    });
    invalidateResolveContext();
    return saved;
  }

  async deactivatePartyPrice(partyId: string, groupId: string, userId?: string | null) {
    const existingList = await this.repo.getPartyPrices(partyId);
    const existing = existingList.find((p: any) => p.group_id === groupId);
    if (!existing) throw new HttpError(404, 'لا يوجد سعر خاص نشط لهذا العميل في هذه المجموعة.');
    await this.repo.deactivatePartyPrice(partyId, groupId, userId);
    await this.repo.recordHistory({
      scope: 'party',
      groupId,
      partyId,
      oldUnitPriceUsd: existing.unit_price_usd,
      oldPricingUnit: existing.pricing_unit,
      action: 'deactivate',
      userId,
    });
    invalidateResolveContext();
  }

  async listHistory(page: number, pageSize: number) {
    return this.repo.listHistory(page, pageSize);
  }

  // ── ledger lookup (read-only, never creates goods_types/senders_receivers) ──
  async resolveForLedger(input: {
    parcelType?: string | null;
    senderName?: string | null;
    receiverName?: string | null;
    parcelCount?: number | null;
    weightKg?: string | number | null;
  }) {
    const ctx = await getResolveContext(this.repo);
    const result = resolvePrice(
      {
        parcelTypeNorm: normalizeName(input.parcelType).toLowerCase(),
        senderNorm: normalizeName(input.senderName).toLowerCase(),
        receiverNorm: normalizeName(input.receiverName).toLowerCase(),
      },
      ctx,
    );
    return this.formatResolveResult(result, input.parcelCount ?? null, input.weightKg ?? null);
  }

  private formatResolveResult(
    result: ResolveResult,
    parcelCount: number | null,
    weightKg: string | number | null,
  ) {
    const unit = result.unit ?? 'parcel';
    const totalCents =
      result.status === 'priced' && result.unitPriceCents != null
        ? computeLineTotal(unit, parcelCount, weightKg, result.unitPriceCents)
        : null;
    return {
      status: result.status,
      conflict: result.status === 'conflict',
      groupId: result.groupId ?? null,
      partyId: result.partyId ?? null,
      unit: result.unit ?? null,
      unitPriceUsd: result.unitPriceCents != null ? centsToDecimalString(result.unitPriceCents) : null,
      source: result.source ?? null,
      senderAmbiguous: result.senderAmbiguous,
      receiverAmbiguous: result.receiverAmbiguous,
      lineTotalUsd: totalCents != null ? centsToDecimalString(totalCents) : null,
    };
  }

  /**
   * Server-authoritative snapshot computation for POST /rows/upsert.
   * `keyFieldsChanged` = true on INSERT, or on UPDATE when parcel_type /
   * sender_name / receiver_name differ from the stored row (Section 6.3).
   */
  async computeSaveSnapshot(input: {
    parcelType: string | null | undefined;
    senderName: string | null | undefined;
    receiverName: string | null | undefined;
    parcelCount?: number | null;
    weightKg?: string | number | null;
    keyFieldsChanged: boolean;
    existingSnapshot: {
      pricingGroupId: string | null;
      pricingPartyId: string | null;
      pricingUnit: PricingUnit | null;
      unitPriceUsd: string | null;
      priceSource: string | null;
      suggestedUnitPriceUsd: string | null;
    } | null;
    clientUnitPriceUsd?: unknown;
    clientPricingUnit?: unknown;
  }) {
    const hasClientPrice = input.clientUnitPriceUsd !== undefined && input.clientUnitPriceUsd !== null && input.clientUnitPriceUsd !== '';
    let clientUnitPriceUsd: string | null = null;
    if (hasClientPrice) clientUnitPriceUsd = this.assertUnitPrice(input.clientUnitPriceUsd);
    const clientPricingUnit: PricingUnit = input.clientPricingUnit ? this.assertPricingUnit(input.clientPricingUnit) : 'parcel';

    let pricingGroupId: string | null = null;
    let pricingPartyId: string | null = null;
    let pricingUnit: PricingUnit | null = null;
    let unitPriceUsd: string | null = null;
    let priceSource: 'party' | 'general' | 'manual' | null = null;
    let suggestedUnitPriceUsd: string | null = null;

    const shouldResolve = input.keyFieldsChanged || !input.existingSnapshot;

    if (shouldResolve) {
      const ctx = await getResolveContext(this.repo);
      const resolved = resolvePrice(
        {
          parcelTypeNorm: normalizeName(input.parcelType).toLowerCase(),
          senderNorm: normalizeName(input.senderName).toLowerCase(),
          receiverNorm: normalizeName(input.receiverName).toLowerCase(),
        },
        ctx,
      );
      pricingGroupId = resolved.groupId ?? null;
      pricingPartyId = resolved.partyId ?? null;
      suggestedUnitPriceUsd = resolved.unitPriceCents != null ? centsToDecimalString(resolved.unitPriceCents) : null;

      if (hasClientPrice) {
        const suggestionMatches =
          resolved.status === 'priced' &&
          suggestedUnitPriceUsd === clientUnitPriceUsd &&
          (resolved.unit ?? 'parcel') === clientPricingUnit;
        if (suggestionMatches) {
          pricingUnit = resolved.unit ?? 'parcel';
          unitPriceUsd = clientUnitPriceUsd;
          priceSource = resolved.source ?? 'general';
        } else {
          pricingUnit = clientPricingUnit;
          unitPriceUsd = clientUnitPriceUsd;
          priceSource = 'manual';
        }
      } else if (resolved.status === 'priced') {
        pricingUnit = resolved.unit ?? 'parcel';
        unitPriceUsd = suggestedUnitPriceUsd;
        priceSource = resolved.source ?? 'general';
      }
      // else: no price at all, leave NULLs (row stays valid, as today).
    } else {
      // No key-field change: keep the stored snapshot untouched UNLESS the
      // client explicitly sent a different manual price/unit (Section 6.3.b).
      const existing = input.existingSnapshot!;
      pricingGroupId = existing.pricingGroupId;
      pricingPartyId = existing.pricingPartyId;
      pricingUnit = existing.pricingUnit;
      unitPriceUsd = existing.unitPriceUsd;
      priceSource = existing.priceSource as 'party' | 'general' | 'manual' | null;
      suggestedUnitPriceUsd = existing.suggestedUnitPriceUsd;

      if (hasClientPrice && (clientUnitPriceUsd !== existing.unitPriceUsd || clientPricingUnit !== existing.pricingUnit)) {
        pricingUnit = clientPricingUnit;
        unitPriceUsd = clientUnitPriceUsd;
        priceSource = 'manual';
      }
    }

    let lineTotalUsd: string | null = null;
    if (unitPriceUsd != null && pricingUnit) {
      const totalCents = computeLineTotal(pricingUnit, input.parcelCount ?? null, input.weightKg ?? null, decimalStringToCents(unitPriceUsd));
      lineTotalUsd = totalCents != null ? centsToDecimalString(totalCents) : null;
    }

    return {
      pricingGroupId,
      pricingPartyId,
      pricingUnit,
      unitPriceUsd,
      priceSource,
      suggestedUnitPriceUsd,
      lineTotalUsd,
    };
  }
}
