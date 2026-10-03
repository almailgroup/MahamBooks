import { format as formatPattern } from 'date-fns';
import { ar } from 'date-fns/locale/ar';
import type { DateFormat, ISODate } from '@/db/types';
import { currencyPrecision } from './money';
import { isISODate, parseISODate } from './dates';

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat(locale, options);
    } catch {
      nf = new Intl.NumberFormat('en-US', options);
    }
    numberFormats.set(key, nf);
  }
  return nf;
}

function safeCurrency(currency: string): string {
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD';
}

/** Number of decimals actually used by a value (max 6). */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const s = String(Math.abs(value));
  if (s.includes('e-')) return 6;
  const idx = s.indexOf('.');
  return idx === -1 ? 0 : Math.min(6, s.length - idx - 1);
}

/**
 * How currencies are shown: `code` is the international style ("KWD 1.500"),
 * `local` the way amounts are written in Kuwait ("KD 1.500", "1.500 د.ك").
 */
export type CurrencyDisplay = 'code' | 'local';

const LOCAL_SYMBOLS: Record<string, { latin: string; arabic: string }> = {
  KWD: { latin: 'KD', arabic: 'د.ك' },
};

/**
 * Arabic has no familiar symbols for most foreign currencies ("UK£"), so
 * they are written with their code ("1,234.50 USD"); the dinar keeps د.ك.
 */
function arabicCode(locale: string, code: string, display: CurrencyDisplay): 'code' | 'symbol' {
  if (!locale.toLowerCase().startsWith('ar')) return 'symbol';
  return display === 'local' && LOCAL_SYMBOLS[code] ? 'symbol' : 'code';
}

function localize(text: string, code: string, display: CurrencyDisplay): string {
  const local = display === 'local' ? LOCAL_SYMBOLS[code] : undefined;
  if (!local) return text;
  // CLDR writes "KWD" in English and "د.ك." (with a final dot) in Arabic.
  return text.replace(code, local.latin).replace(/د\.ك\.?/, local.arabic);
}

export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
  display: CurrencyDisplay = 'code',
): string {
  const code = safeCurrency(currency);
  const digits = currencyPrecision(code);
  const text = numberFormat(locale, {
    style: 'currency',
    currency: code,
    currencyDisplay: arabicCode(locale, code, display),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount || 0);
  return localize(text, code, display);
}

/** Like formatMoney but keeps extra decimals of precise unit prices (e.g. 0.537). */
export function formatUnitPrice(
  amount: number,
  currency: string,
  locale: string,
  display: CurrencyDisplay = 'code',
): string {
  const code = safeCurrency(currency);
  const digits = currencyPrecision(code);
  const text = numberFormat(locale, {
    style: 'currency',
    currency: code,
    currencyDisplay: arabicCode(locale, code, display),
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, decimalsOf(amount)),
  }).format(amount || 0);
  return localize(text, code, display);
}

/** Plain number with the currency's decimals and no symbol, e.g. "1,234.50". */
export function formatAmount(amount: number, currency: string, locale: string): string {
  const digits = currencyPrecision(safeCurrency(currency));
  return numberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount || 0);
}

export function formatQuantity(quantity: number, locale: string): string {
  return numberFormat(locale, { maximumFractionDigits: 6 }).format(quantity || 0);
}

/** "5%" in English, "5٪" in Arabic; `rate` is a percentage (5 for 5%). */
export function formatPercent(rate: number, locale: string): string {
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: 4 }).format(
    (rate || 0) / 100,
  );
}

export function currencySymbol(
  currency: string,
  locale: string,
  display: CurrencyDisplay = 'code',
): string {
  const code = safeCurrency(currency);
  const parts = numberFormat(locale, { style: 'currency', currency: code }).formatToParts(0);
  return localize(parts.find((p) => p.type === 'currency')?.value ?? currency, code, display);
}

export function formatDate(
  value: ISODate | null | undefined,
  dateFormat: DateFormat,
  locale: string,
): string {
  if (!value || !isISODate(value)) return '';
  const date = parseISODate(value);
  if (dateFormat === 'locale') {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
    } catch {
      return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
    }
  }
  // Month names follow the language: "3 أكتوبر 2026" in Arabic.
  return formatPattern(
    date,
    dateFormat,
    locale.toLowerCase().startsWith('ar') ? { locale: ar } : {},
  );
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      date,
    );
  } catch {
    return date.toLocaleString();
  }
}

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'locale', label: 'Based on locale' },
  { value: 'dd/MM/yyyy', label: '31/12/2026' },
  { value: 'MM/dd/yyyy', label: '12/31/2026' },
  { value: 'yyyy-MM-dd', label: '2026-12-31' },
  { value: 'dd.MM.yyyy', label: '31.12.2026' },
  { value: 'dd-MM-yyyy', label: '31-12-2026' },
  { value: 'd MMM yyyy', label: '31 Dec 2026' },
  { value: 'MMM d, yyyy', label: 'Dec 31, 2026' },
];
