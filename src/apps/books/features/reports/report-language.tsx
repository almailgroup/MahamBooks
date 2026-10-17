import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Company, ISODate } from '@/db/types';
import { useCompany } from '@/app/company';
import { currentLanguage, interpolate, type Dictionary, type PluralForms, type Vars } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { formatAmount, formatDate, formatMoney } from '@/lib/format';
import { currencyPrecision, fromMinor } from '@/lib/money';

/**
 * Reports can be read, printed and exported in English, in Arabic or in
 * both side by side (the bilingual layout Kuwaiti auditors use), whatever
 * language the rest of the app is in.
 */
export type ReportLanguage = 'en' | 'ar' | 'both';
export type TextLanguage = 'en' | 'ar';

const loaders = import.meta.glob<{ default: Dictionary }>('/src/i18n/ar/*.ts');
let arabicPromise: Promise<Dictionary> | null = null;

/** The Arabic dictionary, loaded once. */
export function loadArabicDictionary(): Promise<Dictionary> {
  arabicPromise ??= Promise.all(Object.values(loaders).map((load) => load())).then((parts) =>
    Object.assign({}, ...parts.map((p) => p.default)),
  );
  return arabicPromise;
}

const pluralRules = new Intl.PluralRules('ar');

/**
 * Keeps a date or figure in one piece inside Arabic text: "31 Dec 2026"
 * would otherwise be reordered by the right-to-left layout.
 */
export function isolate(text: string, language: TextLanguage = currentLanguage()): string {
  return language === 'ar' && text ? `\u2068${text}\u2069` : text;
}

/** Translates text into a language with a given Arabic dictionary. */
export function translateIn(
  language: TextLanguage,
  arabic: Dictionary | null,
  text: string,
  vars?: Vars,
): string {
  if (language === 'en' || !arabic) return interpolate(text, vars);
  const found = arabic[text];
  const translated = typeof found === 'string' ? found : (found?.other ?? text);
  return interpolate(translated, vars);
}

/** Counted text in a language ("3 assets", "٣ أصول" with Western digits). */
export function translatePlural(
  language: TextLanguage,
  arabic: Dictionary | null,
  count: number,
  one: string,
  other: string,
  vars?: Vars,
): string {
  const all = { count: String(count), ...vars };
  if (language === 'en' || !arabic?.[other]) return interpolate(count === 1 ? one : other, all);
  const found = arabic[other];
  if (typeof found === 'string') return interpolate(found, all);
  const forms = found as PluralForms;
  const rule = count === 0 && forms.zero ? 'zero' : pluralRules.select(count);
  return interpolate((forms as Record<string, string | undefined>)[rule] ?? forms.other, all);
}

/** Locale for numbers and dates in a report language. */
export function reportLocale(language: TextLanguage, company: Pick<Company, 'locale'>): string {
  return language === 'ar' ? 'ar-KW-u-nu-latn' : company.locale || 'en-KW';
}

/** Formatting and words for one report language. */
export interface ReportText {
  language: TextLanguage;
  dir: 'ltr' | 'rtl';
  /** Translates a key (English text). */
  t: (text: string, vars?: Vars) => string;
  tp: (count: number, one: string, other: string, vars?: Vars) => string;
  /** A record's name: Arabic when there is one and the language is Arabic. */
  name: (record: { name: string; nameAr?: string } | null | undefined) => string;
  date: (date: ISODate | null | undefined) => string;
  /** Minor units as a plain figure, e.g. "1,234.500" (no currency). */
  amount: (minor: number) => string;
  /** Major units with the currency, e.g. "KD 1,234.500". */
  money: (amount: number) => string;
  /** "Kuwaiti Dinar" in the language. */
  currencyName: string;
}

export function reportText(
  language: TextLanguage,
  arabic: Dictionary | null,
  company: Company,
): ReportText {
  const locale = reportLocale(language, company);
  const p = currencyPrecision(company.currency);
  let currencyName = company.currency;
  try {
    currencyName =
      new Intl.DisplayNames(locale, { type: 'currency' }).of(company.currency) ?? currencyName;
  } catch {
    // Older browsers: keep the code.
  }
  return {
    language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    t: (text, vars) => translateIn(language, arabic, text, vars),
    tp: (count, one, other, vars) => translatePlural(language, arabic, count, one, other, vars),
    name: (record) => localName(record, language),
    date: (date) => isolate(formatDate(date, company.dateFormat, locale), language),
    amount: (minor) => formatAmount(fromMinor(minor, p), company.currency, locale),
    money: (amount) =>
      formatMoney(amount, company.currency, locale, company.currencyDisplay ?? 'local'),
    currencyName,
  };
}

interface ReportLanguageValue {
  language: ReportLanguage;
  setLanguage: (language: ReportLanguage) => void;
  /** Null until the Arabic words are loaded (only needed for Arabic reports). */
  arabic: Dictionary | null;
  ready: boolean;
}

const ReportLanguageContext = createContext<ReportLanguageValue | null>(null);

/** Holds the language of the reports on a page; starts in the interface language. */
export function ReportLanguageProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: ReportLanguage;
}) {
  const { language: ui } = useLanguage();
  const [language, setLanguage] = useState<ReportLanguage>(initial ?? ui);
  const [arabic, setArabic] = useState<Dictionary | null>(null);
  const needsArabic = language !== 'en';
  useEffect(() => {
    if (!needsArabic || arabic) return;
    let live = true;
    void loadArabicDictionary().then((dict) => {
      if (live) setArabic(dict);
    });
    return () => {
      live = false;
    };
  }, [needsArabic, arabic]);
  const value = useMemo(
    () => ({ language, setLanguage, arabic, ready: !needsArabic || arabic !== null }),
    [language, arabic, needsArabic],
  );
  return <ReportLanguageContext.Provider value={value}>{children}</ReportLanguageContext.Provider>;
}

export function useReportLanguage(): ReportLanguageValue {
  const ctx = useContext(ReportLanguageContext);
  if (!ctx) throw new Error('useReportLanguage must be used inside ReportLanguageProvider');
  return ctx;
}

/**
 * Words and formats of the current report language. In the bilingual layout
 * `primary` is English and `secondary` Arabic.
 */
export function useReportText(): {
  language: ReportLanguage;
  primary: ReportText;
  secondary: ReportText | null;
  ready: boolean;
} {
  const company = useCompany();
  const { language, arabic, ready } = useReportLanguage();
  const make = useCallback(
    (lang: TextLanguage) => reportText(lang, arabic, company),
    [arabic, company],
  );
  return useMemo(
    () => ({
      language,
      primary: make(language === 'ar' ? 'ar' : 'en'),
      secondary: language === 'both' ? make('ar') : null,
      ready,
    }),
    [language, make, ready],
  );
}
