import {
  DEFAULT_EXCHANGE_RATES_TO_USD,
  getExchangeRatesToUsd,
  parseDecimalAmount,
  saveExchangeRatesToUsd,
  type CurrencyCode,
} from '../currency/currency';

export interface SupportedCurrencyRow {
  code: CurrencyCode;
  arabicLabel: string;
  symbol: string;
  status: 'active' | 'inactive';
  decimals: number;
  isBase: boolean;
}

export interface ExchangeRateRow {
  from: Exclude<CurrencyCode, 'USD'>;
  to: 'USD';
  rate: number;
  updatedAt: string;
  updatedBy: string;
  source: 'manual';
}

export interface CurrencyFormattingSettings {
  decimalPlacesUsd: number;
  decimalPlacesSyp: number;
  decimalPlacesTry: number;
  showCurrencyAs: 'symbol' | 'code';
  normalizeTotalsToUsd: boolean;
  showOriginalCurrencyInRows: boolean;
  showUsdEquivalent: boolean;
}

export interface CurrencyManagementSettings {
  baseCurrency: 'USD';
  supportedCurrencies: SupportedCurrencyRow[];
  exchangeRates: ExchangeRateRow[];
  formatting: CurrencyFormattingSettings;
  lastUpdatedAt: string;
  linkedModulesCount: number;
  conversionHealth: 'healthy' | 'warning';
}

export const CURRENCY_SETTINGS_STORAGE_KEY = 'settings-currency-management';

export const defaultCurrencyManagementSettings: CurrencyManagementSettings = {
  baseCurrency: 'USD',
  supportedCurrencies: [
    { code: 'USD', arabicLabel: 'دولار أمريكي', symbol: '$', status: 'active', decimals: 2, isBase: true },
    { code: 'SYP', arabicLabel: 'ليرة سورية', symbol: '£', status: 'active', decimals: 2, isBase: false },
    { code: 'TRY', arabicLabel: 'ليرة تركية', symbol: '₺', status: 'active', decimals: 2, isBase: false },
  ],
  exchangeRates: [
    { from: 'SYP', to: 'USD', rate: DEFAULT_EXCHANGE_RATES_TO_USD.SYP, updatedAt: '2026-04-22 09:10', updatedBy: 'admin', source: 'manual' },
    { from: 'TRY', to: 'USD', rate: DEFAULT_EXCHANGE_RATES_TO_USD.TRY, updatedAt: '2026-04-22 09:10', updatedBy: 'admin', source: 'manual' },
  ],
  formatting: {
    decimalPlacesUsd: 2,
    decimalPlacesSyp: 2,
    decimalPlacesTry: 2,
    showCurrencyAs: 'code',
    normalizeTotalsToUsd: true,
    showOriginalCurrencyInRows: true,
    showUsdEquivalent: true,
  },
  lastUpdatedAt: '2026-04-22 09:10',
  linkedModulesCount: 14,
  conversionHealth: 'healthy',
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function mergeSettings(saved: Partial<CurrencyManagementSettings>): CurrencyManagementSettings {
  return {
    ...defaultCurrencyManagementSettings,
    ...saved,
    supportedCurrencies: saved.supportedCurrencies || defaultCurrencyManagementSettings.supportedCurrencies,
    exchangeRates: saved.exchangeRates || defaultCurrencyManagementSettings.exchangeRates,
    formatting: { ...defaultCurrencyManagementSettings.formatting, ...(saved.formatting || {}) },
  };
}

export function getCurrencyManagementSettings(): CurrencyManagementSettings {
  const saved = readJson(CURRENCY_SETTINGS_STORAGE_KEY, defaultCurrencyManagementSettings);
  const merged = mergeSettings(saved);
  const rates = getExchangeRatesToUsd();
  const syncedRates = merged.exchangeRates.map((row) => ({
    ...row,
    rate: row.from === 'SYP' ? rates.SYP : rates.TRY,
  }));
  return { ...merged, exchangeRates: syncedRates };
}

export function saveCurrencyManagementSettings(settings: CurrencyManagementSettings): void {
  if (typeof window === 'undefined') return;
  const cleaned: CurrencyManagementSettings = {
    ...settings,
    exchangeRates: settings.exchangeRates.map((row) => ({ ...row, rate: parseDecimalAmount(row.rate) })),
    lastUpdatedAt: new Date().toLocaleString('ar-SY'),
  };
  window.localStorage.setItem(CURRENCY_SETTINGS_STORAGE_KEY, JSON.stringify(cleaned));
  const sypRate = cleaned.exchangeRates.find((row) => row.from === 'SYP')?.rate ?? DEFAULT_EXCHANGE_RATES_TO_USD.SYP;
  const tryRate = cleaned.exchangeRates.find((row) => row.from === 'TRY')?.rate ?? DEFAULT_EXCHANGE_RATES_TO_USD.TRY;
  saveExchangeRatesToUsd({ SYP: sypRate, TRY: tryRate });
}

export function resetCurrencyManagementSettings(): CurrencyManagementSettings {
  const defaults = {
    ...defaultCurrencyManagementSettings,
    lastUpdatedAt: new Date().toLocaleString('ar-SY'),
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CURRENCY_SETTINGS_STORAGE_KEY, JSON.stringify(defaults));
  }
  saveExchangeRatesToUsd({
    SYP: DEFAULT_EXCHANGE_RATES_TO_USD.SYP,
    TRY: DEFAULT_EXCHANGE_RATES_TO_USD.TRY,
  });
  return defaults;
}
