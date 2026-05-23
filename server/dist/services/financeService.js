import { HttpError } from '../utils/errors.js';
import { computeBaseAmountUsd } from '../utils/money.js';
import { env } from '../config/env.js';
import { ExchangeRateRepository } from '../repositories/exchangeRateRepository.js';
const allowedVoucherTransitions = {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['cancelled'],
    cancelled: [],
};
const DASHBOARD_CACHE_TTL_MS = env.DASHBOARD_CACHE_TTL_MS;
export class FinanceService {
    repository;
    dashboardPackageCache = new Map();
    dashboardPackageInFlight = new Map();
    dashboardCacheMetrics = {
        hits: 0,
        misses: 0,
        inFlightHits: 0,
        sets: 0,
        invalidations: 0,
        evictions: 0,
    };
    dashboardCacheResetAudit = [];
    resetDashboardCacheMetrics() {
        this.dashboardCacheMetrics.hits = 0;
        this.dashboardCacheMetrics.misses = 0;
        this.dashboardCacheMetrics.inFlightHits = 0;
        this.dashboardCacheMetrics.sets = 0;
        this.dashboardCacheMetrics.invalidations = 0;
        this.dashboardCacheMetrics.evictions = 0;
    }
    exchangeRateRepository = new ExchangeRateRepository();
    constructor(repository) {
        this.repository = repository;
    }
    async resolveExchangeRateToUsd(options) {
        const normalizedCurrency = String(options.originalCurrency || '').toUpperCase();
        const baseCurrency = String(options.baseCurrency || 'USD').toUpperCase();
        if (!normalizedCurrency) {
            throw new HttpError(400, 'originalCurrency is required.');
        }
        if (normalizedCurrency === baseCurrency) {
            return 1;
        }
        if (typeof options.exchangeRateToUsd === 'number' && options.exchangeRateToUsd > 0) {
            return options.exchangeRateToUsd;
        }
        if (!options.companyId) {
            throw new HttpError(400, 'Missing company scope to resolve exchange rate.');
        }
        const atDate = options.effectiveDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
        const byDate = await this.exchangeRateRepository.getRateByDateByCode(normalizedCurrency, atDate, options.companyId);
        if (byDate && byDate.rate > 0) {
            return byDate.rate;
        }
        const latest = await this.exchangeRateRepository.getLatestRateByCode(normalizedCurrency, options.companyId);
        if (latest && latest.rate > 0) {
            return latest.rate;
        }
        throw new HttpError(400, `Missing exchange rate for currency ${normalizedCurrency}.`);
    }
    buildDashboardCacheKey(scope, options) {
        const normalizedTabs = [...(options?.tabs?.length ? options.tabs : ['statement', 'comparison', 'analytics'])].sort();
        return JSON.stringify({
            scope: {
                branchId: scope?.branchId ?? null,
                agentId: scope?.agentId ?? null,
            },
            filters: {
                partyType: options?.partyType ?? null,
                partyId: options?.partyId ?? null,
                fromAt: options?.fromAt ?? null,
                toAt: options?.toAt ?? null,
                includeReversals: options?.includeReversals ?? true,
                page: options?.page ?? 1,
                pageSize: options?.pageSize ?? 25,
                topN: options?.topN ?? 5,
                comparisonFromAt: options?.comparisonFromAt ?? null,
                comparisonToAt: options?.comparisonToAt ?? null,
            },
            tabs: normalizedTabs,
        });
    }
    getDashboardCache(key) {
        const existing = this.dashboardPackageCache.get(key);
        if (!existing)
            return null;
        if (Date.now() >= existing.expiresAt) {
            this.dashboardPackageCache.delete(key);
            this.dashboardCacheMetrics.evictions += 1;
            return null;
        }
        return existing.value;
    }
    setDashboardCache(key, value) {
        this.dashboardPackageCache.set(key, {
            value,
            expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
        });
        this.dashboardCacheMetrics.sets += 1;
    }
    clearDashboardCache(trackInvalidation = true) {
        if (trackInvalidation) {
            this.dashboardCacheMetrics.invalidations += 1;
        }
        this.dashboardPackageCache.clear();
        this.dashboardPackageInFlight.clear();
    }
    invalidateDashboardCache() {
        this.clearDashboardCache(true);
    }
    buildDashboardCacheMetricsSnapshot() {
        return {
            ttlMs: DASHBOARD_CACHE_TTL_MS,
            resetControl: {
                enabled: env.DASHBOARD_CACHE_RESET_ENABLED,
                requireConfirm: env.DASHBOARD_CACHE_RESET_REQUIRE_CONFIRM,
            },
            cacheEntries: this.dashboardPackageCache.size,
            inFlightEntries: this.dashboardPackageInFlight.size,
            counters: { ...this.dashboardCacheMetrics },
        };
    }
    async persistDashboardCacheMetrics() {
        await this.repository.saveDashboardCacheMetricsState(this.buildDashboardCacheMetricsSnapshot());
    }
    async getDashboardCacheMetrics() {
        const persisted = await this.repository.getDashboardCacheMetricsState();
        if (!persisted) {
            const snapshot = this.buildDashboardCacheMetricsSnapshot();
            await this.repository.saveDashboardCacheMetricsState(snapshot);
            return snapshot;
        }
        return {
            ttlMs: Number(persisted.ttl_ms),
            resetControl: {
                enabled: Boolean(persisted.reset_enabled),
                requireConfirm: Boolean(persisted.reset_require_confirm),
            },
            cacheEntries: Number(persisted.cache_entries),
            inFlightEntries: Number(persisted.in_flight_entries),
            counters: {
                hits: Number(persisted.hits),
                misses: Number(persisted.misses),
                inFlightHits: Number(persisted.in_flight_hits),
                sets: Number(persisted.sets),
                invalidations: Number(persisted.invalidations),
                evictions: Number(persisted.evictions),
            },
        };
    }
    async getDashboardCacheResetAudit(limit = 20) {
        return this.repository.listDashboardCacheResetAudit(limit);
    }
    async resetDashboardCacheState(options, context) {
        const resetCache = options?.resetCache ?? true;
        const resetMetrics = options?.resetMetrics ?? true;
        const confirm = options?.confirm ?? false;
        const before = await this.getDashboardCacheMetrics();
        const logResetAudit = async (entry) => {
            const payload = {
                userId: entry.userId,
                scope: entry.scope,
                resetCache: entry.resetCache,
                resetMetrics: entry.resetMetrics,
                confirm: entry.confirm,
                outcome: entry.outcome,
                reason: entry.reason,
            };
            await this.repository.logDashboardCacheResetAudit(payload);
        };
        if (!env.DASHBOARD_CACHE_RESET_ENABLED) {
            await logResetAudit({
                at: new Date().toISOString(),
                userId: context?.userId,
                scope: {
                    branchId: context?.scope?.branchId,
                    agentId: context?.scope?.agentId,
                },
                resetCache,
                resetMetrics,
                confirm,
                outcome: 'blocked',
                reason: 'reset_disabled_by_env',
            });
            throw new HttpError(403, 'Dashboard cache reset is disabled by configuration.');
        }
        if (env.DASHBOARD_CACHE_RESET_REQUIRE_CONFIRM && !confirm) {
            await logResetAudit({
                at: new Date().toISOString(),
                userId: context?.userId,
                scope: {
                    branchId: context?.scope?.branchId,
                    agentId: context?.scope?.agentId,
                },
                resetCache,
                resetMetrics,
                confirm,
                outcome: 'blocked',
                reason: 'confirmation_required',
            });
            throw new HttpError(403, 'Dashboard cache reset requires explicit confirm=true.');
        }
        if (resetCache) {
            this.clearDashboardCache(false);
        }
        if (resetMetrics) {
            this.resetDashboardCacheMetrics();
        }
        await logResetAudit({
            at: new Date().toISOString(),
            userId: context?.userId,
            scope: {
                branchId: context?.scope?.branchId,
                agentId: context?.scope?.agentId,
            },
            resetCache,
            resetMetrics,
            confirm,
            outcome: 'success',
        });
        await this.persistDashboardCacheMetrics();
        return {
            resetCache,
            resetMetrics,
            confirm,
            before,
            after: await this.getDashboardCacheMetrics(),
        };
    }
    listReceiptVouchers(scope, filters) {
        return this.repository.listReceiptVouchers(scope, filters);
    }
    getReceiptVoucherById(id, scope) {
        return this.repository.getReceiptVoucherById(id, scope);
    }
    listPaymentVouchers(scope) {
        return this.repository.listPaymentVouchers(scope);
    }
    getPaymentVoucherById(id, scope) {
        return this.repository.getPaymentVoucherById(id, scope);
    }
    listCashboxTransactions(scope) {
        return this.repository.listCashboxTransactions(scope);
    }
    listPartyFinancialMovements(scope) {
        return this.repository.listPartyFinancialMovements(scope);
    }
    getPartyStatementSummary(scope, filters) {
        return this.repository.getPartyStatementSummary(scope, filters);
    }
    listPartyStatementEntries(scope, filters) {
        return this.repository.listPartyStatementEntries(scope, filters);
    }
    listPartyLedger(scope, filters) {
        return this.repository.listPartyLedger(scope, filters);
    }
    getPartyCurrencySummary(scope, filters) {
        return this.repository.getPartyCurrencySummary(scope, filters);
    }
    async getPartyStatementPackage(scope, filters) {
        const [summary, currencySummary, ledger] = await Promise.all([
            this.repository.getPartyStatementSummary(scope, filters),
            this.repository.getPartyCurrencySummary(scope, filters),
            this.repository.listPartyLedger(scope, filters),
        ]);
        return {
            summary,
            currencySummary,
            ledger,
        };
    }
    async getPartyStatementComparison(scope, filters) {
        if (!filters?.fromAt || !filters?.toAt) {
            throw new HttpError(400, 'fromAt and toAt are required for statement comparison.');
        }
        const currentFromMs = Date.parse(filters.fromAt);
        const currentToMs = Date.parse(filters.toAt);
        if (Number.isNaN(currentFromMs) || Number.isNaN(currentToMs) || currentToMs < currentFromMs) {
            throw new HttpError(400, 'Invalid comparison period range.');
        }
        const durationMs = currentToMs - currentFromMs;
        const previousToMs = currentFromMs - 1;
        const previousFromMs = previousToMs - durationMs;
        const previousFilters = {
            ...filters,
            fromAt: new Date(previousFromMs).toISOString(),
            toAt: new Date(previousToMs).toISOString(),
        };
        const [current, previous] = await Promise.all([
            this.repository.getPartyStatementSummary(scope, filters),
            this.repository.getPartyStatementSummary(scope, previousFilters),
        ]);
        const currentClosing = Number(current?.closing_balance_usd || 0);
        const previousClosing = Number(previous?.closing_balance_usd || 0);
        return {
            currentPeriod: {
                fromAt: filters.fromAt,
                toAt: filters.toAt,
                summary: current,
            },
            previousPeriod: {
                fromAt: previousFilters.fromAt,
                toAt: previousFilters.toAt,
                summary: previous,
            },
            delta: {
                closing_balance_usd: currentClosing - previousClosing,
                current_closing_balance_usd: currentClosing,
                previous_closing_balance_usd: previousClosing,
            },
        };
    }
    getPartyAnalyticsSnapshot(scope, filters) {
        return this.repository.getPartyAnalyticsSnapshot(scope, filters);
    }
    async getPartyDashboardPackage(scope, options) {
        const cacheKey = this.buildDashboardCacheKey(scope, options);
        const cached = this.getDashboardCache(cacheKey);
        if (cached) {
            this.dashboardCacheMetrics.hits += 1;
            await this.persistDashboardCacheMetrics();
            return cached;
        }
        this.dashboardCacheMetrics.misses += 1;
        await this.persistDashboardCacheMetrics();
        const pending = this.dashboardPackageInFlight.get(cacheKey);
        if (pending) {
            this.dashboardCacheMetrics.inFlightHits += 1;
            await this.persistDashboardCacheMetrics();
            return pending;
        }
        const tabs = new Set(options?.tabs?.length ? options.tabs : ['statement', 'comparison', 'analytics']);
        const task = (async () => {
            const statementPromise = tabs.has('statement')
                ? this.getPartyStatementPackage(scope, options)
                : Promise.resolve(null);
            const analyticsPromise = tabs.has('analytics')
                ? this.getPartyAnalyticsSnapshot(scope, options)
                : Promise.resolve(null);
            const comparisonPromise = tabs.has('comparison')
                ? this.getPartyStatementComparison(scope, {
                    ...options,
                    fromAt: options?.comparisonFromAt,
                    toAt: options?.comparisonToAt,
                })
                : Promise.resolve(null);
            const [statement, analytics, comparison] = await Promise.all([
                statementPromise,
                analyticsPromise,
                comparisonPromise,
            ]);
            return {
                tabs: {
                    statement: tabs.has('statement'),
                    analytics: tabs.has('analytics'),
                    comparison: tabs.has('comparison'),
                },
                statement,
                analytics,
                comparison,
            };
        })();
        this.dashboardPackageInFlight.set(cacheKey, task);
        try {
            const result = await task;
            this.setDashboardCache(cacheKey, result);
            await this.persistDashboardCacheMetrics();
            return result;
        }
        finally {
            this.dashboardPackageInFlight.delete(cacheKey);
            await this.persistDashboardCacheMetrics();
        }
    }
    async createReceiptVoucher(input, scope, fxContext) {
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot create receipt voucher outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot create receipt voucher outside scoped agent.');
        }
        const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
            originalCurrency: input.originalCurrency,
            exchangeRateToUsd: input.exchangeRateToUsd,
            companyId: fxContext?.companyId,
            effectiveDate: fxContext?.effectiveDate,
            baseCurrency: fxContext?.baseCurrency,
        });
        const payload = {
            ...input,
            status: input.status || 'draft',
            exchangeRateToUsd,
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, exchangeRateToUsd),
        };
        const created = await this.repository.createReceiptVoucher(payload);
        this.invalidateDashboardCache();
        await this.persistDashboardCacheMetrics();
        return created;
    }
    async updateReceiptVoucher(id, payload, scope, fxContext) {
        const existing = await this.repository.getReceiptVoucherById(id, scope);
        if (!existing)
            return null;
        if (payload.status) {
            const current = existing.status;
            const next = payload.status;
            if (current !== next && !allowedVoucherTransitions[current]?.includes(next)) {
                throw new HttpError(400, `Invalid receipt voucher status transition: ${current} -> ${next}`);
            }
        }
        const updatePayload = { ...payload };
        if (typeof payload.originalAmount === 'number' ||
            typeof payload.exchangeRateToUsd === 'number' ||
            typeof payload.originalCurrency === 'string') {
            const originalAmount = typeof payload.originalAmount === 'number' ? payload.originalAmount : Number(existing.original_amount);
            const originalCurrency = typeof payload.originalCurrency === 'string' ? payload.originalCurrency : String(existing.original_currency);
            const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
                originalCurrency,
                exchangeRateToUsd: typeof payload.exchangeRateToUsd === 'number' ? payload.exchangeRateToUsd : undefined,
                companyId: fxContext?.companyId,
                effectiveDate: fxContext?.effectiveDate,
                baseCurrency: fxContext?.baseCurrency,
            });
            updatePayload.exchangeRateToUsd = exchangeRateToUsd;
            updatePayload.baseAmountUsd = computeBaseAmountUsd(originalAmount, exchangeRateToUsd);
        }
        const updated = await this.repository.updateReceiptVoucher(id, updatePayload, scope);
        if (!updated && payload.expectedUpdatedAt) {
            const latest = await this.repository.getReceiptVoucherById(id, scope);
            if (latest) {
                throw new HttpError(409, 'Receipt voucher was modified by another operation. Reload and retry.');
            }
        }
        if (updated)
            this.invalidateDashboardCache();
        if (updated)
            await this.persistDashboardCacheMetrics();
        return updated;
    }
    async createPaymentVoucher(input, scope, fxContext) {
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot create payment voucher outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot create payment voucher outside scoped agent.');
        }
        const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
            originalCurrency: input.originalCurrency,
            exchangeRateToUsd: input.exchangeRateToUsd,
            companyId: fxContext?.companyId,
            effectiveDate: fxContext?.effectiveDate,
            baseCurrency: fxContext?.baseCurrency,
        });
        const payload = {
            ...input,
            status: input.status || 'draft',
            exchangeRateToUsd,
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, exchangeRateToUsd),
        };
        const created = await this.repository.createPaymentVoucher(payload);
        this.invalidateDashboardCache();
        await this.persistDashboardCacheMetrics();
        return created;
    }
    async updatePaymentVoucher(id, payload, scope, fxContext) {
        const existing = await this.repository.getPaymentVoucherById(id, scope);
        if (!existing)
            return null;
        if (payload.status) {
            const current = existing.status;
            const next = payload.status;
            if (current !== next && !allowedVoucherTransitions[current]?.includes(next)) {
                throw new HttpError(400, `Invalid payment voucher status transition: ${current} -> ${next}`);
            }
        }
        const updatePayload = { ...payload };
        if (typeof payload.originalAmount === 'number' ||
            typeof payload.exchangeRateToUsd === 'number' ||
            typeof payload.originalCurrency === 'string') {
            const originalAmount = typeof payload.originalAmount === 'number' ? payload.originalAmount : Number(existing.original_amount);
            const originalCurrency = typeof payload.originalCurrency === 'string' ? payload.originalCurrency : String(existing.original_currency);
            const exchangeRateToUsd = await this.resolveExchangeRateToUsd({
                originalCurrency,
                exchangeRateToUsd: typeof payload.exchangeRateToUsd === 'number' ? payload.exchangeRateToUsd : undefined,
                companyId: fxContext?.companyId,
                effectiveDate: fxContext?.effectiveDate,
                baseCurrency: fxContext?.baseCurrency,
            });
            updatePayload.exchangeRateToUsd = exchangeRateToUsd;
            updatePayload.baseAmountUsd = computeBaseAmountUsd(originalAmount, exchangeRateToUsd);
        }
        const updated = await this.repository.updatePaymentVoucher(id, updatePayload, scope);
        if (!updated && payload.expectedUpdatedAt) {
            const latest = await this.repository.getPaymentVoucherById(id, scope);
            if (latest) {
                throw new HttpError(409, 'Payment voucher was modified by another operation. Reload and retry.');
            }
        }
        if (updated)
            this.invalidateDashboardCache();
        if (updated)
            await this.persistDashboardCacheMetrics();
        return updated;
    }
    async autoGenerateReceiptFromDelivery(deliveryId, createdByUserId, throwOnDuplicate = true) {
        const result = await this.repository.autoGenerateReceiptFromDelivery(deliveryId, createdByUserId, { throwOnDuplicate });
        this.invalidateDashboardCache();
        await this.persistDashboardCacheMetrics();
        return result;
    }
}
