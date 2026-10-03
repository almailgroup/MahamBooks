import { addMonths, format as formatPattern, lastDayOfMonth } from 'date-fns';
import { ar } from 'date-fns/locale/ar';
import type { DateFormat, ISODate } from '@/db/types';
import { addDaysISO, isISODate, parseISODate, toISODate } from './dates';
import { normalizeDigits } from './money';

/**
 * Typing and showing dates in a date field: in the company's format
 * (31/12/2026 in Kuwait, never the browser's 12/31/2026) and with month
 * names in the interface language.
 */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** Which number comes first when someone types "3/10". */
export function dateOrder(format: DateFormat, locale: string): DateOrder {
  if (format === 'MM/dd/yyyy' || format === 'MMM d, yyyy') return 'mdy';
  if (format === 'yyyy-MM-dd') return 'ymd';
  if (format !== 'locale') return 'dmy';
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    })
      .formatToParts(new Date(2026, 11, 31))
      .map((p) => p.type);
    const day = parts.indexOf('day');
    const month = parts.indexOf('month');
    if (parts.indexOf('year') < month) return 'ymd';
    return month < day ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

/** The pattern a field shows: the company's, or a numeric one for "based on locale". */
export function fieldPattern(format: DateFormat, locale: string): string {
  if (format !== 'locale') return format;
  const order = dateOrder(format, locale);
  return order === 'mdy' ? 'MM/dd/yyyy' : order === 'ymd' ? 'yyyy-MM-dd' : 'dd/MM/yyyy';
}

const isArabic = (locale: string) => locale.toLowerCase().startsWith('ar');

/** "03/10/2026", "3 Oct 2026" or "3 أكتوبر 2026". */
export function formatFieldDate(
  value: ISODate | null | undefined,
  format: DateFormat,
  locale: string,
): string {
  if (!value || !isISODate(value)) return '';
  return formatPattern(
    parseISODate(value),
    fieldPattern(format, locale),
    isArabic(locale) ? { locale: ar } : {},
  );
}

