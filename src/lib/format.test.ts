import { describe, expect, it } from 'vitest';
import { currencyPrecision, parseAmount, round } from './money';
import { addDaysISO, daysBetween, isISODate, occurrenceDate } from './dates';
import {
  currencySymbol,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatUnitPrice,
  isolateAmount,
} from './format';

describe('money helpers', () => {
  it('rounds half away from zero', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-1.005, 2)).toBe(-1.01);
    expect(round(2.5, 0)).toBe(3);
    expect(round(-0.001, 2)).toBe(0);
  });

  it('knows currency precision', () => {
    expect(currencyPrecision('USD')).toBe(2);
    expect(currencyPrecision('JPY')).toBe(0);
    expect(currencyPrecision('KWD')).toBe(3);
  });

  it('parses user input', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('12.5%')).toBe(12.5);
    expect(parseAmount('abc')).toBe(0);
    expect(parseAmount('')).toBe(0);
  });
});

describe('formatting', () => {
  // Intl separates symbols with non-breaking spaces; normalise for readability.
  const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

  it('formats money in the currency precision', () => {
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(1234, 'JPY', 'en-US')).toBe('¥1,234');
    expect(plain(formatMoney(1.5, 'KWD', 'en-US'))).toBe('KWD 1.500');
    expect(plain(formatMoney(1234.5, 'EUR', 'de-DE'))).toBe('1.234,50 €');
  });

  it('keeps extra decimals for unit prices', () => {
    expect(formatUnitPrice(0.537, 'USD', 'en-US')).toBe('$0.537');
    expect(formatUnitPrice(12, 'USD', 'en-US')).toBe('$12.00');
  });

  it('formats quantities and percentages', () => {
    expect(formatQuantity(1500, 'en-US')).toBe('1,500');
    expect(formatQuantity(2.25, 'en-US')).toBe('2.25');
    expect(formatPercent(7.5, 'en-US')).toBe('7.5%');
  });

  it('formats dates', () => {
    expect(formatDate('2026-12-31', 'dd/MM/yyyy', 'en-US')).toBe('31/12/2026');
    expect(formatDate('2026-12-31', 'd MMM yyyy', 'en-US')).toBe('31 Dec 2026');
    expect(formatDate('2026-12-31', 'locale', 'en-US')).toBe('Dec 31, 2026');
    expect(formatDate('2026-12-31', 'locale', 'en-GB')).toBe('31 Dec 2026');
    expect(formatDate(null, 'locale', 'en-US')).toBe('');
    expect(formatDate('not a date', 'locale', 'en-US')).toBe('');
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-2-3')).toBe(false);
  });

  it('adds days and measures gaps', () => {
    expect(addDaysISO('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });

  it('computes schedule occurrences without month-end drift', () => {
    expect(occurrenceDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(occurrenceDate('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(occurrenceDate('2026-01-15', 'quarterly', 3)).toBe('2026-10-15');
    expect(occurrenceDate('2026-01-01', 'biweekly', 2)).toBe('2026-01-29');
    expect(occurrenceDate('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
  });
});

describe('Kuwaiti dinars', () => {
  it('always show three decimals (fils)', () => {
    expect(formatMoney(1234.5, 'KWD', 'en-KW')).toBe('KWD\u00a01,234.500');
    expect(formatMoney(0.005, 'KWD', 'en-KW')).toBe('KWD\u00a00.005');
  });

  it('can be written the Kuwaiti way', () => {
    expect(formatMoney(1234.5, 'KWD', 'en-KW', 'local')).toBe('KD\u00a01,234.500');
    expect(formatMoney(1234.5, 'KWD', 'ar-KW-u-nu-latn', 'local')).toContain('1,234.500\u00a0د.ك');
    expect(formatMoney(1234.5, 'KWD', 'ar-KW-u-nu-latn', 'local')).not.toContain('د.ك.');
    expect(formatMoney(10, 'USD', 'en-KW', 'local')).toBe('$10.00');
    expect(currencySymbol('KWD', 'en-KW', 'local')).toBe('KD');
  });
});

it('writes foreign currencies by code in Arabic', () => {
  expect(formatMoney(1234.5, 'USD', 'ar-KW-u-nu-latn', 'local')).toContain('1,234.50 USD');
  expect(formatMoney(1234.5, 'KWD', 'ar-KW-u-nu-latn', 'code')).toContain('1,234.500 KWD');
});

it('writes month names in Arabic', () => {
  expect(formatDate('2026-10-03', 'd MMM yyyy', 'ar-KW-u-nu-latn')).toBe('3 أكتوبر 2026');
  expect(formatDate('2026-10-03', 'dd/MM/yyyy', 'ar-KW-u-nu-latn')).toBe('03/10/2026');
});

describe('amounts on screen', () => {
  const AR = 'ar-KW-u-nu-latn';
  const RLI = '\u2067';
  const LRI = '\u2066';
  const PDI = '\u2069';

  it('keep the minus sign with the figure and the currency after it in Arabic', () => {
    expect(isolateAmount(formatMoney(-12.5, 'KWD', AR, 'local'), AR)).toBe(
      `${RLI}${LRI}-12.500${PDI}\u00a0د.ك${PDI}`,
    );
    expect(isolateAmount(formatMoney(1234.5, 'KWD', AR, 'local'), AR)).toBe(
      `${RLI}${LRI}1,234.500${PDI}\u00a0د.ك${PDI}`,
    );
    expect(isolateAmount(formatMoney(-5.83, 'USD', AR, 'code'), AR)).toBe(
      `${RLI}${LRI}-5.83${PDI}\u00a0USD${PDI}`,
    );
  });

  it('leave English amounts as they are', () => {
    expect(isolateAmount(formatMoney(-12.5, 'KWD', 'en-KW', 'local'), 'en-KW')).toBe(
      formatMoney(-12.5, 'KWD', 'en-KW', 'local'),
    );
  });
});

it('writes Arabic date-times with the app’s date format', () => {
  const moment = new Date(2026, 9, 3, 23, 54).toISOString();
  expect(formatDateTime(moment, 'ar-KW-u-nu-latn', 'dd/MM/yyyy')).toBe('03/10/2026، 11:54 م');
  expect(formatDateTime(moment, 'en-US', 'dd/MM/yyyy')).toBe('Oct 3, 2026, 11:54 PM');
});
