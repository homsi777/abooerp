export type CurrencyCode = 'USD' | 'SYP' | 'TRY';

export interface ExchangeRatesToUsd {
  SYP: number;
  TRY: number;
}

export interface MonetaryValue {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  exchangeRateToUsd: number;
  baseAmountUsd: number;
}

export const DEFAULT_EXCHANGE_RATES_TO_USD: ExchangeRatesToUsd = {
  SYP: 0.000077,
  TRY: 0.031,
};

const STORAGE_KEY = 'exchange-rates-to-usd';

export function parseDecimalAmount(value: string | number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = value.replace(',', '.').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getExchangeRatesToUsd(): ExchangeRatesToUsd {
  if (typeof window === 'undefined') return DEFAULT_EXCHANGE_RATES_TO_USD;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EXCHANGE_RATES_TO_USD;

    const parsed = JSON.parse(raw) as Partial<ExchangeRatesToUsd>;
    const syp = typeof parsed.SYP === 'number' && parsed.SYP > 0 ? parsed.SYP : DEFAULT_EXCHANGE_RATES_TO_USD.SYP;
    const tryRate = typeof parsed.TRY === 'number' && parsed.TRY > 0 ? parsed.TRY : DEFAULT_EXCHANGE_RATES_TO_USD.TRY;
    return { SYP: syp, TRY: tryRate };
  } catch {
    return DEFAULT_EXCHANGE_RATES_TO_USD;
  }
}

export function saveExchangeRatesToUsd(rates: ExchangeRatesToUsd): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
}

export function getRateToUsd(currency: CurrencyCode, rates: ExchangeRatesToUsd): number {
  if (currency === 'USD') return 1;
  return rates[currency];
}

export function convertToUsd(amount: number, currency: CurrencyCode, rates: ExchangeRatesToUsd): number {
  return amount * getRateToUsd(currency, rates);
}

export function createMonetaryValue(amount: number, currency: CurrencyCode, rates: ExchangeRatesToUsd): MonetaryValue {
  const sanitizedAmount = parseDecimalAmount(amount);
  return {
    originalAmount: sanitizedAmount,
    originalCurrency: currency,
    exchangeRateToUsd: getRateToUsd(currency, rates),
    baseAmountUsd: convertToUsd(sanitizedAmount, currency, rates),
  };
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const digits = currency === 'USD' ? 2 : 2;

  const value = safe.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  if (currency === 'USD') return `USD ${value}`;
  if (currency === 'SYP') return `SYP ${value}`;
  return `TRY ${value}`;
}

