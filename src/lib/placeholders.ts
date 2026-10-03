import { addMonths, addWeeks, addYears, getISOWeek } from 'date-fns';
import type { DocumentLanguage, ISODate } from '@/db/types';
import { parseISODate } from './dates';

/** Arabic month names with Western digits, as on Kuwaiti invoices. */
const ARABIC_LOCALE = 'ar-KW-u-nu-latn';

/**
 * The locale for month names in a document's language: Arabic documents get
 * Arabic months ("أكتوبر"); bilingual and English ones follow the company's
 * English locale, as their printed dates do; other languages their own.
 */
export function placeholderLocale(
  language: DocumentLanguage | null | undefined,
  companyLocale = 'en-KW',
): string {
  if (language === 'ar') return ARABIC_LOCALE;
  const wanted = !language || language === 'ar-en' ? 'en' : language;
  return companyLocale.toLowerCase().startsWith(wanted) ? companyLocale : wanted;
}

/**
 * Replaces date placeholders in recurring invoice text, relative to the
 * invoice date. Supported: :DAY, :WEEK, :MONTH, :MONTHYEAR, :QUARTER, :YEAR,
 * each optionally with an offset, e.g. ":MONTH+1" (next month) or ":YEAR-1".
 * Month names are written in `locale` (see `placeholderLocale`).
 */
export function replaceDatePlaceholders(text: string, date: ISODate, locale = 'en-US'): string {
  if (!text.includes(':')) return text;
  const base = parseISODate(date);
  const arabic = locale.toLowerCase().startsWith('ar');
  return text.replace(
    /:(MONTHYEAR|MONTH|QUARTER|YEAR|WEEK|DAY)([+-]\d+)?\b/g,
    (_m, token: string, off?: string) => {
      const offset = off ? Number(off) : 0;
      switch (token) {
        case 'DAY':
          return String(base.getDate() + offset);
        case 'WEEK':
          return String(getISOWeek(addWeeks(base, offset)));
        case 'MONTH':
          return new Intl.DateTimeFormat(locale, { month: 'long' }).format(addMonths(base, offset));
        case 'MONTHYEAR':
          return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
            addMonths(base, offset),
          );
        case 'QUARTER': {
          const d = addMonths(base, offset * 3);
          const quarter = Math.floor(d.getMonth() / 3) + 1;
          return arabic ? `الربع ${quarter}` : `Q${quarter}`;
        }
        case 'YEAR':
          return String(addYears(base, offset).getFullYear());
        default:
          return _m;
      }
    },
  );
}

/** The placeholders offered in the recurring invoice editor. */
export const DATE_PLACEHOLDERS = [':MONTH', ':MONTHYEAR', ':QUARTER', ':YEAR', ':MONTH+1'] as const;

/** Each placeholder with what it becomes on an invoice dated `date`, e.g. ":MONTH" → "October". */
export function datePlaceholderExamples(
  date: ISODate,
  locale: string,
): { token: string; example: string }[] {
  return DATE_PLACEHOLDERS.map((token) => ({
    token,
    example: replaceDatePlaceholders(token, date, locale),
  }));
}