/** What to show while the field is empty: "dd/mm/yyyy" ("يوم/شهر/سنة" in Arabic). */
export function fieldPlaceholder(format: DateFormat, locale: string): string {
  const pattern = fieldPattern(format, locale);
  if (isArabic(locale)) {
    return pattern
      .replace(/d+/, 'يوم')
      .replace(/M+/, 'شهر')
      .replace('yyyy', 'سنة')
      .replace(',', '،');
  }
  return pattern.replace(/M+/, (m) => m.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function simplifyArabic(text: string): string {
  return text
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** Month names typed in English or Arabic (Gulf and Levantine names). */
const MONTH_NAMES: [string, number][] = (
  [
    ['january jan يناير كانون الثاني', 1],
    ['february feb فبراير شباط', 2],
    ['march mar مارس اذار', 3],
    ['april apr ابريل نيسان', 4],
    ['may مايو ايار', 5],
    ['june jun يونيو حزيران', 6],
    ['july jul يوليو تموز', 7],
    ['august aug اغسطس اب', 8],
    ['september sept sep سبتمبر ايلول', 9],
    ['october oct اكتوبر تشرين الاول', 10],
    ['november nov نوفمبر تشرين الثاني', 11],
    ['december dec ديسمبر كانون الاول', 12],
  ] as [string, number][]
)
  .flatMap(([names, month]) => {
    // Two-word Levantine names first, so "تشرين الثاني" is not read as "تشرين".
    const words = names.split(' ');
    const latin = words.filter((w) => /^[a-z]+$/.test(w));
    const arabic = words.filter((w) => !/^[a-z]+$/.test(w));
    const gulf = arabic[0];
    const levantine = arabic.slice(1).join(' ');
    return [
      ...latin.map((w): [string, number] => [w, month]),
      [gulf, month] as [string, number],
      ...(levantine ? [[levantine, month] as [string, number]] : []),
    ];
  })
  .sort((a, b) => b[0].length - a[0].length);

function fullYear(text: string, todayIso: ISODate): number | null {
  if (text.length === 4) return Number(text);
  if (text.length !== 2) return null;
  const yy = Number(text);
  const current = Number(todayIso.slice(2, 4));
  // "85" is 1985 (a birth date); "30" is 2030.
  return yy <= current + 20 ? 2000 + yy : 1900 + yy;
}

function build(year: number | null, month: number, day: number): ISODate | null {
  if (year === null || !Number.isInteger(year) || year < 1900 || year > 2200) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isISODate(iso) ? iso : null;
}

/**
 * Reads what someone typed: "3/10/2026", "3/10" (this year), "03102026",
 * "2026-10-03", "3 Oct 2026", "٣ أكتوبر ٢٠٢٦", "+7" (in a week) or "today".
 * Returns yyyy-MM-dd, or null when it isn't a date.
 */
export function parseFieldDate(
  input: string,
  options: { order: DateOrder; today: ISODate },
): ISODate | null {
  const { order, today } = options;
  let text = simplifyArabic(normalizeDigits(input).toLowerCase())
    .replace(/[\u200e\u200f\u061c]/g, '')
    .trim();
  if (!text) return null;

  if (text === 'today' || text === 'اليوم') return today;
  if (text === 'tomorrow' || text === 'غدا') return addDaysISO(today, 1);
  if (text === 'yesterday' || text === 'امس') return addDaysISO(today, -1);
  const relative = /^([+-])\s*(\d{1,4})\s*([dwm]?)$/.exec(text);
  if (relative) {
    const n = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    if (relative[3] === 'm') return toISODate(addMonths(parseISODate(today), n));
    return addDaysISO(today, relative[3] === 'w' ? n * 7 : n);
  }

  const year = Number(today.slice(0, 4));
  // A month name: the numbers left are the day and the year.
  for (const [name, month] of MONTH_NAMES) {
    const at = text.indexOf(name);
    if (at < 0) continue;
    const before = text[at - 1];
    const after = text[at + name.length];
    const boundary = (c: string | undefined) => c === undefined || !/[a-z\u0600-\u06ff]/.test(c);
    if (!boundary(before) || !boundary(after)) continue;
    text = `${text.slice(0, at)} ${text.slice(at + name.length)}`;
    const numbers = text.match(/\d+/g) ?? [];
    const [day, rest] = numbers;
    if (!day || numbers.length > 2 || day.length > 2) return null;
    return build(rest ? fullYear(rest, today) : year, month, Number(day));
  }
  if (/[a-z\u0600-\u06ff]/.test(text)) return null;

  const parts = text.match(/\d+/g) ?? [];
  if (parts.length === 1) {
    const digits = parts[0];
    if (digits.length <= 2) return build(year, Number(today.slice(5, 7)), Number(digits));
    if (digits.length === 8) {
      if (order === 'ymd') return build(+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6));
      parts.splice(0, 1, digits.slice(0, 2), digits.slice(2, 4), digits.slice(4));
    } else if (digits.length === 6 && order !== 'ymd') {
      parts.splice(0, 1, digits.slice(0, 2), digits.slice(2, 4), digits.slice(4));
    } else if (digits.length === 4) {
      parts.splice(0, 1, digits.slice(0, 2), digits.slice(2));
    } else {
      return null;
    }
  }
  if (parts.length === 2) {
    const [a, b] = parts.map(Number);
    return order === 'dmy' ? build(year, b, a) : build(year, a, b);
  }
  if (parts.length !== 3) return null;
  if (parts[0].length === 4) return build(+parts[0], +parts[1], +parts[2]);
  const y = fullYear(parts[2], today);
  return order === 'mdy' ? build(y, +parts[0], +parts[1]) : build(y, +parts[1], +parts[0]);
}

/** Typed far enough to use straight away (a full year), rather than on leaving the field. */
export function isCompleteDateText(input: string): boolean {
  const text = normalizeDigits(input);
  return /\d{4}/.test(text) && /\d{1,2}\D+\d{1,2}|\d{4}\D+\d|\d{8}|[^\d\s]/.test(text);
}

/* -------------------------------------------------------------------------- */
/* Quick picks and the calendar                                               */
/* -------------------------------------------------------------------------- */

export function endOfMonth(value: ISODate): ISODate {
  return toISODate(lastDayOfMonth(parseISODate(value)));
}

/** The 42 days shown for a month, weeks starting on Sunday as in Kuwait. */
export function monthGrid(month: ISODate): ISODate[] {
  const first = parseISODate(`${month.slice(0, 7)}-01`);
  const start = addDaysISO(toISODate(first), -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
}

export function addMonthsISO(value: ISODate, months: number): ISODate {
  return toISODate(addMonths(parseISODate(value), months));
}
